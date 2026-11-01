// Ranking da equipe contra um adversário (ADR-004, modo rápido com estimativa de dano).
import { applyStage, badgeBoost, effectiveSpeed, gen3Damage, gen3Hp, gen3Stat } from './damage.ts';
import { type AttackModel, attackDistribution, type Cadence, cadenceOf, duelWinProbability, isOneShot, koCdf } from './duel.ts';
import { matchup, type TypeChart } from './matchup.ts';
import type { MoveDefinition, SpeciesDefinition, StatBlock } from './types.ts';

export interface TeamMember {
  id: string;
  name: string;
  species: SpeciesDefinition;
  level: number;
  stats: StatBlock;
  hp: { current: number; max: number };
  status: string | null;
  moves: Array<{ move: MoveDefinition; pp?: number }>;
}

export interface Opponent {
  species: SpeciesDefinition;
  level: number;
  moves: MoveDefinition[];
  ability?: string;
  /** IV fixo (treinadores). Sem valor, considera a faixa 0–31. */
  iv?: number;
  /** Natureza conhecida (treinadores): stats exatos. */
  nature?: string | null;
}

export type KoChance = 'guaranteed' | 'possible' | 'none';

export interface MoveEstimate {
  moveKey: string;
  multiplier: number;
  /** Multiplicador incerto porque depende da habilidade desconhecida. */
  abilityDependent: boolean;
  stab: boolean;
  pctMin: number;
  pctMax: number;
  ko: KoChance;
}

export interface DuelResult {
  /** Probabilidade de nocautear antes de ser nocauteado (0–1), com rolagens, precisão e crítico. */
  winProb: number;
  /** Golpe que maximiza a chance de vencer. */
  moveKey: string | null;
  /** Golpe do oponente que mais reduz essa chance (pior caso). */
  theirMoveKey: string | null;
}

export interface MemberAssessment {
  memberId: string;
  best: MoveEstimate | null;
  threat: MoveEstimate | null;
  speed: 'faster' | 'slower' | 'tie' | 'unknown';
  duel: DuelResult;
  /** 0–100: chance de vencer o duelo, com desempate pelo dano garantido. */
  score: number;
  notes: string[];
}

/** Turnos assumidos sem agir: em Gen III o sono dura 2–5 turnos; congelado é aleatório. */
const SLEEP_DELAY = 2;
const FREEZE_DELAY = 3;

const FIXED_DAMAGE: Record<string, (level: number) => number> = {
  dragon_rage: () => 40,
  sonicboom: () => 20,
  level_damage: (level) => level,
};

const hitsOf = (m: MoveDefinition): [number, number] =>
  m.effect === 'double_hit' || m.effect === 'twineedle' ? [2, 2] : m.effect === 'multi_hit' ? [2, 5] : [1, 1];

function koChance(pctMin: number, pctMax: number): KoChance {
  return pctMin >= 100 ? 'guaranteed' : pctMax >= 100 ? 'possible' : 'none';
}

const pct = (dmg: number, hp: number) => Math.round((dmg / Math.max(hp, 1)) * 100);

function opponentStats(o: Opponent) {
  const ivs = o.iv === undefined ? [0, 31] : [o.iv, o.iv];
  const b = o.species.baseStats;
  const n = o.nature ?? null;
  const at = (iv: number) => ({
    hp: gen3Hp(b.hp, o.level, iv),
    atk: gen3Stat(b.atk, o.level, iv, 0, n, 'atk'),
    def: gen3Stat(b.def, o.level, iv, 0, n, 'def'),
    spa: gen3Stat(b.spa, o.level, iv, 0, n, 'spa'),
    spd: gen3Stat(b.spd, o.level, iv, 0, n, 'spd'),
    spe: gen3Stat(b.spe, o.level, iv, 0, n, 'spe'),
  });
  // Para o duelo: IV fixo do treinador ou o meio da faixa (15) para selvagens.
  return { low: at(ivs[0]!), high: at(ivs[1]!), mid: at(o.iv ?? 15) };
}

/** Golpes que um Pokémon selvagem conhece: os 4 últimos golpes de level-up até o nível (Gen III). */
export function wildMoveset(species: SpeciesDefinition, level: number): string[] {
  const known: string[] = [];
  for (const lm of species.levelUpMoves) {
    if (lm.level > level || known.includes(lm.move)) continue;
    if (known.length === 4) known.shift();
    known.push(lm.move);
  }
  return known;
}

export interface AssessOptions {
  /** Ataques livres do oponente antes do 1º turno (o membro acabou de entrar por troca). */
  theirFreeAttacks?: number;
}

export function assessTeam(
  chart: TypeChart,
  team: readonly TeamMember[],
  opponent: Opponent,
  badges: readonly string[],
  opts: AssessOptions = {},
): MemberAssessment[] {
  return team.map((m) => assessMember(chart, m, opponent, badges, opts)).sort((a, b) => b.score - a.score);
}

export function assessMember(
  chart: TypeChart,
  member: TeamMember,
  opponent: Opponent,
  badges: readonly string[],
  opts: AssessOptions = {},
): MemberAssessment {
    const opp = opponentStats(opponent);
    const notes: string[] = [];
    if (member.hp.current === 0) {
      return { memberId: member.id, best: null, threat: null, speed: 'unknown', duel: { winProb: 0, moveKey: null, theirMoveKey: null }, score: -1000, notes: ['desmaiado'] };
    }
    type Modeled = { key: string; model: AttackModel; cadence: Cadence; oneShot: boolean };
    const myModels: Modeled[] = [];
    const theirModels: Modeled[] = [];
    const estimates: MoveEstimate[] = [];

    // Ataque: menor dano garantido contra o oponente com IVs altos, maior contra IVs baixos.
    let best: MoveEstimate | null = null;
    for (const { move, pp } of member.moves) {
      if (pp === 0) continue;
      const fixed = FIXED_DAMAGE[move.effect];
      if (!move.power && !fixed) continue;
      if (move.power === 1 && !fixed) continue; // poder variável (Return, Flail...)
      const mu = matchup(chart, move, opponent.species, {
        ...(opponent.ability ? { ability: opponent.ability } : {}),
        attackerTypes: member.species.types,
      });
      const mult = mu.byAbility ? mu.range.min : mu.multiplier;
      const [hMin, hMax] = hitsOf(move);
      let dMin: number;
      let dMax: number;
      const hitsKind: AttackModel['hits'] = hMax === 2 ? 'double' : hMax === 5 ? 'multi' : 'single';
      if (fixed) {
        dMin = dMax = mult === 0 ? 0 : fixed(member.level);
        myModels.push({ key: move.key, model: { rolls: [], fixed: dMin, accuracy: move.accuracy, hits: hitsKind }, cadence: cadenceOf(move.effect), oneShot: isOneShot(move.effect) });
      } else {
        const physical = move.category === 'physical';
        let atk = badgeBoost(physical ? 'atk' : 'spa', physical ? member.stats.atk : member.stats.spa, badges);
        // Intimidate do oponente baixa um estágio do Ataque ao entrar em campo.
        if (physical && opponent.ability === 'intimidate') atk = applyStage(atk, -1);
        const typeMults = opponent.species.types.map((t) => chart.multiplier(move.type, t));
        const eff = mult === 0 ? [0] : typeMults;
        const thick = mu.damageModifier < 1 ? mu.damageModifier : 1;
        const lowRoll = gen3Damage({
          level: member.level, power: move.power!, attack: Math.floor(atk * thick),
          defense: physical ? opp.high.def : opp.high.spd, stab: !!mu.stab, typeMultipliers: eff,
        });
        const highRoll = gen3Damage({
          level: member.level, power: move.power!, attack: Math.floor(atk * thick),
          defense: physical ? opp.low.def : opp.low.spd, stab: !!mu.stab, typeMultipliers: eff,
        });
        dMin = lowRoll.min;
        dMax = highRoll.max;
        const midRoll = gen3Damage({
          level: member.level, power: move.power!, attack: Math.floor(atk * thick),
          defense: physical ? opp.mid.def : opp.mid.spd, stab: !!mu.stab, typeMultipliers: eff,
        });
        myModels.push({ key: move.key, model: { rolls: midRoll.rolls, accuracy: move.accuracy, hits: hitsKind }, cadence: cadenceOf(move.effect), oneShot: isOneShot(move.effect) });
      }
      const est: MoveEstimate = {
        moveKey: move.key,
        multiplier: mult,
        abilityDependent: !!mu.byAbility,
        stab: !!mu.stab,
        pctMin: pct(dMin * hMin, opp.high.hp),
        pctMax: pct(dMax * hMax, opp.low.hp),
        ko: 'none',
      };
      est.ko = koChance(est.pctMin, est.pctMax);
      estimates.push(est);
      if (!best || est.pctMin > best.pctMin || (est.pctMin === best.pctMin && est.pctMax > best.pctMax)) best = est;
    }

    // Defesa: pior golpe do oponente contra o HP atual do membro.
    let threat: MoveEstimate | null = null;
    for (const move of opponent.moves) {
      const fixed = FIXED_DAMAGE[move.effect];
      if (!move.power && !fixed) continue;
      if (move.power === 1 && !fixed) continue;
      const mu = matchup(chart, move, member.species, { attackerTypes: opponent.species.types });
      const [hMin, hMax] = hitsOf(move);
      let dMin: number;
      let dMax: number;
      const theirHits: AttackModel['hits'] = hMax === 2 ? 'double' : hMax === 5 ? 'multi' : 'single';
      if (fixed) {
        dMin = dMax = mu.multiplier === 0 ? 0 : fixed(opponent.level);
        theirModels.push({ key: move.key, model: { rolls: [], fixed: dMin, accuracy: move.accuracy, hits: theirHits }, cadence: cadenceOf(move.effect), oneShot: isOneShot(move.effect) });
      } else {
        const physical = move.category === 'physical';
        const def = badgeBoost(physical ? 'def' : 'spd', physical ? member.stats.def : member.stats.spd, badges);
        const eff = member.species.types.map((t) => chart.multiplier(move.type, t));
        const lo = gen3Damage({ level: opponent.level, power: move.power!, attack: physical ? opp.low.atk : opp.low.spa, defense: def, stab: !!mu.stab, typeMultipliers: mu.multiplier === 0 ? [0] : eff });
        const hi = gen3Damage({ level: opponent.level, power: move.power!, attack: physical ? opp.high.atk : opp.high.spa, defense: def, stab: !!mu.stab, typeMultipliers: mu.multiplier === 0 ? [0] : eff });
        dMin = lo.min;
        dMax = hi.max;
        const mid = gen3Damage({ level: opponent.level, power: move.power!, attack: physical ? opp.mid.atk : opp.mid.spa, defense: def, stab: !!mu.stab, typeMultipliers: mu.multiplier === 0 ? [0] : eff });
        theirModels.push({ key: move.key, model: { rolls: mid.rolls, accuracy: move.accuracy, hits: theirHits }, cadence: cadenceOf(move.effect), oneShot: isOneShot(move.effect) });
      }
      const est: MoveEstimate = {
        moveKey: move.key,
        multiplier: mu.multiplier,
        abilityDependent: false,
        stab: !!mu.stab,
        pctMin: pct(dMin * hMin, member.hp.current),
        pctMax: pct(dMax * hMax, member.hp.current),
        ko: 'none',
      };
      est.ko = koChance(est.pctMin, est.pctMax);
      if (!threat || est.pctMax > threat.pctMax) threat = est;
    }

    // Velocidade: faixa do oponente (IV 0–31) contra a velocidade efetiva do membro.
    const mySpeed = effectiveSpeed(member.stats.spe, { badges, paralyzed: member.status === 'paralysis' });
    const speed = mySpeed > opp.high.spe ? 'faster' : mySpeed < opp.low.spe ? 'slower' : mySpeed === opp.low.spe && opp.low.spe === opp.high.spe ? 'tie' : 'unknown';

    if (member.status === 'sleep') notes.push('dormindo');
    if (member.status === 'paralysis') notes.push('paralisado');
    if (best?.abilityDependent) notes.push('efetividade depende da habilidade do oponente');
    if (opponent.ability === 'intimidate' && best && lookupCategory(member, best.moveKey) === 'physical') notes.push('Intimidate reduz seu Ataque');
    if (!best) notes.push('sem golpe de dano utilizável');

    // Duelo: meu golpe que maximiza a chance de vencer contra o pior golpe do oponente.
    const order = speed === 'faster' ? 'me' : speed === 'slower' ? 'them' : 'unknown';
    const myDelay = member.status === 'sleep' ? SLEEP_DELAY : member.status === 'freeze' ? FREEZE_DELAY : 0;
    const timing = { order, myDelay, theirFreeAttacks: opts.theirFreeAttacks ?? 0 } as const;
    // Explosion do oponente: se não me nocautear, ele desmaia (conta como chance dele, não ameaça contínua).
    const theirCdfs = theirModels.map((t) => ({
      key: t.key,
      cadence: t.cadence,
      cdf: koCdf(attackDistribution(t.model, member.hp.current), member.hp.current, 10, t.oneShot),
    }));
    if (!theirCdfs.length) theirCdfs.push({ key: '', cadence: 'normal', cdf: new Array(11).fill(0) });
    let duel: DuelResult = { winProb: 0, moveKey: null, theirMoveKey: null };
    for (const mine of myModels) {
      const cdf = koCdf(attackDistribution(mine.model, opp.mid.hp), opp.mid.hp, 10, mine.oneShot);
      let worst = { p: 1, key: '' };
      for (const t of theirCdfs) {
        const p = duelWinProbability(cdf, t.cdf, { ...timing, myCadence: mine.cadence, theirCadence: t.cadence, myOneShot: mine.oneShot });
        if (p < worst.p) worst = { p, key: t.key };
      }
      // Empate na chance de vencer: fica o golpe com mais dano garantido.
      const dmg = (k: string | null) => estimates.find((e) => e.moveKey === k)?.pctMin ?? 0;
      const better = worst.p > duel.winProb + 1e-9 || (Math.abs(worst.p - duel.winProb) <= 1e-9 && dmg(mine.key) > dmg(duel.moveKey));
      if (better || !duel.moveKey) duel = { winProb: worst.p, moveKey: mine.key, theirMoveKey: worst.key || null };
    }
    // O golpe exibido é o que maximiza a chance de vencer, não só o de maior dano.
    best = estimates.find((e) => e.moveKey === duel.moveKey) ?? best;
    if (myDelay) notes.push(`considera ${myDelay} turnos sem agir`);
    const score = Math.round(duel.winProb * 100 * 100) / 100 + Math.min(best?.pctMin ?? 0, 100) / 1000;
    return { memberId: member.id, best, threat, speed, duel, score, notes };
}

export type ActiveAdvice =
  | { kind: 'stay'; stay: MemberAssessment; alternative: MemberAssessment | null }
  | { kind: 'switch'; stay: MemberAssessment; to: MemberAssessment }
  /** Nem ficar nem trocar vence sozinho (< 50%): melhor curar, desgastar ou fugir/trocar estrategicamente. */
  | { kind: 'none'; stay: MemberAssessment; bestSwitch: MemberAssessment | null };

/**
 * Com um Pokémon em campo: ficar e atacar, ou trocar? Quem entra por troca leva um ataque livre.
 * Troca só para uma opção que vence (≥ 50%) e que melhora pelo menos 15 pontos, ou quando ficar
 * é quase certamente perder (< 25%). Se nada vence, diz isso em vez de indicar uma troca ruim.
 */
export function adviseActive(
  chart: TypeChart,
  team: readonly TeamMember[],
  activeId: string,
  opponent: Opponent,
  badges: readonly string[],
): ActiveAdvice | null {
  const active = team.find((m) => m.id === activeId);
  if (!active) return null;
  const stay = assessMember(chart, active, opponent, badges);
  const switches = team
    .filter((m) => m.id !== activeId && m.hp.current > 0)
    .map((m) => assessMember(chart, m, opponent, badges, { theirFreeAttacks: 1 }))
    .sort((a, b) => b.score - a.score);
  const to = switches[0] ?? null;
  const a = stay.duel.winProb;
  const b = to?.duel.winProb ?? 0;
  if (to && b >= 0.5 && (b >= a + 0.15 || a < 0.25)) return { kind: 'switch', stay, to };
  if (a < 0.5 && b < 0.5) return { kind: 'none', stay, bestSwitch: to };
  return { kind: 'stay', stay, alternative: to };
}

function lookupCategory(member: TeamMember, moveKey: string) {
  return member.moves.find((m) => m.move.key === moveKey)?.move.category;
}
