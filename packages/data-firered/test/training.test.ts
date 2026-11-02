// Onde treinar, XP e melhor combinação de golpes. Golden cases com a equipe real (6 insígnias), curada.
import { bestMoveset, createTypeChart, expToNextLevel, healed, type TeamMember, trainingSpots, wildExp } from '@pokeguide/domain';
import { parseSave } from '@pokeguide/save-parser';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup, machines, rules, species, trainingSpotInputs, typeChart, upcomingOpponents } from '../src/index.ts';

const chart = createTypeChart(typeChart);
const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
const member = (key: string, level: number, hp: number, stats: TeamMember['stats'], moves: string[]): TeamMember => ({
  id: key, name: key, species: lookup.species(key), level, stats, hp: { current: hp, max: hp }, status: null,
  moves: moves.map((m) => ({ move: lookup.move(m) })),
});
const [gyarados, , snorlax, , dugtrio, kadabra] = healed([
  member('gyarados', 32, 107, { atk: 91, def: 58, spe: 63, spa: 53, spd: 74 }, ['ice_beam', 'dragon_rage', 'bite', 'surf']),
  member('jolteon', 36, 100, { atk: 62, def: 47, spe: 100, spa: 100, spd: 75 }, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
  member('snorlax', 38, 178, { atk: 92, def: 66, spe: 33, spa: 62, spd: 91 }, ['body_slam', 'sleep_talk', 'rest', 'strength']),
  member('charizard', 40, 116, { atk: 75, def: 73, spe: 99, spa: 101, spd: 79 }, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
  member('dugtrio', 32, 66, { atk: 64, def: 38, spe: 87, spa: 46, spd: 51 }, ['dig', 'cut', 'rock_slide', 'sand_tomb']),
  member('kadabra', 38, 90, { atk: 44, def: 35, spe: 100, spa: 111, spd: 54 }, ['reflect', 'recover', 'psychic', 'flash']),
]);
const tm = (label: string) => {
  const m = machines.find((x) => x.label === label)!;
  return { move: lookup.move(m.move), source: m.label };
};
const OPP = upcomingOpponents(new Set(), 40, 'squirtle');

describe('XP (Gen III)', () => {
  it('selvagem: floor(expYield × nível ÷ 7); trocado ×1,5', () => {
    expect(lookup.species('tangela').expYield).toBe(166);
    expect(wildExp(166, 23)).toBe(545);
    expect(wildExp(166, 23, true)).toBe(817);
  });
  it('tabelas de XP do decomp', () => {
    expect(rules.expTables.medium_fast![38]).toBe(54872);
    expect(rules.expTables.slow![100]).toBe(1250000);
    expect(expToNextLevel(rules.expTables.medium_fast!, 38, 55000)).toBe(59319 - 55000);
    expect(expToNextLevel(rules.expTables.medium_fast!, 100, 1e6)).toBeNull();
    for (const s of species) expect(rules.expTables[s.growthRate!], s.key).toBeDefined();
  });
});

describe('onde treinar', () => {
  it('Route 21 (Tangela na grama, ~545 XP) é o melhor lugar para o Gyarados entre os já visitados', () => {
    const spots = trainingSpots(chart, gyarados!, trainingSpotInputs(['Route21', 'PokemonMansion', 'CinnabarIsland', 'SafariZone'], new Set()), BADGES);
    expect(spots[0]!.key).toBe('Route21|land');
    expect(spots[0]!.expPerBattle).toBe(545);
  });
  it('só entra lugar em que ele vence com folga', () => {
    for (const s of trainingSpots(chart, dugtrio!, trainingSpotInputs(['Route21', 'PokemonMansion', 'SafariZone', 'PowerPlant'], new Set()), BADGES)) {
      expect(s.winRate).toBeGreaterThanOrEqual(0.9);
      expect(s.hpLoss).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('melhor combinação de golpes', () => {
  it('Dugtrio com o TM26: Earthquake no lugar de Sand Tomb; Cut (HM) fica', () => {
    const a = bestMoveset(chart, dugtrio!, [tm('TM26'), tm('TM39')], OPP, BADGES, rules.hmMoves);
    expect(a.learn).toEqual([{ move: 'earthquake', source: 'TM26', replaces: 'sand_tomb' }]);
    expect(a.moves).toContain('cut');
    expect(a.locked).toEqual(['cut']);
  });
  it('Snorlax: Body Slam (ataque principal com STAB), Rest, Sleep Talk e Strength travados; Surf (HM) não entra', () => {
    const a = bestMoveset(chart, snorlax!, [tm('HM03'), tm('TM34')], OPP, BADGES, rules.hmMoves);
    expect(a.locked.sort()).toEqual(['body_slam', 'rest', 'sleep_talk', 'strength']);
    expect(a.learn).toEqual([]);
  });
  it('Kadabra: Psychic (ataque principal com STAB), Reflect e Recover (status útil) e Flash (HM) ficam', () => {
    const a = bestMoveset(chart, kadabra!, [tm('TM29'), tm('TM04')], OPP, BADGES, rules.hmMoves);
    expect(a.locked.sort()).toEqual(['flash', 'psychic', 'recover', 'reflect']);
  });
});

const PRIVATE_SAVE = resolve(import.meta.dirname, '../../../fixtures/private/firered.sav');
describe.skipIf(!existsSync(PRIVATE_SAVE))('XP no save real', () => {
  it('a XP de cada membro fica entre o nível atual e o próximo', () => {
    const r = parseSave(readFileSync(PRIVATE_SAVE), { isKnownItem: lookup.isKnownItem });
    for (const p of r.party) {
      const t = rules.expTables[lookup.species(p.speciesId).growthRate!]!;
      expect(p.experience).toBeGreaterThanOrEqual(t[p.level]!);
      expect(p.experience).toBeLessThan(t[p.level + 1]!);
    }
  });
});
