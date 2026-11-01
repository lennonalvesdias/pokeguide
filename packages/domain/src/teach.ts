// Vale ensinar um TM/HM? Compara o dano esperado do conjunto de golpes contra os próximos adversários.
import type { TeamMember } from './battle.ts';
import { applyStage, badgeBoost, gen3Damage, gen3Hp, gen3Stat } from './damage.ts';
import { matchup, type TypeChart } from './matchup.ts';
import type { MoveDefinition, SpeciesDefinition } from './types.ts';

/** Adversário de referência (ex.: o time dos treinadores que ainda faltam). */
export interface TeachOpponent {
  species: SpeciesDefinition;
  level: number;
  ability?: string | null;
}

export type TeachAdvice =
  | { kind: 'cannot' }
  | { kind: 'knows' }
  /** Golpe de status ou de poder variável: não dá para comparar por dano. */
  | { kind: 'not-comparable'; reason: 'status' | 'variable-power' }
  /** Tem menos de 4 golpes: aprende sem esquecer nada. */
  | { kind: 'free-slot'; gain: number }
  | { kind: 'replace'; replace: string; replaceIsStatus: boolean; gain: number }
  /** O melhor que dá para fazer melhora menos que o limite: não compensa. */
  | { kind: 'keep'; gain: number; bestReplace: string | null };

/** Ganho mínimo (relativo) para valer gastar o TM. */
export const TEACH_MIN_GAIN = 0.05;

const FIXED_DAMAGE: Record<string, (level: number) => number> = {
  dragon_rage: () => 40,
  sonicboom: () => 20,
  level_damage: (level) => level,
};

/** Fator de uso realista por turno: carga, recarga, Focus Punch, golpes que só funcionam em casos especiais. */
function usability(m: MoveDefinition): number {
  switch (m.effect) {
    case 'solar_beam':
    case 'razor_wind':
    case 'sky_attack':
    case 'skull_bash':
    case 'recharge':
      return 0.5;
    case 'focus_punch': // falha se o usuário levar dano antes
      return 0.5;
    case 'explosion': // o usuário desmaia
      return 0.3;
    case 'dream_eater': // só em alvo dormindo
    case 'snore':
    case 'fake_out':
      return 0.1;
    default:
      return 1;
  }
}

const avgHits = (m: MoveDefinition) =>
  m.effect === 'double_hit' || m.effect === 'twineedle' ? 2 : m.effect === 'multi_hit' ? 3 : 1;

/** Fração do HP do adversário que o golpe tira por turno, em média (0–1). */
export function expectedDamage(chart: TypeChart, member: TeamMember, move: MoveDefinition, opp: TeachOpponent, badges: readonly string[]): number {
  const fixed = FIXED_DAMAGE[move.effect];
  if (!fixed && (!move.power || move.power <= 1)) return 0;
  const b = opp.species.baseStats;
  const hp = gen3Hp(b.hp, opp.level, 15);
  const mu = matchup(chart, move, opp.species, { ...(opp.ability ? { ability: opp.ability } : {}), attackerTypes: member.species.types });
  if (mu.multiplier === 0) return 0;
  const acc = move.accuracy === null ? 1 : move.accuracy / 100;
  let perHit: number;
  if (fixed) perHit = fixed(member.level);
  else {
    const physical = move.category === 'physical';
    let atk = badgeBoost(physical ? 'atk' : 'spa', physical ? member.stats.atk : member.stats.spa, badges);
    if (physical && opp.ability === 'intimidate') atk = applyStage(atk, -1);
    const def = gen3Stat(physical ? b.def : b.spd, opp.level, 15);
    const thick = mu.damageModifier < 1 ? mu.damageModifier : 1;
    const { rolls } = gen3Damage({
      level: member.level,
      power: move.power!,
      attack: Math.floor(atk * thick),
      defense: def,
      stab: !!mu.stab,
      typeMultipliers: opp.species.types.map((t) => chart.multiplier(move.type, t)),
    });
    perHit = (rolls.reduce((s, r) => s + r, 0) / rolls.length) * (1 + 1 / 16);
  }
  return Math.min(1, (perHit * avgHits(move) * acc * usability(move)) / hp);
}

/** Golpes que só funcionam juntos: nenhum deles é sugerido para esquecer enquanto o par existir. */
const COMBOS: ReadonlyArray<readonly string[]> = [['rest', 'sleep_talk'], ['rest', 'snore']];
const isCombo = (key: string, current: readonly MoveDefinition[]) =>
  COMBOS.some((c) => c.includes(key) && c.every((k) => current.some((m) => m.key === k)));

/** Dano esperado médio do conjunto: em cada adversário vale o melhor golpe (nocaute = 100%). */
function setValue(matrix: number[][], cols: number[]): number {
  if (!matrix.length) return 0;
  let total = 0;
  for (const row of matrix) {
    let best = 0;
    for (const c of cols) if (row[c]! > best) best = row[c]!;
    total += best;
  }
  return total / matrix.length;
}

/**
 * Compara ensinar `move` no lugar de cada golpe atual (HMs não entram: só o Move Deleter apaga).
 * O ganho é relativo ao dano esperado atual contra `opponents`.
 */
export function teachAdvice(
  chart: TypeChart,
  member: TeamMember,
  move: MoveDefinition,
  opponents: readonly TeachOpponent[],
  badges: readonly string[],
  hmMoves: readonly string[],
): TeachAdvice {
  if (!member.species.tmhm?.includes(move.key)) return { kind: 'cannot' };
  if (member.moves.some((m) => m.move.key === move.key)) return { kind: 'knows' };
  if (move.category === 'status' && !FIXED_DAMAGE[move.effect]) return { kind: 'not-comparable', reason: 'status' };
  if (move.power === 1 && !FIXED_DAMAGE[move.effect]) return { kind: 'not-comparable', reason: 'variable-power' };

  const current = member.moves.map((m) => m.move);
  const all = [...current, move];
  const matrix = opponents.map((o) => all.map((m) => expectedDamage(chart, member, m, o, badges)));
  const idx = current.map((_, i) => i);
  const now = setValue(matrix, idx);
  const rel = (v: number) => (now > 0 ? (v - now) / now : v > 0 ? 1 : 0);

  if (current.length < 4) return { kind: 'free-slot', gain: rel(setValue(matrix, [...idx, current.length])) };

  // Empate: esquece primeiro um golpe mais fraco do mesmo tipo, depois um de status, depois o de menor poder.
  const forgetRank = (m: MoveDefinition) => (m.type === move.type && m.category !== 'status' && (m.power ?? 0) < (move.power ?? 0) ? 0 : m.category === 'status' ? 1 : 2);
  const tieBetter = (a: MoveDefinition, b: MoveDefinition) => forgetRank(a) - forgetRank(b) || (a.power ?? 0) - (b.power ?? 0);
  let best: { i: number; value: number } | null = null;
  for (const i of idx) {
    const m = current[i]!;
    if (hmMoves.includes(m.key) || isCombo(m.key, current)) continue;
    const value = setValue(matrix, [...idx.filter((j) => j !== i), current.length]);
    if (!best || value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && tieBetter(m, current[best.i]!) < 0)) best = { i, value };
  }
  if (!best) return { kind: 'keep', gain: 0, bestReplace: null };
  const gain = rel(best.value);
  const replace = current[best.i]!;
  if (gain < TEACH_MIN_GAIN) return { kind: 'keep', gain, bestReplace: replace.key };
  return { kind: 'replace', replace: replace.key, replaceIsStatus: replace.category === 'status', gain };
}
