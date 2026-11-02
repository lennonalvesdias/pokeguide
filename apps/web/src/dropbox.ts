// Integração opcional com o Delta Sync via Dropbox (somente leitura).
// OAuth com PKCE no fluxo "colar o código": não depende de redirect, que no iOS
// abriria fora do app instalado. O refresh token fica só neste aparelho (IndexedDB).
import { deltaSaveFiles, type CloudEntry, type DeltaSaveFile } from '@pokeguide/save-parser';
import { del, get, set } from 'idb-keyval';

/** App key do Dropbox (público por definição em clientes PKCE). */
export const DROPBOX_APP_KEY: string = import.meta.env.VITE_DROPBOX_APP_KEY ?? '';
export const dropboxAvailable = DROPBOX_APP_KEY.length > 0;

const TOKEN_KEY = 'dropbox:auth:v1';
const VERIFIER_KEY = 'dropbox:verifier';
const DELTA_FOLDERS = ['/Delta Emulator', '/Apps/Delta Emulator'];

interface StoredAuth {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  accountLabel?: string;
}

export class DropboxError extends Error {
  readonly kind: 'offline' | 'unauthorized' | 'not-found' | 'http';
  constructor(kind: DropboxError['kind'], message: string) {
    super(message);
    this.kind = kind;
    this.name = 'DropboxError';
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function safeGet<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key);
  } catch {
    return undefined;
  }
}

export async function isConnected(): Promise<boolean> {
  return !!(await safeGet<StoredAuth>(TOKEN_KEY))?.refreshToken;
}

/**
 * Passo 1: prepara o verificador PKCE e devolve a URL de autorização.
 * Reaproveita um verificador pendente, para que um código já gerado no Dropbox continue válido.
 */
export async function startAuthorization(): Promise<string> {
  let verifier = await safeGet<string>(VERIFIER_KEY);
  if (!verifier) {
    verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    try {
      await set(VERIFIER_KEY, verifier);
    } catch {
      // sem armazenamento: o verificador vale só nesta sessão
    }
  }
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
  });
  return `https://www.dropbox.com/oauth2/authorize?${q}`;
}

async function tokenRequest(body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DROPBOX_APP_KEY, ...body }),
    });
  } catch {
    throw new DropboxError('offline', 'Sem conexão com o Dropbox.');
  }
  if (res.status === 400 || res.status === 401) throw new DropboxError('unauthorized', 'Código inválido ou acesso revogado.');
  if (!res.ok) throw new DropboxError('http', `Dropbox respondeu ${res.status}.`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
}

/** Passo 2: troca o código colado pelo token. */
export async function connectDropbox(code: string): Promise<void> {
  const verifier = await safeGet<string>(VERIFIER_KEY);
  if (!verifier) throw new DropboxError('unauthorized', 'Comece a conexão de novo.');
  const t = await tokenRequest({ grant_type: 'authorization_code', code: code.trim(), code_verifier: verifier });
  if (!t.refresh_token) throw new DropboxError('unauthorized', 'O Dropbox não devolveu acesso permanente.');
  await set(TOKEN_KEY, { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  await del(VERIFIER_KEY);
}

export async function disconnect(): Promise<void> {
  await del(TOKEN_KEY);
}

async function accessToken(): Promise<string> {
  const auth = await safeGet<StoredAuth>(TOKEN_KEY);
  if (!auth) throw new DropboxError('unauthorized', 'Dropbox não conectado.');
  if (auth.accessToken && auth.expiresAt && auth.expiresAt - 60_000 > Date.now()) return auth.accessToken;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
  await set(TOKEN_KEY, { ...auth, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

async function api(url: string, init: RequestInit): Promise<Response> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new DropboxError('offline', 'Sem conexão com o Dropbox.');
  }
  if (res.status === 401) throw new DropboxError('unauthorized', 'Acesso ao Dropbox expirou ou foi revogado.');
  if (res.status === 409) throw new DropboxError('not-found', 'Pasta do Delta não encontrada no Dropbox.');
  if (!res.ok) throw new DropboxError('http', `Dropbox respondeu ${res.status}.`);
  return res;
}

interface ListResult {
  entries: Array<{ '.tag': string; name: string; path_display: string; size?: number; content_hash?: string; server_modified?: string }>;
  cursor: string;
  has_more: boolean;
}

async function listFolder(path: string): Promise<CloudEntry[]> {
  const out: CloudEntry[] = [];
  let r = (await (
    await api('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, recursive: false, limit: 2000 }),
    })
  ).json()) as ListResult;
  for (;;) {
    for (const e of r.entries) {
      if (e['.tag'] !== 'file') continue;
      out.push({
        name: e.name,
        path: e.path_display,
        ...(e.size !== undefined ? { size: e.size } : {}),
        ...(e.content_hash ? { contentHash: e.content_hash } : {}),
        ...(e.server_modified ? { modifiedAt: e.server_modified } : {}),
      });
    }
    if (!r.has_more) return out;
    r = (await (
      await api('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor: r.cursor }),
      })
    ).json()) as ListResult;
  }
}

/** Saves de GBA na pasta do Delta Sync. Nunca lista ou baixa ROMs. */
export async function findDeltaSaves(): Promise<DeltaSaveFile[]> {
  for (const folder of DELTA_FOLDERS) {
    try {
      return deltaSaveFiles(await listFolder(folder));
    } catch (e) {
      if (e instanceof DropboxError && e.kind === 'not-found') continue;
      throw e;
    }
  }
  throw new DropboxError('not-found', 'Pasta do Delta não encontrada. Confira se o Delta Sync está usando este Dropbox.');
}

export async function downloadFile(path: string): Promise<ArrayBuffer> {
  const res = await api('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    // Dropbox-API-Arg só aceita ASCII: escapa qualquer caractere fora dele.
    headers: { 'Dropbox-API-Arg': JSON.stringify({ path }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) },
  });
  return res.arrayBuffer();
}
