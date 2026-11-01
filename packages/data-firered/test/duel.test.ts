// Golden cases do duelo por turnos (precisão, crítico, múltiplos acertos, ritmo e troca).
import {
  adviseActive,
  assessTeam,
  attackDistribution,
  createTypeChart,
  duelWinProbability,
  koCdf,
  type TeamMember,
  wildMoveset,
} from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { lookup, trainers, typeChart } from '../src/index.ts';

const flat = (d: number) => new Array(16).fill(d);
const cdfOf = (dmg: number, hp: number, accuracy: number | null = 100) =>
  koCdf(attackDistribution({ rolls: flat(dmg), accuracy, hits: 'single' }, hp), hp);

describe('distribuição de um ataque', () => {
  it('crítico em 1/16 dobra o dano; erro vira dano 0', () => {
    const d = attackDistribution({ rolls: flat(10), accuracy: 50, hits: 'single' }, 999);
    const p = new Map(d);
    expect(p.get(0)).toBeCloseTo(0.5);
    expect(p.get(10)).toBeCloseTo(0.5 * (15 / 16));
    expect(p.get(20)).toBeCloseTo(0.5 * (1 / 16));
  });
  it('múltiplos acertos: 2–5 com 3/8, 3/8, 1/8, 1/8 (Cmd_setmultihitcounter)', () => {
    const d = new Map(attackDistribution({ rolls: [], fixed: 10, accuracy: null, hits: 'multi' }, 999));
    expect(d.get(20)).toBeCloseTo(3 / 8);
    expect(d.get(30)).toBeCloseTo(3 / 8);
    expect(d.get(40)).toBeCloseTo(1 / 8);
    expect(d.get(50)).toBeCloseTo(1 / 8);
  });
});

describe('probabilidade de vencer', () => {
  it('nocaute garantido agindo primeiro = 100%', () => {
    expect(duelWinProbability(cdfOf(100, 50), cdfOf(100, 50), { order: 'me' })).toBe(1);
  });
  it('golpe de 50% de precisão que nocauteia, contra quem precisa de 3 golpes: 1 − 0,5³ = 87,5%', () => {
    // Meu golpe: 50% de precisão, nocauteia (dano fixo, sem crítico). Oponente: 3 golpes certos.
    const mine = koCdf(attackDistribution({ rolls: [], fixed: 100, accuracy: 50, hits: 'single' }, 100), 100);
    const theirs = koCdf(attackDistribution({ rolls: [], fixed: 34, accuracy: null, hits: 'single' }, 100), 100);
    expect(duelWinProbability(mine, theirs, { order: 'me' })).toBeCloseTo(0.875);
    expect(duelWinProbability(mine, theirs, { order: 'them' })).toBeCloseTo(0.75);
  });
  it('golpe de carga (Solar Beam) dá um ataque a mais ao oponente', () => {
    const mine = koCdf(attackDistribution({ rolls: [], fixed: 100, accuracy: null, hits: 'single' }, 100), 100);
    const theirs = koCdf(attackDistribution({ rolls: [], fixed: 50, accuracy: null, hits: 'single' }, 100), 100);
    expect(duelWinProbability(mine, theirs, { order: 'me' })).toBe(1);
    expect(duelWinProbability(mine, theirs, { order: 'me', myCadence: 'charge' })).toBe(1); // leva 1 golpe de 50
    const theirs2 = koCdf(attackDistribution({ rolls: [], fixed: 100, accuracy: null, hits: 'single' }, 100), 100);
    expect(duelWinProbability(mine, theirs2, { order: 'me', myCadence: 'charge' })).toBe(0);
  });
  it('quem entra por troca leva um ataque livre', () => {
    const mine = koCdf(attackDistribution({ rolls: [], fixed: 50, accuracy: null, hits: 'single' }, 100), 100);
    const theirs = koCdf(attackDistribution({ rolls: [], fixed: 50, accuracy: null, hits: 'single' }, 100), 100);
    expect(duelWinProbability(mine, theirs, { order: 'me' })).toBe(1);
    expect(duelWinProbability(mine, theirs, { order: 'me', theirFreeAttacks: 1 })).toBe(0);
  });
});

const chart = createTypeChart(typeChart);
const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
const member = (key: string, level: number, stats: TeamMember['stats'], hp: number, moves: string[]): TeamMember => ({
  id: key, name: key, species: lookup.species(key), level, stats, hp: { current: hp, max: hp }, status: null,
  moves: moves.map((m) => ({ move: lookup.move(m) })),
});
// Equipe representativa de meio de jogo (6 insígnias).
const TEAM = [
  member('jolteon', 36, { atk: 62, def: 47, spa: 100, spd: 75, spe: 100 }, 100, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
  member('snorlax', 38, { atk: 92, def: 66, spa: 62, spd: 91, spe: 33 }, 178, ['body_slam', 'sleep_talk', 'rest', 'strength']),
  member('charizard', 40, { atk: 75, def: 73, spa: 101, spd: 79, spe: 99 }, 116, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
  member('dugtrio', 32, { atk: 64, def: 38, spa: 46, spd: 51, spe: 87 }, 66, ['dig', 'cut', 'rock_slide', 'sand_tomb']),
];
const blaine = (i: number) => {
  const p = trainers.find((t) => t.key === 'leader_blaine')!.party[i]!;
  const sp = lookup.species(p.species);
  return { species: sp, level: p.level, iv: p.iv, nature: p.nature, ...(p.ability ? { ability: p.ability } : {}), moves: (p.moves ?? wildMoveset(sp, p.level)).map((m) => lookup.move(m)) };
};

describe('duelo contra o Blaine', () => {
  it('Dugtrio contra Growlithe perde para o Fire Blast apesar do Dig 2×', () => {
    const d = assessTeam(chart, TEAM, blaine(0), BADGES).find((a) => a.memberId === 'dugtrio')!;
    expect(d.duel.winProb).toBeLessThan(0.4);
    expect(d.duel.theirMoveKey).toBe('fire_blast');
  });
  it('contra o Growlithe, o melhor da equipe vence com mais de 90%', () => {
    expect(assessTeam(chart, TEAM, blaine(0), BADGES)[0]!.duel.winProb).toBeGreaterThan(0.9);
  });
  it('Arcanine Nv 47: ninguém dessa equipe vence sozinho com segurança (< 50%)', () => {
    for (const a of assessTeam(chart, TEAM, blaine(3), BADGES)) expect(a.duel.winProb, a.memberId).toBeLessThan(0.5);
  });
  it('Dugtrio em campo contra o Growlithe: o conselho é trocar', () => {
    const adv = adviseActive(chart, TEAM, 'dugtrio', blaine(0), BADGES)!;
    expect(adv.kind).toBe('switch');
  });
  it('Dugtrio em campo contra o Arcanine: nada vence sozinho, então não indica troca', () => {
    expect(adviseActive(chart, TEAM, 'dugtrio', blaine(3), BADGES)!.kind).toBe('none');
  });
  it('Jolteon em campo contra o Growlithe: o conselho é ficar e usar Thunderbolt', () => {
    const adv = adviseActive(chart, TEAM, 'jolteon', blaine(0), BADGES)!;
    expect(adv.kind).toBe('stay');
    expect(adv.stay.duel.moveKey).toBe('thunderbolt');
  });
});
