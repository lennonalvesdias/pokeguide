// Onde treinar: XP por luta contra selvagens que o membro vence com folga (Gen III, Cmd_getexp).
import { assessMember, type Opponent, type TeamMember } from './battle.ts';
import { expectedHpLoss } from './copilot.ts';
import type { TypeChart } from './matchup.ts';

/** XP de um selvagem derrotado por um único participante: floor(expYield × nível / 7); trocado ou Lucky Egg ×1,5. */
export function wildExp(expYield: number, level: number, boost = false): number {
  const base = Math.floor((expYield * level) / 7);
  return boost ? Math.floor((base * 150) / 100) : base;
}

/** XP que falta para o próximo nível (tabelas gExperienceTables). */
export function expToNextLevel(table: readonly number[], level: number, experience: number): number | null {
  if (level >= 100) return null;
  return Math.max(0, table[level + 1]! - experience);
}

export interface TrainingSpotInput {
  /** Rótulo do lugar (ex.: "PokemonMansion · land"). */
  key: string;
  slots: Array<{ opponent: Opponent; rate: number }>;
}

export interface TrainingSpot {
  key: string;
  /** XP média por luta, ponderada pela chance de encontro. */
  expPerBattle: number;
  winRate: number;
  hpLoss: number;
}

/**
 * Lugares em que o membro vence com folga (≥ 90% em média, nenhum encontro abaixo de 50%,
 * perdendo no máximo metade do HP por luta), ordenados pela XP por luta.
 */
export function trainingSpots(
  chart: TypeChart,
  member: TeamMember,
  spots: readonly TrainingSpotInput[],
  badges: readonly string[],
  opts: { boost?: boolean } = {},
): TrainingSpot[] {
  const out: TrainingSpot[] = [];
  for (const s of spots) {
    const total = s.slots.reduce((t, x) => t + x.rate, 0);
    if (!total) continue;
    let exp = 0;
    let win = 0;
    let loss = 0;
    let unsafe = false;
    for (const { opponent, rate } of s.slots) {
      const a = assessMember(chart, member, opponent, badges);
      if (a.duel.winProb < 0.5) unsafe = true;
      exp += (rate / total) * wildExp(opponent.species.expYield ?? 0, opponent.level, opts.boost);
      win += (rate / total) * a.duel.winProb;
      loss += (rate / total) * expectedHpLoss(a);
    }
    if (unsafe || win < 0.9 || loss > 0.5) continue;
    out.push({ key: s.key, expPerBattle: Math.round(exp), winRate: win, hpLoss: loss });
  }
  return out.sort((a, b) => b.expPerBattle - a.expPerBattle);
}
