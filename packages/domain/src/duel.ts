// Duelo por turnos (Gen III): probabilidade de nocautear antes de ser nocauteado, com as 16
// rolagens de dano, precisão, crítico (1/16, dano dobrado) e golpes de múltiplos acertos.
// Conferido contra pret/pokefirered: Cmd_accuracycheck e Cmd_setmultihitcounter
// (src/battle_script_commands.c). Ignora status, troca de estágios, recuo e cura.

export interface AttackModel {
  /** Dano de cada uma das 16 rolagens sem crítico. Vazio = não causa dano. */
  rolls: number[];
  /** Dano fixo (Dragon Rage, Seismic Toss...): ignora rolagens e crítico. */
  fixed?: number;
  /** Precisão 1–100; null = nunca erra. */
  accuracy: number | null;
  hits: 'single' | 'double' | 'multi';
}

/**
 * Ritmo de um golpe no duelo:
 * - normal: acerta todo turno. Semi-invulneráveis (Fly, Dig, Bounce, Dive) também entram aqui:
 *   no turno de preparo o oponente erra, então os dois lados agem nos mesmos turnos.
 * - charge: prepara um turno e acerta no seguinte, levando golpe enquanto prepara (Solar Beam...).
 * - recharge: acerta e perde o turno seguinte (Hyper Beam...).
 */
export type Cadence = 'normal' | 'charge' | 'recharge';

export function cadenceOf(effect: string): Cadence {
  if (effect === 'solar_beam' || effect === 'razor_wind' || effect === 'sky_attack' || effect === 'skull_bash') return 'charge';
  if (effect === 'recharge') return 'recharge';
  return 'normal';
}

/** Explosion/Self-Destruct: o usuário desmaia; só o primeiro uso conta. */
export const isOneShot = (effect: string) => effect === 'explosion';

/** Turno em que acontece o n-ésimo uso (n ≥ 1). */
function useTurn(n: number, c: Cadence): number {
  return c === 'charge' ? 2 * n : c === 'recharge' ? 2 * n - 1 : n;
}

export type Dist = Array<[damage: number, prob: number]>;

const CRIT = 1 / 16;
/** Cmd_setmultihitcounter: 2 e 3 acertos com 3/8 cada; 4 e 5 com 1/8 cada. */
const MULTI_HITS: Array<[number, number]> = [[2, 3 / 8], [3, 3 / 8], [4, 1 / 8], [5, 1 / 8]];

function merge(d: Dist): Dist {
  const m = new Map<number, number>();
  for (const [x, p] of d) if (p > 0) m.set(x, (m.get(x) ?? 0) + p);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function convolve(a: Dist, b: Dist, cap: number): Dist {
  const out: Dist = [];
  for (const [x, p] of a) for (const [y, q] of b) out.push([Math.min(cap, x + y), p * q]);
  return merge(out);
}

/** Distribuição do dano de um uso do golpe (inclui erro = 0). `cap` limita o suporte ao HP. */
export function attackDistribution(m: AttackModel, cap: number): Dist {
  const hit = (m.accuracy ?? 100) / 100;
  let one: Dist;
  if (m.fixed !== undefined) one = [[Math.min(cap, m.fixed), 1]];
  else if (!m.rolls.length || m.rolls.every((r) => r === 0)) return [[0, 1]];
  else {
    one = merge(
      m.rolls.flatMap((r) => [
        [Math.min(cap, r), (1 - CRIT) / m.rolls.length] as [number, number],
        [Math.min(cap, r * 2), CRIT / m.rolls.length] as [number, number],
      ]),
    );
  }
  let total: Dist;
  if (m.hits === 'single') total = one;
  else if (m.hits === 'double') total = convolve(one, one, cap);
  else {
    const parts: Dist = [];
    let acc = one;
    for (let n = 2; n <= 5; n++) {
      acc = convolve(acc, one, cap);
      const w = MULTI_HITS.find(([k]) => k === n)![1];
      for (const [x, p] of acc) parts.push([x, p * w]);
    }
    total = merge(parts);
  }
  return merge([...total.map(([x, p]) => [x, p * hit] as [number, number]), [0, 1 - hit]]);
}

/** F(t): probabilidade de ter nocauteado (dano acumulado ≥ hp) em até t usos, t = 0..maxUses. */
export function koCdf(per: Dist, hp: number, maxUses = 10, oneShot = false): number[] {
  const cdf = [hp <= 0 ? 1 : 0];
  let state = new Float64Array(hp + 1);
  state[0] = 1;
  for (let t = 1; t <= maxUses; t++) {
    const next = new Float64Array(hp + 1);
    next[hp] = state[hp]!;
    for (let d = 0; d < hp; d++) {
      const p = state[d]!;
      if (!p) continue;
      for (const [x, q] of per) next[Math.min(hp, d + x)]! += p * q;
    }
    state = next;
    cdf.push(state[hp]!);
  }
  return oneShot ? cdf.map((v, t) => (t === 0 ? v : cdf[1]!)) : cdf;
}

export interface DuelTiming {
  /** Quem age primeiro em cada turno. 'unknown' = média dos dois casos. */
  order: 'me' | 'them' | 'unknown';
  /** Turnos em que eu não ajo (ex.: dormindo). */
  myDelay?: number;
  /** Ataques livres do oponente antes do 1º turno (ex.: eu acabei de trocar). */
  theirFreeAttacks?: number;
  myCadence?: Cadence;
  theirCadence?: Cadence;
  /** Meu golpe me nocauteia ao ser usado (Explosion): sem vitória depois do 1º uso. */
  myOneShot?: boolean;
}

/** Probabilidade de eu nocautear antes de ser nocauteado. */
export function duelWinProbability(mine: number[], theirs: number[], timing: DuelTiming): number {
  if (timing.order === 'unknown') {
    return (duelWinProbability(mine, theirs, { ...timing, order: 'me' }) + duelWinProbability(mine, theirs, { ...timing, order: 'them' })) / 2;
  }
  const delay = timing.myDelay ?? 0;
  const free = timing.theirFreeAttacks ?? 0;
  const myC = timing.myCadence ?? 'normal';
  const theirC = timing.theirCadence ?? 'normal';
  const F = (cdf: number[], n: number) => cdf[Math.max(0, Math.min(n, cdf.length - 1))]!;
  // Quantos ataques do oponente aconteceram antes do meu ataque no turno `turn`.
  const theirsBefore = (turn: number) => {
    let n = free;
    for (let u = 1; u < theirs.length + 20; u++) {
      const tu = useTurn(u, theirC);
      if (tu < turn || (tu === turn && timing.order === 'them')) n++;
      else break;
    }
    return n;
  };
  let win = 0;
  const lastUse = timing.myOneShot ? 1 : mine.length - 1;
  for (let t = 1; t <= lastUse; t++) {
    const turn = useTurn(t, myC) + delay;
    win += (mine[t]! - mine[t - 1]!) * (1 - F(theirs, theirsBefore(turn)));
  }
  return Math.max(0, Math.min(1, win));
}
