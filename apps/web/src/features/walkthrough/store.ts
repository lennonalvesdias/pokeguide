// Sessão do guia passo a passo: fica só neste aparelho (IndexedDB), por partida e por área.
import type { NavSession } from '@pokeguide/domain';
import { del, get, set } from 'idb-keyval';

export interface StoredNav {
  session: NavSession;
  /** Contador do último save conciliado: um save novo reconcilia de novo, o mesmo não. */
  saveCounter: number | null;
}

const key = (fingerprint: string, areaId: string) => `nav:v1:${fingerprint}:${areaId}`;

export async function loadNav(fingerprint: string, areaId: string): Promise<StoredNav | null> {
  try {
    const v = await get<StoredNav>(key(fingerprint, areaId));
    return v?.session?.schemaVersion === 1 ? v : null;
  } catch {
    return null;
  }
}

export async function saveNav(fingerprint: string, areaId: string, value: StoredNav): Promise<void> {
  try {
    await set(key(fingerprint, areaId), value);
  } catch {
    // Sem armazenamento (aba privada): a sessão continua só na memória.
  }
}

export async function clearNav(fingerprint: string, areaId: string): Promise<void> {
  try {
    await del(key(fingerprint, areaId));
  } catch {}
}
