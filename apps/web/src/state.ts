// Estado local: o save importado fica só neste aparelho (IndexedDB), nunca sai dele.
import { lookup, versions } from '@pokeguide/data-firered';
import type { TeamMember } from '@pokeguide/domain';
import {
  parseSave,
  pickLatestSave,
  SAVE_PARSER_VERSION,
  type SaveCandidate,
  SaveParseError,
  type SaveImportPreview,
} from '@pokeguide/save-parser';
import { get, set } from 'idb-keyval';

export interface StoredSave {
  preview: SaveImportPreview;
  importedAt: string;
  /** Quando o save foi gravado/enviado (Dropbox: chegada do arquivo; importação manual: data do arquivo). */
  savedAt?: string;
  fileName: string;
  /** content_hash do arquivo no Dropbox, para não baixar de novo o que não mudou. */
  sourceHash?: string;
  /** Demonstração com dados de exemplo: só na memória, nunca gravada. */
  demo?: true;
}

const KEY = 'save:v1';

export async function loadStoredSave(): Promise<StoredSave | null> {
  try {
    return (await get<StoredSave>(KEY)) ?? null;
  } catch {
    return null;
  }
}

const ERROR_TEXT = {
  'invalid-size': 'não parece um save de GBA',
  'no-valid-slot': 'save corrompido',
  'unsupported-game': 'não é de FireRed/LeafGreen',
} as const;

export type ImportOutcome =
  | { kind: 'imported'; stored: StoredSave; message: string }
  | { kind: 'needs-confirmation'; stored: StoredSave; message: string }
  | { kind: 'rejected'; message: string };

/** Lê um ou mais arquivos e escolhe o save mais recente pelo contador do jogo. */
export async function importSaveFiles(
  files: readonly File[],
  current: SaveImportPreview | null,
  opts: { persist?: boolean } = {},
): Promise<ImportOutcome> {
  const candidates: SaveCandidate[] = [];
  const failures: string[] = [];
  for (const file of files) {
    try {
      candidates.push({ name: file.name, preview: parseSave(await file.arrayBuffer(), { isKnownItem: lookup.isKnownItem }) });
    } catch (e) {
      failures.push(`${file.name}: ${e instanceof SaveParseError ? ERROR_TEXT[e.code] : 'não foi possível ler'}`);
    }
  }
  const failNote = failures.length ? ` Ignorados: ${failures.join('; ')}.` : '';
  const r = pickLatestSave(candidates, current);
  if (r.kind === 'none') return { kind: 'rejected', message: `Nenhum save válido.${failNote}` };
  const file = files.find((f) => f.name === r.chosen.name);
  const stored: StoredSave = {
    preview: r.chosen.preview,
    importedAt: new Date().toISOString(),
    fileName: r.chosen.name,
    ...(file?.lastModified ? { savedAt: new Date(file.lastModified).toISOString() } : {}),
  };
  const pt = r.chosen.preview.playTime;
  const desc = `${r.chosen.name} (${pt.hours}h${String(pt.minutes).padStart(2, '0')}, save nº ${r.chosen.preview.saveCounter})`;
  if (r.kind === 'older-than-current') {
    return {
      kind: 'needs-confirmation',
      stored,
      message: `${desc} é mais antigo que o carregado (save nº ${r.currentCounter}). Usar mesmo assim?`,
    };
  }
  if (r.kind === 'other-campaign') {
    return { kind: 'needs-confirmation', stored, message: `${desc} é de outra partida (outro treinador). Trocar de partida?` };
  }
  if (opts.persist !== false) await persist(stored);
  const older = r.ignored.filter((i) => i.reason === 'older').length;
  const olderNote = older ? ` ${older} save(s) mais antigo(s) ignorado(s).` : '';
  return { kind: 'imported', stored, message: `Usando ${desc}.${olderNote}${failNote}` };
}

export async function persist(stored: StoredSave): Promise<void> {
  try {
    await set(KEY, stored);
  } catch {
    // Sem armazenamento (modo privado): segue só em memória.
  }
}

export function toTeam(preview: SaveImportPreview): TeamMember[] {
  return preview.party
    .filter((p) => !p.isEgg)
    .map((p, i) => {
      const species = lookup.species(p.speciesId);
      return {
        id: `${i}-${p.personality.toString(16)}`,
        name: displayName(p.nickname || species.name),
        species,
        level: p.level,
        stats: p.stats,
        hp: p.hp,
        status: p.status,
        moves: p.moves.map((m) => ({ move: lookup.move(m.moveId), pp: m.pp })),
        ...(species.abilities.length ? { ability: species.abilities[p.abilitySlot] ?? species.abilities[0]! } : {}),
      };
    });
}

/** "MR. MIME" → "Mr. Mime"; "SAND-ATTACK" → "Sand-Attack". */
export function displayName(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-.])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export const appVersions = { ...versions, saveParserVersion: SAVE_PARSER_VERSION, appVersion: '0.1.0' };

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`pref:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`pref:${key}`, value);
  } catch {
    // preferência é só conveniência
  }
}

/** Busca o save mais recente na pasta do Delta Sync (Dropbox) e reaproveita a escolha por contador. */
export type DropboxOutcome = ImportOutcome | { kind: 'unchanged'; message: string };

/**
 * Busca o save mais recente na pasta do Delta Sync (Dropbox). Só baixa quando o
 * content_hash mudou; aplica a mesma proteção contra save antigo ou de outra partida.
 */
export async function importFromDropbox(current: StoredSave | null): Promise<DropboxOutcome> {
  const { downloadFile, findDeltaSaves } = await import('./dropbox.ts');
  const saves = await findDeltaSaves();
  if (!saves.length) return { kind: 'rejected', message: 'Nenhum save de GBA na pasta do Delta no Dropbox.' };
  const upToDate = { kind: 'unchanged' as const, message: `Já está no save mais recente do Dropbox (save nº ${current?.preview.saveCounter}).` };
  // Mesmo arquivo e mesmo leitor: nada a fazer. Leitor novo: reprocessa para extrair os campos novos.
  const sameParser = current?.preview.parserVersion === SAVE_PARSER_VERSION;
  if (sameParser && current?.sourceHash && saves.length === 1 && saves[0]!.contentHash === current.sourceHash) return upToDate;
  const files: File[] = [];
  for (const s of saves) files.push(new File([await downloadFile(s.path)], 'Dropbox', s.modifiedAt ? { lastModified: Date.parse(s.modifiedAt) } : {}));
  const outcome = await importSaveFiles(files, current?.preview ?? null, { persist: false });
  if (outcome.kind === 'rejected') return outcome;
  const chosen = saves.length === 1 ? saves[0] : undefined;
  const stored: StoredSave = { ...outcome.stored, ...(chosen?.contentHash ? { sourceHash: chosen.contentHash } : {}) };
  const same =
    current &&
    stored.preview.gameFingerprint === current.preview.gameFingerprint &&
    stored.preview.saveCounter === current.preview.saveCounter;
  if (outcome.kind === 'needs-confirmation') return { ...outcome, stored };
  await persist(stored);
  if (same) return { kind: 'imported', stored, message: upToDate.message };
  const pt = stored.preview.playTime;
  return {
    kind: 'imported',
    stored,
    message: `Save atualizado do Dropbox: ${pt.hours}h${String(pt.minutes).padStart(2, '0')}, save nº ${stored.preview.saveCounter}.`,
  };
}

/** "há 5 min", "há 2 h", "em 03/11": idade do save para o jogador saber se ele reflete o jogo aberto. */
export function saveAge(iso: string | undefined, now = Date.now()): { text: string; stale: boolean } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60000));
  const text = min < 1 ? 'agora' : min < 60 ? `há ${min} min` : min < 24 * 60 ? `há ${Math.round(min / 60)} h` : `em ${new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  // Mais de 15 min: o jogo aberto no Delta provavelmente já andou.
  return { text, stale: min > 15 };
}
