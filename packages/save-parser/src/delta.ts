// Leitura da pasta do Delta Sync (Dropbox). Formato observado em campo (Delta 1.7, Harmony):
//   GameSave-<sha1 da ROM>            JSON com metadados do registro
//   GameSave-<sha1 da ROM>-gameSave   o save bruto (128 KB para FRLG)
//   Game-<sha1>-game                  a ROM: NUNCA deve ser baixada
// Só os arquivos de save com tamanho de save de GBA são candidatos.

export interface CloudEntry {
  name: string;
  path: string;
  size?: number;
  contentHash?: string;
  /** Quando o arquivo chegou ao Dropbox (ISO 8601): o Delta Sync envia logo depois de salvar. */
  modifiedAt?: string;
}

export interface DeltaSaveFile {
  gameId: string;
  path: string;
  size: number;
  contentHash?: string;
  modifiedAt?: string;
}

const SAVE_FILE = /^GameSave-([0-9a-f]{40})-gameSave$/i;
const GBA_SAVE_SIZES = new Set([0x20000, 0x20010]);

export function deltaSaveFiles(entries: readonly CloudEntry[]): DeltaSaveFile[] {
  const out: DeltaSaveFile[] = [];
  for (const e of entries) {
    const m = SAVE_FILE.exec(e.name);
    if (!m || e.size === undefined || !GBA_SAVE_SIZES.has(e.size)) continue;
    out.push({
      gameId: m[1]!.toLowerCase(),
      path: e.path,
      size: e.size,
      ...(e.contentHash ? { contentHash: e.contentHash } : {}),
      ...(e.modifiedAt ? { modifiedAt: e.modifiedAt } : {}),
    });
  }
  return out;
}
