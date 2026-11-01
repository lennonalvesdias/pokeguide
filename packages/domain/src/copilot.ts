// Copiloto: com quem abrir as lutas de um lugar, olhando todos os adversários de lá de uma vez.
import { assessMember, type MemberAssessment, type Opponent, type TeamMember } from './battle.ts';
import type { TypeChart } from './matchup.ts';

export interface AreaOpponent {
  opponent: Opponent;
  /** Peso na média (ex.: chance de encontro do selvagem). */
  weight: number;
}

export interface LeadPick {
  memberId: string;
  /** Chance média de vencer o duelo, ponderada pelos pesos (0–1). */
  winRate: number;
  /** Quantos adversários ele vence com 50% ou mais. */
  wins: number;
  total: number;
  /** HP perdido por luta, em média ponderada (fração do HP máximo). */
  hpLoss: number;
}

export interface AreaPlan {
  leads: LeadPick[];
  /** Adversários que ninguém da equipe vence com segurança (< 50%). */
  threats: Array<{ opponent: Opponent; best: { memberId: string; winProb: number } | null }>;
}

/** Equipe como depois de um Pokémon Center: planejamento não depende do HP do último save. */
export function healed(team: readonly TeamMember[]): TeamMember[] {
  return team.map((m) => ({ ...m, hp: { current: m.hp.max, max: m.hp.max }, status: null, moves: m.moves.map((x) => ({ move: x.move })) }));
}

/**
 * HP que o membro perde até nocautear: golpes do oponente antes do nocaute × dano médio do pior golpe dele.
 * Aproximação para comparar quem passa por um lugar gastando menos.
 */
export function expectedHpLoss(a: MemberAssessment): number {
  if (!a.best || a.best.pctMin <= 0) return 1;
  const avgDealt = (a.best.pctMin + a.best.pctMax) / 2;
  const myTurns = Math.ceil(100 / Math.max(avgDealt, 1));
  const theirHits = a.speed === 'faster' ? myTurns - 1 : myTurns;
  const taken = a.threat ? (a.threat.pctMin + a.threat.pctMax) / 2 : 0;
  return Math.min(1, (theirHits * taken) / 100);
}

/**
 * Quem abre melhor as lutas de um lugar: maior chance média de vencer, descontando metade do HP
 * que costuma perder (vencer todas gastando pouco é melhor que vencer todas no limite).
 */
export function planArea(chart: TypeChart, team: readonly TeamMember[], opponents: readonly AreaOpponent[], badges: readonly string[]): AreaPlan {
  const totalWeight = opponents.reduce((s, o) => s + o.weight, 0) || 1;
  const grid = opponents.map((o) => team.map((m) => assessMember(chart, m, o.opponent, badges)));
  const avg = (j: number, f: (a: MemberAssessment) => number) => opponents.reduce((s, o, i) => s + o.weight * f(grid[i]![j]!), 0) / totalWeight;
  const leads = team
    .map((m, j) => ({
      memberId: m.id,
      winRate: avg(j, (a) => a.duel.winProb),
      hpLoss: avg(j, expectedHpLoss),
      wins: grid.filter((row) => row[j]!.duel.winProb >= 0.5).length,
      total: opponents.length,
    }))
    .sort((a, b) => b.winRate - 0.5 * b.hpLoss - (a.winRate - 0.5 * a.hpLoss));
  const threats = opponents
    .map((o, i) => {
      const row = grid[i]!.map((a) => a.duel.winProb);
      const j = row.indexOf(Math.max(...row));
      return { opponent: o.opponent, best: j >= 0 ? { memberId: team[j]!.id, winProb: row[j]! } : null };
    })
    .filter((t) => !t.best || t.best.winProb < 0.5);
  return { leads, threats };
}
