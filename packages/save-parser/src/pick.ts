// Escolha do save mais recente entre vários arquivos (ADR-005/007).
// Ordena pelo contador de save do jogo, nunca pela data do arquivo.
import type { SaveImportPreview } from './index.ts';

export interface SaveCandidate {
  name: string;
  preview: SaveImportPreview;
}

export type PickResult =
  | { kind: 'picked'; chosen: SaveCandidate; ignored: Array<{ name: string; reason: 'older' | 'other-campaign' }> }
  | { kind: 'older-than-current'; chosen: SaveCandidate; currentCounter: number }
  | { kind: 'other-campaign'; chosen: SaveCandidate }
  | { kind: 'none' };

const playSeconds = (p: SaveImportPreview) => p.playTime.hours * 3600 + p.playTime.minutes * 60 + p.playTime.seconds;
const newer = (a: SaveImportPreview, b: SaveImportPreview) =>
  a.saveCounter !== b.saveCounter ? a.saveCounter > b.saveCounter : playSeconds(a) > playSeconds(b);

/**
 * Escolhe o save mais recente. Com um save já carregado, prefere a mesma campanha
 * (gameFingerprint) e não substitui por um save mais antigo.
 */
export function pickLatestSave(candidates: readonly SaveCandidate[], current?: SaveImportPreview | null): PickResult {
  if (!candidates.length) return { kind: 'none' };
  const sameCampaign = current ? candidates.filter((c) => c.preview.gameFingerprint === current.gameFingerprint) : [];
  const pool = sameCampaign.length ? sameCampaign : candidates;
  const chosen = pool.reduce((best, c) => (newer(c.preview, best.preview) ? c : best));
  if (current && !sameCampaign.length) return { kind: 'other-campaign', chosen };
  if (current && !newer(chosen.preview, current) && chosen.preview.saveCounter !== current.saveCounter) {
    return { kind: 'older-than-current', chosen, currentCounter: current.saveCounter };
  }
  const ignored = candidates
    .filter((c) => c !== chosen)
    .map((c) => ({
      name: c.name,
      reason: c.preview.gameFingerprint === chosen.preview.gameFingerprint ? ('older' as const) : ('other-campaign' as const),
    }));
  return { kind: 'picked', chosen, ignored };
}
