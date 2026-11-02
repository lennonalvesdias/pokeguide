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
  | ({ kind: 'free-slot' } & TeachGain)
  | ({ kind: 'replace'; replace: string; replaceIsStatus: boolean } & TeachGain)
  /**
   * Não ensinar. `bestReplace` é só diagnóstico (a interface não deve apresentá-lo como sugestão);
   * `protectedMove` é o ataque principal com STAB, que um golpe sem STAB nunca substitui.
   */
  | ({ kind: 'keep'; bestReplace: string | null; reason: 'low-gain' | 'only-locked'; protectedMove: string | null } & TeachGain);

/** O porquê do número, para a interface explicar o ganho. */
export interface TeachGain {
  /** Ganho relativo do dano esperado ponderado. */
  gain: number;
  /** Quantos adversários de referência entraram na conta. */
  opponents: number;
  /** Onde mais melhora (espécies, sem repetir) e quantos ficam piores. */
  improves: string[];
  worsens: number;
  /** Golpe de HM: só o Move Deleter apaga depois. */
  hm: boolean;
}

/** Ganho mínimo (relativo) para valer gastar o TM. */
export const TEACH_MIN_GAIN = 0.05;
/** HM ocupa o espaço de forma quase permanente: exige ganho maior. */
export const TEACH_MIN_GAIN_HM = 0.15;

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
  return Math.min(1, ((perHit * avgHits(move) * acc * usability(move)) / hp) * secondaryBonus(move));
}

/** Efeitos que deixam o adversário pior a cada acerto (paralisia, queimadura etc.). */
const STATUS_SECONDARY = new Set([
  'paralyze_hit', 'burn_hit', 'freeze_hit', 'poison_hit', 'confuse_hit', 'flinch_hit', 'flinch_minimize_hit',
  'tri_attack', 'thunder', 'blaze_kick', 'poison_fang', 'poison_tail', 'twister', 'secret_power', 'thaw_hit',
]);

/**
 * Bônus pelo efeito secundário: metade da chance vira dano equivalente
 * (Body Slam, 30% de paralisia, vale como 15% a mais). Um nocaute continua valendo 100%.
 */
export function secondaryBonus(m: MoveDefinition): number {
  return STATUS_SECONDARY.has(m.effect) && m.secondaryEffectChance > 0 ? 1 + (0.5 * m.secondaryEffectChance) / 100 : 1;
}

/**
 * Melhor dano esperado da equipe contra cada adversário, sem contar `exceptId`.
 * Serve de peso: um adversário que outro membro já derruba conta menos.
 */
export function teamCoverage(
  chart: TypeChart,
  team: readonly TeamMember[],
  opponents: readonly TeachOpponent[],
  badges: readonly string[],
): Map<string, number[]> {
  const perMember = new Map(
    team.map((m) => [m.id, opponents.map((o) => Math.max(0, ...m.moves.map((x) => expectedDamage(chart, m, x.move, o, badges))))]),
  );
  const out = new Map<string, number[]>();
  for (const m of team) {
    out.set(
      m.id,
      opponents.map((_, i) => Math.max(0, ...team.filter((t) => t.id !== m.id).map((t) => perMember.get(t.id)![i]!))),
    );
  }
  return out;
}

const isDamaging = (m: MoveDefinition) => m.category !== 'status' && ((m.power ?? 0) > 1 || !!FIXED_DAMAGE[m.effect]);
const hasStab = (member: TeamMember, m: MoveDefinition) => isDamaging(m) && member.species.types.includes(m.type);

/**
 * Ataque principal com STAB: o golpe de dano do tipo do Pokémon com maior poder × precisão.
 * Uma média agregada de dano não pode tirá-lo para pôr um golpe sem STAB (ex.: Surf no Snorlax).
 */
export function mainStabMove(member: TeamMember): MoveDefinition | null {
  const score = (m: MoveDefinition) => (m.power ?? 0) * (m.accuracy ?? 100);
  const stab = member.moves.map((x) => x.move).filter((m) => hasStab(member, m) && !FIXED_DAMAGE[m.effect]);
  return stab.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** O novo golpe pode ocupar o lugar do ataque principal? Só se também tiver STAB e for melhor. */
const canReplaceMain = (member: TeamMember, main: MoveDefinition, move: MoveDefinition) =>
  hasStab(member, move) && (move.power ?? 0) * (move.accuracy ?? 100) > (main.power ?? 0) * (main.accuracy ?? 100);

/** Golpes que só funcionam juntos: nenhum deles é sugerido para esquecer enquanto o par existir. */
const COMBOS: ReadonlyArray<readonly string[]> = [['rest', 'sleep_talk'], ['rest', 'snore']];
const isCombo = (key: string, current: readonly MoveDefinition[]) =>
  COMBOS.some((c) => c.includes(key) && c.every((k) => current.some((m) => m.key === k)));

/** Melhor golpe do conjunto contra cada adversário (nocaute = 100%). */
const bestPerRow = (matrix: number[][], cols: number[]) => matrix.map((row) => Math.max(0, ...cols.map((c) => row[c]!)));

/** Dano esperado médio ponderado. */
function weighted(values: number[], weights: number[]): number {
  let total = 0;
  let w = 0;
  values.forEach((v, i) => {
    total += v * weights[i]!;
    w += weights[i]!;
  });
  return w > 0 ? total / w : 0;
}

export interface TeachOptions {
  /** Melhor dano do resto da equipe contra cada adversário (ver `teamCoverage`). */
  teamBest?: readonly number[] | undefined;
}

/**
 * Compara ensinar `move` no lugar de cada golpe atual (HMs não entram: só o Move Deleter apaga).
 * O ganho é relativo ao dano esperado atual contra `opponents`, com peso menor para quem o resto
 * da equipe já derruba: um adversário que outro membro nocauteia vale 30% de um que ninguém cobre.
 */
export function teachAdvice(
  chart: TypeChart,
  member: TeamMember,
  move: MoveDefinition,
  opponents: readonly TeachOpponent[],
  badges: readonly string[],
  hmMoves: readonly string[],
  opts: TeachOptions = {},
): TeachAdvice {
  if (!member.species.tmhm?.includes(move.key)) return { kind: 'cannot' };
  if (member.moves.some((m) => m.move.key === move.key)) return { kind: 'knows' };
  if (move.category === 'status' && !FIXED_DAMAGE[move.effect]) return { kind: 'not-comparable', reason: 'status' };
  if (move.power === 1 && !FIXED_DAMAGE[move.effect]) return { kind: 'not-comparable', reason: 'variable-power' };

  const hm = hmMoves.includes(move.key);
  const current = member.moves.map((m) => m.move);
  const all = [...current, move];
  const matrix = opponents.map((o) => all.map((m) => expectedDamage(chart, member, m, o, badges)));
  const weights = opponents.map((_, i) => 1 - 0.7 * Math.min(1, opts.teamBest?.[i] ?? 0));
  const idx = current.map((_, i) => i);
  const nowRow = bestPerRow(matrix, idx);
  const now = weighted(nowRow, weights);
  const explain = (cols: number[]): TeachGain => {
    const row = bestPerRow(matrix, cols);
    const value = weighted(row, weights);
    const diffs = row.map((v, i) => ({ d: (v - nowRow[i]!) * weights[i]!, sp: opponents[i]!.species.name }));
    const improves = [...new Set(diffs.filter((x) => x.d > 0.05).sort((a, b) => b.d - a.d).map((x) => x.sp))].slice(0, 3);
    return {
      gain: now > 0 ? (value - now) / now : value > 0 ? 1 : 0,
      opponents: opponents.length,
      improves,
      worsens: row.filter((v, i) => v < nowRow[i]! - 0.01).length,
      hm,
    };
  };

  if (current.length < 4) return { kind: 'free-slot', ...explain([...idx, current.length]) };

  // Empate: esquece primeiro um golpe mais fraco do mesmo tipo, depois um de status, depois o de menor poder.
  const forgetRank = (m: MoveDefinition) => (m.type === move.type && m.category !== 'status' && (m.power ?? 0) < (move.power ?? 0) ? 0 : m.category === 'status' ? 1 : 2);
  const tieBetter = (a: MoveDefinition, b: MoveDefinition) => forgetRank(a) - forgetRank(b) || (a.power ?? 0) - (b.power ?? 0);
  const main = mainStabMove(member);
  const protectedMove = main && !canReplaceMain(member, main, move) ? main.key : null;
  let best: { i: number; value: number } | null = null;
  for (const i of idx) {
    const m = current[i]!;
    if (hmMoves.includes(m.key) || isCombo(m.key, current) || m.key === protectedMove) continue;
    const value = weighted(bestPerRow(matrix, [...idx.filter((j) => j !== i), current.length]), weights);
    if (!best || value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && tieBetter(m, current[best.i]!) < 0)) best = { i, value };
  }
  if (!best) return { kind: 'keep', bestReplace: null, reason: 'only-locked', protectedMove, gain: 0, opponents: opponents.length, improves: [], worsens: 0, hm };
  const replace = current[best.i]!;
  const g = explain([...idx.filter((j) => j !== best.i), current.length]);
  if (g.gain < (hm ? TEACH_MIN_GAIN_HM : TEACH_MIN_GAIN)) return { kind: 'keep', bestReplace: replace.key, reason: 'low-gain', protectedMove, ...g };
  return { kind: 'replace', replace: replace.key, replaceIsStatus: replace.category === 'status', ...g };
}

/** Golpes de status fracos: podem sair para dar lugar a dano. Os demais de status ficam (Recover, Reflect, Toxic...). */
const WEAK_STATUS = new Set([
  'growl', 'leer', 'tail_whip', 'sand_attack', 'smokescreen', 'kinesis', 'string_shot', 'harden', 'defense_curl',
  'withdraw', 'focus_energy', 'tickle', 'charm', 'scary_face', 'sweet_scent', 'splash', 'teleport', 'supersonic',
  'odor_sleuth', 'foresight', 'mud_sport', 'water_sport', 'howl', 'sharpen', 'meditate', 'poison_gas', 'tail_glow',
]);

export interface MovesetCandidate {
  move: MoveDefinition;
  /** De onde vem um golpe novo (ex.: 'TM26'); ausente para os que já conhece. */
  source?: string;
}

export interface MovesetAdvice {
  /** Os 4 golpes sugeridos, na ordem atual (novos no lugar dos que saem). */
  moves: string[];
  learn: Array<{ move: string; source: string; replaces: string | null }>;
  /** Ganho relativo do dano esperado ponderado. */
  gain: number;
  /** Golpes que ficam de qualquer jeito (HM, par Rest + Sleep Talk, ataque principal com STAB, status útil). */
  locked: string[];
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head!, ...c]), ...combinations(rest, k)];
}

/**
 * Melhor conjunto de 4 golpes com o que o membro já conhece e os TMs/HMs da bolsa que ele aprende.
 * HMs, o par Rest + Sleep Talk, o ataque principal com STAB e golpes de status úteis ficam travados. Ensinar um HM novo só entra
 * se render 15% a mais que a melhor opção sem ele.
 */
export function bestMoveset(
  chart: TypeChart,
  member: TeamMember,
  candidates: readonly MovesetCandidate[],
  opponents: readonly TeachOpponent[],
  badges: readonly string[],
  hmMoves: readonly string[],
  opts: TeachOptions = {},
): MovesetAdvice {
  const current = member.moves.map((m) => m.move);
  const main = mainStabMove(member);
  // O ataque principal com STAB só sai se um candidato com STAB for melhor que ele.
  const keepMain = !!main && !candidates.some((c) => member.species.tmhm?.includes(c.move.key) && canReplaceMain(member, main, c.move));
  const lockedMoves = current.filter(
    (m) =>
      hmMoves.includes(m.key) ||
      isCombo(m.key, current) ||
      (keepMain && m.key === main!.key) ||
      (m.category === 'status' && !FIXED_DAMAGE[m.effect] && !WEAK_STATUS.has(m.key)),
  );
  const pool: MovesetCandidate[] = [];
  for (const m of current) if (!lockedMoves.includes(m) && (m.category !== 'status' || FIXED_DAMAGE[m.effect])) pool.push({ move: m });
  for (const c of candidates) {
    const usable = c.move.category !== 'status' && (c.move.power !== 1 || FIXED_DAMAGE[c.move.effect]);
    if (usable && member.species.tmhm?.includes(c.move.key) && !pool.some((p) => p.move.key === c.move.key) && !lockedMoves.some((l) => l.key === c.move.key)) pool.push(c);
  }
  const slots = Math.max(0, 4 - lockedMoves.length);
  const all = [...lockedMoves.map((move) => ({ move }) as MovesetCandidate), ...pool];
  const matrix = opponents.map((o) => all.map((c) => expectedDamage(chart, member, c.move, o, badges)));
  const weights = opponents.map((_, i) => 1 - 0.7 * Math.min(1, opts.teamBest?.[i] ?? 0));
  const value = (cols: number[]) => weighted(bestPerRow(matrix, cols), weights);
  const lockedCols = lockedMoves.map((_, i) => i);
  const now = value(current.map((m) => all.findIndex((c) => c.move.key === m.key)).filter((i) => i >= 0));
  const poolIdx = pool.map((_, i) => lockedMoves.length + i);
  const isNewHm = (i: number) => !!all[i]!.source && hmMoves.includes(all[i]!.move.key);
  let best: { cols: number[]; v: number } | null = null;
  let bestNoHm: { cols: number[]; v: number } | null = null;
  for (const combo of combinations(poolIdx, Math.min(slots, poolIdx.length))) {
    const changes = combo.filter((i) => all[i]!.source).length;
    // Desempate: menos golpes novos (TM é de uso único).
    const v = value([...lockedCols, ...combo]) - changes * 1e-6;
    if (!best || v > best.v) best = { cols: combo, v };
    if (!combo.some(isNewHm) && (!bestNoHm || v > bestNoHm.v)) bestNoHm = { cols: combo, v };
  }
  let pick = best;
  if (best && bestNoHm && best !== bestNoHm && best.cols.some(isNewHm) && best.v < bestNoHm.v * (1 + TEACH_MIN_GAIN_HM)) pick = bestNoHm;
  const chosen = new Set((pick?.cols ?? []).map((i) => all[i]!.move.key));
  for (const m of lockedMoves) chosen.add(m.key);
  const learnList = (pick?.cols ?? []).filter((i) => all[i]!.source).map((i) => all[i]!);
  const leaving = current.filter((m) => !chosen.has(m.key));
  const moves = current.map((m) => m.key);
  const learn: MovesetAdvice['learn'] = [];
  learnList.forEach((c, k) => {
    const out = leaving[k] ?? null;
    if (out) moves[moves.indexOf(out.key)] = c.move.key;
    else moves.push(c.move.key);
    learn.push({ move: c.move.key, source: c.source!, replaces: out?.key ?? null });
  });
  const v = pick ? pick.v : now;
  const gain = now > 0 ? (v - now) / now : v > 0 ? 1 : 0;
  // Ganho pequeno não vale gastar TM: mantém o conjunto atual.
  if (gain < TEACH_MIN_GAIN) return { moves: current.map((m) => m.key), learn: [], gain: Math.max(0, gain), locked: lockedMoves.map((m) => m.key) };
  return { moves: moves.slice(0, 4), learn, gain, locked: lockedMoves.map((m) => m.key) };
}
