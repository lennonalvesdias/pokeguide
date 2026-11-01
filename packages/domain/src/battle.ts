// Ranking da equipe contra um adversário (ADR-004, modo rápido com estimativa de dano).
import { badgeBoost, effectiveSpeed, gen3Damage, gen3Hp, gen3Stat } from './damage.ts';
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

export interface MemberAssessment {
  memberId: string;
  best: MoveEstimate | null;
  threat: MoveEstimate | null;
  speed: 'faster' | 'slower' | 'tie' | 'unknown';
  score: number;
  notes: string[];
}

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
  const at = (iv: number) => ({
    hp: gen3Hp(b.hp, o.level, iv),
    atk: gen3Stat(b.atk, o.level, iv),
    def: gen3Stat(b.def, o.level, iv),
    spa: gen3Stat(b.spa, o.level, iv),
    spd: gen3Stat(b.spd, o.level, iv),
    spe: gen3Stat(b.spe, o.level, iv),
  });
  return { low: at(ivs[0]!), high: at(ivs[1]!) };
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

export function assessTeam(
  chart: TypeChart,
  team: readonly TeamMember[],
  opponent: Opponent,
  badges: readonly string[],
): MemberAssessment[] {
  const opp = opponentStats(opponent);
  const results = team.map((member): MemberAssessment => {
    const notes: string[] = [];
    if (member.hp.current === 0) {
      return { memberId: member.id, best: null, threat: null, speed: 'unknown', score: -1000, notes: ['desmaiado'] };
    }

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
      if (fixed) {
        dMin = dMax = mult === 0 ? 0 : fixed(member.level);
      } else {
        const physical = move.category === 'physical';
        const atk = badgeBoost(physical ? 'atk' : 'spa', physical ? member.stats.atk : member.stats.spa, badges);
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
      if (fixed) {
        dMin = dMax = mu.multiplier === 0 ? 0 : fixed(opponent.level);
      } else {
        const physical = move.category === 'physical';
        const def = badgeBoost(physical ? 'def' : 'spd', physical ? member.stats.def : member.stats.spd, badges);
        const eff = member.species.types.map((t) => chart.multiplier(move.type, t));
        const lo = gen3Damage({ level: opponent.level, power: move.power!, attack: physical ? opp.low.atk : opp.low.spa, defense: def, stab: !!mu.stab, typeMultipliers: mu.multiplier === 0 ? [0] : eff });
        const hi = gen3Damage({ level: opponent.level, power: move.power!, attack: physical ? opp.high.atk : opp.high.spa, defense: def, stab: !!mu.stab, typeMultipliers: mu.multiplier === 0 ? [0] : eff });
        dMin = lo.min;
        dMax = hi.max;
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
    if (!best) notes.push('sem golpe de dano utilizável');

    // Dormindo ou congelado: não age neste turno, então ser mais rápido não ajuda.
    const canAct = member.status !== 'sleep' && member.status !== 'freeze';
    const actsFirst = canAct && speed === 'faster';
    const off = Math.min(best?.pctMin ?? 0, 100);
    const def = Math.min(threat?.pctMax ?? 0, 100);
    let score = off - 0.6 * def;
    if (actsFirst) score += 15;
    if (best?.ko === 'guaranteed' && actsFirst) score += 25;
    if (threat?.ko === 'guaranteed' && !actsFirst) score -= 60;
    if (!canAct) score -= 40;
    return { memberId: member.id, best, threat, speed, score: Math.round(score), notes };
  });
  return results.sort((a, b) => b.score - a.score);
}
