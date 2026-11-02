// Fatos do jogador para o guia, lidos do save. O que o save não traz fica desconhecido (null), nunca "falso".
import { items, lookup, trainers } from '@pokeguide/data-firered';
import type { FieldMove, NavFacts, TeamMember } from '@pokeguide/domain';
import { getVar, isFlagSet, type SaveImportPreview } from '@pokeguide/save-parser';

const trainerKeyById = new Map(trainers.map((t) => [t.id, t.key]));
const itemKeyById = new Map(items.map((i) => [i.id, i.key]));
const FIELD_MOVES: ReadonlySet<string> = new Set<FieldMove>(['flash', 'cut', 'strength', 'surf', 'rock_smash', 'waterfall']);

export function navFacts(preview: SaveImportPreview, team: readonly TeamMember[]): NavFacts {
  const { flagsHex, varsHex } = preview;
  const bag = Object.values(preview.bag).flat();
  return {
    flag: (id) => (flagsHex ? isFlagSet(flagsHex, id) : null),
    variable: (id) => getVar(varsHex, id),
    badges: preview.badges,
    items: new Set(bag.map((s) => itemKeyById.get(s.itemId) ?? '').filter(Boolean)),
    fieldMoves: new Set(team.flatMap((m) => m.moves.map((x) => x.move.key)).filter((k): k is FieldMove => FIELD_MOVES.has(k))),
    defeatedTrainers: new Set((preview.defeatedTrainerIds ?? []).map((id) => trainerKeyById.get(id) ?? '')),
  };
}

/** Itens e mapa do save que o guia usa para conciliar a sessão. */
export function saveFacts(preview: SaveImportPreview, switchFlag: number | null) {
  return {
    mapKey: lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? null,
    x: preview.location.x,
    y: preview.location.y,
    switchOn: switchFlag !== null && preview.flagsHex ? isFlagSet(preview.flagsHex, switchFlag) : null,
    hasItem: (k: string) => Object.values(preview.bag).flat().some((s) => itemKeyById.get(s.itemId) === k),
    ...(preview.flagsHex ? { isFlagSet: (f: number) => isFlagSet(preview.flagsHex, f) } : {}),
  };
}
