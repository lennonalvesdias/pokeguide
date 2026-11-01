// Cálculo de dano e stats de Gen III, conferido contra pret/pokefirered:
// CalculateBaseDamage (src/pokemon.c), ModulateDmgByType e ApplyRandomDmgMultiplier
// (src/battle_script_commands.c), ordem de turno (src/battle_main.c).

export type Badge = 'boulder' | 'cascade' | 'thunder' | 'rainbow' | 'soul' | 'marsh' | 'volcano' | 'earth';

/** Bônus de 10% que as insígnias dão ao lado do jogador (nunca ao oponente). */
export function badgeBoost(stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', value: number, badges: readonly string[]): number {
  const badge = { atk: 'boulder', def: 'soul', spa: 'volcano', spd: 'volcano', spe: 'thunder' }[stat];
  return badges.includes(badge) ? Math.floor((value * 110) / 100) : value;
}

const NATURE_ORDER = [
  'hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax',
  'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash',
  'calm', 'gentle', 'sassy', 'careful', 'quirky',
];
const NATURE_STATS = ['atk', 'def', 'spe', 'spa', 'spd'] as const;
export type NonHpStat = (typeof NATURE_STATS)[number];

/** Multiplicador da natureza (Gen III): índice/5 sobe, índice%5 desce; iguais = neutra. */
export function natureModifier(nature: string | null | undefined, stat: NonHpStat): number {
  const i = nature ? NATURE_ORDER.indexOf(nature) : -1;
  if (i < 0) return 1;
  const up = NATURE_STATS[Math.floor(i / 5)];
  const down = NATURE_STATS[i % 5];
  if (up === down) return 1;
  return stat === up ? 1.1 : stat === down ? 0.9 : 1;
}

/** Stat de Gen III: floor((floor((2B + IV + EV/4) × L / 100) + 5) × natureza). */
export function gen3Stat(base: number, level: number, iv: number, ev = 0, nature?: string | null, stat?: NonHpStat): number {
  const raw = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  if (!stat) return raw;
  // Aritmética inteira, como ModifyStatByNature (src/pokemon.c): n × 110 / 100 ou n × 90 / 100.
  const mod = natureModifier(nature, stat);
  return mod > 1 ? Math.floor((raw * 110) / 100) : mod < 1 ? Math.floor((raw * 90) / 100) : raw;
}

/** Estágio de stat em Gen III (-6..+6): -1 = 10/15. */
export function applyStage(value: number, stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return s >= 0 ? Math.floor((value * (10 + 5 * s)) / 10) : Math.floor((value * 10) / (10 - 5 * s));
}

export function gen3Hp(base: number, level: number, iv: number, ev = 0): number {
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

export interface DamageInput {
  level: number;
  power: number;
  /** Stat de ataque efetivo (já com insígnia, Thick Fat etc.). */
  attack: number;
  defense: number;
  stab: boolean;
  /** Multiplicador de cada tipo do defensor, na ordem: ex. [2, 2] para 4×. */
  typeMultipliers: readonly number[];
}

export interface DamageRange {
  min: number;
  max: number;
  /** As 16 rolagens possíveis (fator 85% a 100%). */
  rolls: number[];
}

/** Dano de um golpe sem crítico, clima ou modificadores de campo. */
export function gen3Damage(i: DamageInput): DamageRange {
  if (i.typeMultipliers.some((m) => m === 0)) return { min: 0, max: 0, rolls: new Array(16).fill(0) };
  const levelFactor = Math.floor((2 * i.level) / 5) + 2;
  let base = Math.floor(Math.floor((i.attack * i.power * levelFactor) / i.defense) / 50);
  if (base === 0) base = 1;
  base += 2;
  if (i.stab) base = Math.floor((base * 15) / 10);
  for (const m of i.typeMultipliers) {
    if (m === 1) continue;
    base = Math.floor((base * m * 10) / 10);
    if (base === 0) base = 1;
  }
  const rolls: number[] = [];
  for (let r = 85; r <= 100; r++) rolls.push(Math.max(1, Math.floor((base * r) / 100)));
  return { min: rolls[0]!, max: rolls[15]!, rolls };
}

/** Velocidade efetiva para ordem de turno. */
export function effectiveSpeed(speed: number, opts: { badges?: readonly string[]; paralyzed?: boolean }): number {
  let s = opts.badges ? badgeBoost('spe', speed, opts.badges) : speed;
  if (opts.paralyzed) s = Math.floor(s / 4);
  return s;
}
