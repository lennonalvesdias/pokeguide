// Sessão do guia passo a passo: fica só neste aparelho (IndexedDB), por partida e por área.
// Regra de migração (ADR de distribuição de dados): sessão de outro formato ou de outra versão do
// dataset recomeça pedindo onde você está. O progresso não se perde: itens pegos e eventos vêm do save.
import type { NavSession } from '@pokeguide/domain';
import { del, get, set } from 'idb-keyval';

export interface StoredNav {
  session: NavSession;
  /** Contador do último save conciliado: um save novo reconcilia de novo, o mesmo não. */
  saveCounter: number | null;
}

const key = (fingerprint: string, sessionKey: string) => `nav:v2:${fingerprint}:${sessionKey}`;

export async function loadNav(fingerprint: string, sessionKey: string, datasetVersion: string): Promise<StoredNav | null> {
  try {
    const v = await get<StoredNav>(key(fingerprint, sessionKey));
    if (v?.session?.schemaVersion !== 2 || v.session.datasetVersion !== datasetVersion) return null;
    return v;
  } catch {
    return null;
  }
}

export async function saveNav(fingerprint: string, sessionKey: string, value: StoredNav): Promise<void> {
  try {
    await set(key(fingerprint, sessionKey), value);
  } catch {
    // Sem armazenamento (aba privada): a sessão continua só na memória.
  }
}

export async function clearNav(fingerprint: string, sessionKey: string): Promise<void> {
  try {
    await del(key(fingerprint, sessionKey));
  } catch {}
}
