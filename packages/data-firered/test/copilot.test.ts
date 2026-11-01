// Copiloto: com quem abrir as lutas de um lugar. Golden cases com a equipe real (6 insígnias), curada.
import { createTypeChart, healed, planArea, type TeamMember } from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { areaTrainers, areaWildOpponents, lookup, trainerOpponent, typeChart } from '../src/index.ts';

const chart = createTypeChart(typeChart);
const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
const member = (key: string, level: number, hp: number, stats: TeamMember['stats'], moves: string[]): TeamMember => ({
  id: key, name: key, species: lookup.species(key), level, stats, hp: { current: hp, max: hp }, status: null,
  moves: moves.map((m) => ({ move: lookup.move(m) })),
});
const TEAM = healed([
  member('gyarados', 32, 107, { atk: 91, def: 58, spe: 63, spa: 53, spd: 74 }, ['ice_beam', 'dragon_rage', 'bite', 'surf']),
  member('jolteon', 36, 100, { atk: 62, def: 47, spe: 100, spa: 100, spd: 75 }, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
  member('snorlax', 38, 178, { atk: 92, def: 66, spe: 33, spa: 62, spd: 91 }, ['body_slam', 'sleep_talk', 'rest', 'strength']),
  member('charizard', 40, 116, { atk: 75, def: 73, spe: 99, spa: 101, spd: 79 }, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
  member('dugtrio', 32, 66, { atk: 64, def: 38, spe: 87, spa: 46, spd: 51 }, ['dig', 'cut', 'rock_slide', 'sand_tomb']),
  member('kadabra', 38, 90, { atk: 44, def: 35, spe: 100, spa: 111, spd: 54 }, ['reflect', 'recover', 'psychic', 'flash']),
]);
const trainerOpps = (areas: string[]) =>
  areaTrainers(areas, new Set(), 'squirtle').flatMap((t) => t.party.map((p) => ({ opponent: trainerOpponent(p), weight: 1 })));

describe('copiloto', () => {
  it('healed cura HP e status', () => {
    const [g] = healed([{ ...TEAM[0]!, hp: { current: 60, max: 107 }, status: 'sleep' }]);
    expect(g!.hp.current).toBe(107);
    expect(g!.status).toBeNull();
  });
  it('Pokémon Mansion (selvagens): Charizard abre, vencendo todos e perdendo pouco HP', () => {
    const plan = planArea(chart, TEAM, areaWildOpponents(['PokemonMansion'], new Set()), BADGES);
    expect(plan.leads[0]!.memberId).toBe('charizard');
    expect(plan.leads[0]!.wins).toBe(plan.leads[0]!.total);
    expect(plan.leads[0]!.hpLoss).toBeLessThan(0.15);
  });
  it('Cinnabar Island (treinadores, incluindo o ginásio): o Arcanine do Blaine é a ameaça', () => {
    const plan = planArea(chart, TEAM, trainerOpps(['CinnabarIsland']), BADGES);
    expect(plan.threats.map((t) => `${t.opponent.species.key}${t.opponent.level}`)).toEqual(['arcanine47']);
  });
  it('varas só contam com a vara na bolsa', () => {
    const without = areaWildOpponents(['Route21'], new Set());
    const withRods = areaWildOpponents(['Route21'], new Set(['old_rod', 'good_rod', 'super_rod']));
    expect(withRods.length).toBeGreaterThan(without.length);
  });
});
