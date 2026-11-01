// Efetividade de tipos e imunidades por habilidade em Gen III.
import type { MoveCategory, MoveDefinition, SpeciesDefinition, TypeChartEntry, TypeName } from './types.ts';

export interface TypeChart {
  multiplier(attack: TypeName, defend: TypeName, opts?: { foresight?: boolean }): number;
}

export function createTypeChart(entries: readonly TypeChartEntry[]): TypeChart {
  const table = new Map<string, TypeChartEntry>();
  for (const e of entries) table.set(`${e.attack}>${e.defend}`, e);
  return {
    multiplier(attack, defend, opts = {}) {
      const e = table.get(`${attack}>${defend}`);
      if (!e) return 1;
      if (e.removedByForesight && opts.foresight) return 1;
      return e.multiplier;
    },
  };
}

/** Gen III: a categoria depende só do tipo. Tipos antes de `???` são físicos. */
const PHYSICAL_TYPES: ReadonlySet<TypeName> = new Set([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
]);
export function gen3Category(type: TypeName, power: number | null): MoveCategory {
  if (!power) return 'status';
  return PHYSICAL_TYPES.has(type) ? 'physical' : 'special';
}

const SOUND_MOVES: ReadonlySet<string> = new Set([
  'growl', 'roar', 'sing', 'supersonic', 'screech', 'snore', 'uproar', 'metal_sound',
  'grass_whistle', 'hyper_voice', 'perish_song',
]);

export interface AbilityEffect {
  multiplier: number;
  damageModifier: number;
  immuneByAbility: boolean;
}

/** Efeito de uma habilidade defensiva sobre um golpe. Lightning Rod NÃO dá imunidade em Gen III. */
export function defensiveAbilityEffect(
  ability: string | undefined,
  move: MoveDefinition,
  typeMultiplier: number,
): AbilityEffect {
  const none = { multiplier: typeMultiplier, damageModifier: 1, immuneByAbility: false };
  if (!ability || typeMultiplier === 0) return none;
  const immune = { multiplier: 0, damageModifier: 1, immuneByAbility: true };
  switch (ability) {
    case 'levitate':
      return move.type === 'ground' ? immune : none;
    case 'flash_fire':
      return move.type === 'fire' ? immune : none;
    case 'volt_absorb':
      return move.type === 'electric' ? immune : none;
    case 'water_absorb':
      return move.type === 'water' ? immune : none;
    case 'soundproof':
      return SOUND_MOVES.has(move.key) ? immune : none;
    case 'wonder_guard':
      // Só golpes de dano super efetivos acertam. Golpes de status passam.
      return move.category !== 'status' && typeMultiplier <= 1 ? immune : none;
    case 'thick_fat':
      return move.type === 'fire' || move.type === 'ice' ? { ...none, damageModifier: 0.5 } : none;
    default:
      return none;
  }
}

export interface MatchupResult {
  /** Multiplicador só pelos tipos. */
  typeMultiplier: number;
  /** Multiplicador final quando a habilidade é conhecida ou não muda o resultado. */
  multiplier: number;
  immunity: 'type' | 'ability' | null;
  /** Presente quando a habilidade é desconhecida e o resultado depende dela. */
  byAbility?: Array<{ ability: string } & AbilityEffect>;
  range: { min: number; max: number };
  damageModifier: number;
  stab?: boolean;
}

export function matchup(
  chart: TypeChart,
  move: MoveDefinition,
  defender: Pick<SpeciesDefinition, 'types' | 'abilities'>,
  opts: { ability?: string; foresight?: boolean; attackerTypes?: readonly TypeName[] } = {},
): MatchupResult {
  const typeMultiplier = defender.types.reduce(
    (acc, t) => acc * chart.multiplier(move.type, t, opts.foresight ? { foresight: true } : {}),
    1,
  );
  const candidates = opts.ability ? [opts.ability] : defender.abilities.length ? defender.abilities : [undefined];
  const effects = candidates.map((a) => ({ ability: a ?? 'none', ...defensiveAbilityEffect(a, move, typeMultiplier) }));
  const mults = effects.map((e) => e.multiplier * e.damageModifier);
  const min = Math.min(...mults);
  const max = Math.max(...mults);
  const uniform = effects.every((e) => e.multiplier === effects[0]!.multiplier && e.damageModifier === effects[0]!.damageModifier);
  const first = effects[0]!;
  const result: MatchupResult = {
    typeMultiplier,
    multiplier: uniform ? first.multiplier : typeMultiplier,
    immunity: typeMultiplier === 0 ? 'type' : uniform && first.immuneByAbility ? 'ability' : null,
    range: { min, max },
    damageModifier: uniform ? first.damageModifier : 1,
  };
  if (!uniform) result.byAbility = effects;
  if (opts.attackerTypes) result.stab = opts.attackerTypes.includes(move.type);
  return result;
}
