// Golden cases de treinadores (dados de src/data/trainers.h, trainer_parties.h e scripts de mapa).
import {
  applyStage,
  assessTeam,
  createTypeChart,
  gen3Stat,
  natureModifier,
  type TeamMember,
  wildMoveset,
} from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { lookup, species, trainers, typeChart } from '../src/index.ts';

const chart = createTypeChart(typeChart);
const byKey = (k: string) => trainers.find((t) => t.key === k)!;

describe('dataset de treinadores', () => {
  it('Blaine: time, níveis, IV 0 e golpes fixos como no jogo', () => {
    const b = byKey('leader_blaine');
    expect(b.maps).toEqual(['CinnabarIsland_Gym']);
    expect(b.party.map((p) => [p.species, p.level, p.iv])).toEqual([
      ['growlithe', 42, 0],
      ['ponyta', 40, 0],
      ['rapidash', 42, 0],
      ['arcanine', 47, 0],
    ]);
    expect(b.party[3]!.moves).toEqual(['bite', 'roar', 'take_down', 'fire_blast']);
  });

  it('todo Pokémon de treinador usa a primeira habilidade da espécie (personality par)', () => {
    for (const t of trainers) for (const p of t.party) expect(p.ability, `${t.key}/${p.species}`).toBe(species.find((s) => s.key === p.species)!.abilities[0] ?? null);
    expect(byKey('leader_blaine').party[3]!.ability).toBe('intimidate');
  });

  it('Route 3 tem os 8 treinadores do jogo', () => {
    const names = trainers.filter((t) => t.maps.includes('Route3')).map((t) => t.name).sort();
    expect(names).toEqual(['BEN', 'CALVIN', 'COLTON', 'GREG', 'JAMES', 'JANICE', 'ROBIN', 'SALLY']);
  });

  it('treinador sem golpes fixos usa os golpes padrão de level-up', () => {
    const ben = byKey('youngster_ben');
    expect(ben.party[0]).toMatchObject({ species: 'rattata', level: 11 });
    expect(ben.party[0]!.moves).toBeUndefined();
    expect(wildMoveset(lookup.species('rattata'), 11)).toEqual(['tackle', 'tail_whip', 'quick_attack']);
  });

  it('rival e campeão têm variantes pelo inicial do rival', () => {
    const sq = trainers.filter((t) => t.rivalStarter === 'squirtle').map((t) => t.key);
    expect(sq).toContain('rival_silph_squirtle');
    expect(sq).toContain('champion_first_squirtle');
    expect(byKey('rival_silph_squirtle').party.some((p) => p.species === 'blastoise' || p.species === 'wartortle')).toBe(true);
  });
});

describe('natureza e estágios (Gen III)', () => {
  it('natureza: Adamant sobe Ataque e desce Sp. Atk; Hardy é neutra', () => {
    expect(natureModifier('adamant', 'atk')).toBe(1.1);
    expect(natureModifier('adamant', 'spa')).toBe(0.9);
    expect(natureModifier('hardy', 'atk')).toBe(1);
    // Aritmética inteira como ModifyStatByNature: floor(n × 110 / 100).
    expect(gen3Stat(100, 50, 31, 0, 'adamant', 'atk')).toBe(Math.floor((Math.floor((231 * 50) / 100) + 5) * 110 / 100));
  });
  it('estágio -1 (Intimidate) = 10/15', () => {
    expect(applyStage(150, -1)).toBe(100);
    expect(applyStage(100, 1)).toBe(150);
  });
});

const member = (key: string, level: number, stats: TeamMember['stats'], hp: number, moves: string[]): TeamMember => ({
  id: key, name: key, species: lookup.species(key), level, stats, hp: { current: hp, max: hp }, status: null,
  moves: moves.map((m) => ({ move: lookup.move(m) })),
});
const TEAM = [
  member('snorlax', 38, { atk: 92, def: 66, spa: 62, spd: 91, spe: 33 }, 178, ['body_slam', 'sleep_talk', 'rest', 'strength']),
  member('jolteon', 36, { atk: 62, def: 47, spa: 100, spd: 75, spe: 100 }, 100, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
];
const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
const asOpponent = (t: string, i: number) => {
  const p = byKey(t).party[i]!;
  const sp = lookup.species(p.species);
  return { species: sp, level: p.level, iv: p.iv, nature: p.nature, ...(p.ability ? { ability: p.ability } : {}), moves: (p.moves ?? wildMoveset(sp, p.level)).map((m) => lookup.move(m)) };
};

describe('batalha contra treinador', () => {
  it('Arcanine do Blaine ameaça o Jolteon com Fire Blast (não Ember, como um selvagem)', () => {
    const jolteon = assessTeam(chart, TEAM, asOpponent('leader_blaine', 3), BADGES).find((a) => a.memberId === 'jolteon')!;
    expect(jolteon.threat?.moveKey).toBe('fire_blast');
    expect(jolteon.threat!.pctMax).toBeGreaterThan(80);
  });
  it('Intimidate reduz o dano físico do Snorlax contra o Arcanine do Blaine', () => {
    const opp = asOpponent('leader_blaine', 3);
    const withI = assessTeam(chart, TEAM, opp, BADGES).find((a) => a.memberId === 'snorlax')!;
    const { ability: _, ...noAbility } = opp;
    const without = assessTeam(chart, TEAM, noAbility, BADGES).find((a) => a.memberId === 'snorlax')!;
    expect(withI.best!.pctMax).toBeLessThan(without.best!.pctMax);
    expect(withI.notes).toContain('Intimidate reduz seu Ataque');
  });
});
