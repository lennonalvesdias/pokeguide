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
  fileName: string;
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
export async function importSaveFiles(files: readonly File[], current: SaveImportPreview | null): Promise<ImportOutcome> {
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
  const stored: StoredSave = { preview: r.chosen.preview, importedAt: new Date().toISOString(), fileName: r.chosen.name };
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
  await persist(stored);
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
