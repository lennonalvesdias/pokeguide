// Golden cases de dano e ranking (ADR-004). Fórmula conferida contra pret/pokefirered.
import {
  assessTeam,
  badgeBoost,
  createTypeChart,
  effectiveSpeed,
  gen3Damage,
  gen3Hp,
  type TeamMember,
  wildMoveset,
} from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { lookup, typeChart } from '../src/index.ts';

const chart = createTypeChart(typeChart);

describe('fórmula de dano de Gen III', () => {
  it('Nv 50, poder 80, Atk 100 vs Def 100, STAB, 2× → 93 a 110', () => {
    // floor(floor(100*80*22/100)/50)=35, +2=37, STAB 55, 2× 110, rolagens 85%..100%.
    const r = gen3Damage({ level: 50, power: 80, attack: 100, defense: 100, stab: true, typeMultipliers: [2] });
    expect(r).toMatchObject({ min: 93, max: 110 });
    expect(r.rolls).toHaveLength(16);
  });
  it('imunidade zera o dano', () => {
    expect(gen3Damage({ level: 50, power: 80, attack: 100, defense: 100, stab: false, typeMultipliers: [0, 2] }).max).toBe(0);
  });
  it('HP de Gen III: Snorlax Nv 38, IV 23, EV 4 → 178', () => {
    expect(gen3Hp(160, 38, 23, 4)).toBe(178);
  });
});

describe('bônus de insígnia (lado do jogador)', () => {
  it('Boulder dá +10% de Ataque; Volcano dá Sp. Atk e Sp. Def', () => {
    expect(badgeBoost('atk', 100, ['boulder'])).toBe(110);
    expect(badgeBoost('spa', 100, ['volcano'])).toBe(110);
    expect(badgeBoost('spd', 100, ['volcano'])).toBe(110);
    expect(badgeBoost('def', 100, ['boulder'])).toBe(100);
  });
  it('Thunder dá +10% de velocidade; paralisia divide por 4', () => {
    expect(effectiveSpeed(100, { badges: ['thunder'] })).toBe(110);
    expect(effectiveSpeed(100, { badges: ['thunder'], paralyzed: true })).toBe(27);
  });
});

describe('moveset de selvagem: 4 últimos golpes de level-up', () => {
  it('Snorlax Nv 38 → Rest, Snore, Body Slam, Sleep Talk', () => {
    expect(wildMoveset(lookup.species('snorlax'), 38)).toEqual(['rest', 'snore', 'body_slam', 'sleep_talk']);
  });
  it('Rhyhorn Nv 45 → Scary Face, Rock Blast, Horn Drill, Take Down', () => {
    expect(wildMoveset(lookup.species('rhyhorn'), 45)).toEqual(['scary_face', 'rock_blast', 'horn_drill', 'take_down']);
  });
});

// Equipe representativa de meio de jogo (6 insígnias).
const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
function member(key: string, level: number, stats: TeamMember['stats'], hp: number, moves: string[]): TeamMember {
  return {
    id: key,
    name: key,
    species: lookup.species(key),
    level,
    stats,
    hp: { current: hp, max: hp },
    status: null,
    moves: moves.map((m) => ({ move: lookup.move(m) })),
  };
}
const TEAM = [
  member('gyarados', 32, { atk: 91, def: 58, spa: 53, spd: 74, spe: 63 }, 107, ['ice_beam', 'dragon_rage', 'bite', 'surf']),
  member('jolteon', 36, { atk: 62, def: 47, spa: 100, spd: 75, spe: 100 }, 100, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
  member('snorlax', 38, { atk: 92, def: 66, spa: 62, spd: 91, spe: 33 }, 178, ['body_slam', 'sleep_talk', 'rest', 'strength']),
  member('charizard', 40, { atk: 75, def: 73, spa: 101, spd: 79, spe: 99 }, 116, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
];
const opponent = (key: string, level: number) => {
  const species = lookup.species(key);
  return { species, level, moves: wildMoveset(species, level).map((m) => lookup.move(m)) };
};

describe('ranking da equipe contra um adversário', () => {
  it('Rhyhorn Nv 45 selvagem: Gyarados com Surf é a primeira opção e nocauteia com garantia', () => {
    const [top] = assessTeam(chart, TEAM, opponent('rhyhorn', 45), BADGES);
    expect(top).toMatchObject({ memberId: 'gyarados', best: { moveKey: 'surf', multiplier: 4, ko: 'guaranteed' } });
  });
  it('Rhyhorn ameaça Charizard com Rock Blast 4×', () => {
    const charizard = assessTeam(chart, TEAM, opponent('rhyhorn', 45), BADGES).find((a) => a.memberId === 'charizard')!;
    expect(charizard.threat).toMatchObject({ moveKey: 'rock_blast', multiplier: 4 });
  });
  it('Cubone Nv 30: nenhum golpe Ground atinge Charizard, e Charizard fica à frente de Snorlax', () => {
    const ranking = assessTeam(chart, TEAM, opponent('cubone', 30), BADGES);
    const charizard = ranking.find((a) => a.memberId === 'charizard')!;
    expect(lookup.move(charizard.threat!.moveKey).type).not.toBe('ground');
    expect(ranking.indexOf(charizard)).toBeLessThan(ranking.findIndex((a) => a.memberId === 'snorlax'));
  });
  it('Pokémon desmaiado vai para o fim', () => {
    const team = TEAM.map((m) => (m.id === 'gyarados' ? { ...m, hp: { current: 0, max: 107 } } : m));
    const ranking = assessTeam(chart, team, opponent('rhyhorn', 45), BADGES);
    expect(ranking.at(-1)).toMatchObject({ memberId: 'gyarados', notes: ['desmaiado'] });
  });
  it('golpe sem PP não é recomendado', () => {
    const team = TEAM.map((m) =>
      m.id === 'gyarados' ? { ...m, moves: m.moves.map((x) => (x.move.key === 'surf' ? { ...x, pp: 0 } : x)) } : m,
    );
    const gyarados = assessTeam(chart, team, opponent('rhyhorn', 45), BADGES).find((a) => a.memberId === 'gyarados')!;
    expect(gyarados.best?.moveKey).not.toBe('surf');
  });
});
