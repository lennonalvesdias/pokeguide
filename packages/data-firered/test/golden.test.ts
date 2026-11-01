// Golden cases do ruleset firered-gen3 (ADR-003/004/009, revisão v1.1).
// Cada caso traz entrada completa e uma única saída esperada.
import { createTypeChart, forgetRule, forgettableMoves, gen3Category, matchup } from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { lookup, moves, rules, species, typeChart } from '../src/index.ts';

const chart = createTypeChart(typeChart);
const vs = (moveKey: string, speciesKey: string, opts: Parameters<typeof matchup>[3] = {}) =>
  matchup(chart, lookup.move(moveKey), lookup.species(speciesKey), opts);

describe('efetividade de tipos (ADR-003)', () => {
  it('Surf vs Rhyhorn (Ground/Rock) = 4×', () => {
    expect(vs('surf', 'rhyhorn').multiplier).toBe(4);
  });
  it('Rock Slide vs Charizard (Fire/Flying) = 4×', () => {
    expect(vs('rock_slide', 'charizard').multiplier).toBe(4);
  });
  it('Thunderbolt vs Slowbro (Water/Psychic) = 2×', () => {
    expect(vs('thunderbolt', 'slowbro').multiplier).toBe(2);
  });
  it('Ice Beam vs Dragonite (Dragon/Flying) = 4×', () => {
    expect(vs('ice_beam', 'dragonite').multiplier).toBe(4);
  });
  it('Body Slam vs Haunter é imune por tipo; com Foresight vira 1×', () => {
    expect(vs('body_slam', 'haunter')).toMatchObject({ multiplier: 0, immunity: 'type' });
    expect(vs('body_slam', 'haunter', { foresight: true }).multiplier).toBe(1);
  });
});

describe('imunidades por habilidade (ADR-003)', () => {
  it('Dig vs Koffing (Levitate) é imune por habilidade', () => {
    expect(vs('dig', 'koffing')).toMatchObject({ typeMultiplier: 2, multiplier: 0, immunity: 'ability' });
  });
  it('Earthquake vs Gengar (Levitate) é imune', () => {
    expect(vs('earthquake', 'gengar').immunity).toBe('ability');
  });
  it('Shedinja (Wonder Guard): Tackle não acerta, Flamethrower acerta 2×', () => {
    expect(vs('tackle', 'shedinja').multiplier).toBe(0);
    expect(vs('flamethrower', 'shedinja').multiplier).toBe(2);
  });
  it('Lightning Rod não dá imunidade em Gen III (Manectric só resiste por tipo)', () => {
    expect(vs('thunderbolt', 'manectric', { ability: 'lightning_rod' })).toMatchObject({
      multiplier: 0.5,
      immunity: null,
    });
  });
  it('habilidade desconhecida que muda o resultado vira faixa: Surf vs Lapras (Water/Ice)', () => {
    const r = vs('surf', 'lapras');
    expect(r.range).toEqual({ min: 0, max: 0.5 });
    expect(r.byAbility?.map((a) => a.ability).sort()).toEqual(['shell_armor', 'water_absorb']);
  });
  it('Thick Fat reduz fogo à metade quando conhecida: Flamethrower vs Snorlax', () => {
    expect(vs('flamethrower', 'snorlax', { ability: 'thick_fat' })).toMatchObject({ multiplier: 1, damageModifier: 0.5 });
  });
});

describe('categoria física/especial depende do tipo (Gen III)', () => {
  it('Bite é especial e Shadow Ball é física', () => {
    expect(lookup.move('bite').category).toBe('special');
    expect(lookup.move('shadow_ball').category).toBe('physical');
  });
  it('a invariante vale para todos os golpes do dataset', () => {
    for (const m of moves) expect(m.category, m.key).toBe(gen3Category(m.type, m.power));
  });
});

describe('caso Charizard vs Cubone (ADR-004, reescrito na v1.1)', () => {
  // Cubone: Bone Club/Bonemerang são Ground; Charizard e Gyarados são Flying.
  it('os golpes Ground do Cubone não afetam Charizard', () => {
    expect(vs('bone_club', 'charizard').immunity).toBe('type');
    expect(vs('bonemerang', 'charizard').immunity).toBe('type');
  });
  it('Cubone não aprende golpe Rock por level-up', () => {
    const rockMoves = lookup.species('cubone').levelUpMoves.filter((lm) => lookup.move(lm.move).type === 'rock');
    expect(rockMoves).toEqual([]);
  });
  it('trocar para Gyarados não ganha defesa contra Ground', () => {
    expect(vs('bone_club', 'gyarados').immunity).toBe('type');
  });
});

describe('dados específicos do FireRed', () => {
  it('Deoxys usa a Forma Attack', () => {
    expect(lookup.species('deoxys')).toMatchObject({
      form: 'attack',
      baseStats: { hp: 50, atk: 180, def: 20, spa: 180, spd: 20, spe: 150 },
    });
  });
  it('Snorlax aprende Sleep Talk no nível 37 e Rest no 25', () => {
    const lm = lookup.species('snorlax').levelUpMoves;
    expect(lm).toContainEqual({ level: 37, move: 'sleep_talk' });
    expect(lm).toContainEqual({ level: 25, move: 'rest' });
  });
  it('não existe tipo Fairy', () => {
    expect(species.flatMap((s) => s.types)).not.toContain('fairy');
  });
});

describe('restrições de HM (ADR-009)', () => {
  it('Strength não pode ser esquecido na tela de aprendizado', () => {
    expect(forgetRule('strength', rules.hmMoves)).toEqual({
      canForgetInLearnScreen: false,
      reason: 'hm-requires-move-deleter',
    });
  });
  it('Snorlax Body Slam/Yawn/Rest/Strength + Sleep Talk: Strength fica fora dos candidatos', () => {
    expect(forgettableMoves(['body_slam', 'yawn', 'rest', 'strength'], rules.hmMoves)).toEqual([
      'body_slam',
      'yawn',
      'rest',
    ]);
  });
});
