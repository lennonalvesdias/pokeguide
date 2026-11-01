// Estado local: o save importado fica só neste aparelho (IndexedDB), nunca sai dele.
import { lookup, versions } from '@pokeguide/data-firered';
import type { TeamMember } from '@pokeguide/domain';
import { parseSave, SAVE_PARSER_VERSION, SaveParseError, type SaveImportPreview } from '@pokeguide/save-parser';
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

export async function importSaveFile(file: File): Promise<StoredSave> {
  const buf = await file.arrayBuffer();
  let preview: SaveImportPreview;
  try {
    preview = parseSave(buf, { isKnownItem: lookup.isKnownItem });
  } catch (e) {
    if (e instanceof SaveParseError) {
      const msg = {
        'invalid-size': 'Esse arquivo não parece um save de GBA (tamanho inesperado).',
        'no-valid-slot': 'O save está corrompido: nenhum dos dois slots é íntegro.',
        'unsupported-game': 'Esse save não é de FireRed/LeafGreen.',
      }[e.code];
      throw new Error(msg);
    }
    throw e;
  }
  const stored = { preview, importedAt: new Date().toISOString(), fileName: file.name };
  try {
    await set(KEY, stored);
  } catch {
    // Sem armazenamento (modo privado): segue só em memória.
  }
  return stored;
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
