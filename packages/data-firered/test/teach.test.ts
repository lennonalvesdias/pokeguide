// Vale ensinar o TM? Golden cases com a equipe de meio de jogo (6 insígnias).
import { canLearnMove, createTypeChart, secondaryBonus, type TeamMember, teachAdvice, teamCoverage } from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { lookup, rules, typeChart, upcomingOpponents } from '../src/index.ts';

const chart = createTypeChart(typeChart);
const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
const member = (key: string, level: number, stats: TeamMember['stats'], moves: string[]): TeamMember => ({
  id: key, name: key, species: lookup.species(key), level, stats, hp: { current: 100, max: 100 }, status: null,
  moves: moves.map((m) => ({ move: lookup.move(m) })),
});
const jolteon = member('jolteon', 36, { atk: 62, def: 47, spa: 100, spd: 75, spe: 100 }, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']);
const charizard = member('charizard', 40, { atk: 75, def: 73, spa: 101, spd: 79, spe: 99 }, ['wing_attack', 'flamethrower', 'fly', 'brick_break']);
// Adversários: treinadores a partir do nível 30 (nenhum vencido).
const OPP = upcomingOpponents(new Set(), 40);
const advise = (m: TeamMember, move: string) => teachAdvice(chart, m, lookup.move(move), OPP, BADGES, rules.hmMoves);

describe('ensinar TM', () => {
  it('há adversários de referência', () => {
    expect(OPP.length).toBeGreaterThan(50);
  });
  it('Thunder não compensa para quem já tem Thunderbolt (mesmo tipo, menos preciso)', () => {
    expect(advise(jolteon, 'thunder').kind).toBe('keep');
  });
  it('Earthquake em Dugtrio: vale muito, no lugar de Sand Tomb (Dig continua)', () => {
    const dugtrio = member('dugtrio', 32, { atk: 64, def: 38, spa: 46, spd: 51, spe: 87 }, ['dig', 'cut', 'rock_slide', 'sand_tomb']);
    const a = advise(dugtrio, 'earthquake');
    expect(a.kind).toBe('replace');
    if (a.kind === 'replace') {
      expect(a.replace).toBe('sand_tomb');
      expect(a.gain).toBeGreaterThan(0.2);
    }
  });
  it('Earthquake em Charizard nunca tira Fly (HM) nem Flamethrower', () => {
    const a = advise(charizard, 'earthquake');
    const out = a.kind === 'replace' ? a.replace : a.kind === 'keep' ? a.bestReplace : null;
    expect(['fly', 'flamethrower']).not.toContain(out);
  });
  it('HM nunca é sugerido para esquecer', () => {
    const a = advise(charizard, 'dragon_claw');
    if (a.kind === 'replace') expect(a.replace).not.toBe('fly');
  });
  it('golpe de status não é comparado por dano', () => {
    expect(advise(jolteon, 'toxic')).toEqual({ kind: 'not-comparable', reason: 'status' });
  });
  it('com menos de 4 golpes, aprende sem esquecer', () => {
    const three = { ...jolteon, moves: jolteon.moves.slice(0, 3) };
    expect(advise(three, 'thunder').kind).toBe('free-slot');
  });
  it('quem não aprende ou já conhece', () => {
    expect(advise(jolteon, 'surf').kind).toBe('cannot');
    expect(advise(jolteon, 'thunderbolt').kind).toBe('knows');
  });
});

describe('o que esquecer', () => {
  const kadabra = member('kadabra', 35, { atk: 40, def: 35, spa: 110, spd: 70, spe: 100 }, ['psybeam', 'confusion', 'flash', 'kinesis']);
  const snorlax = member('snorlax', 38, { atk: 92, def: 66, spa: 62, spd: 91, spe: 33 }, ['body_slam', 'sleep_talk', 'rest', 'strength']);
  it('Psychic em Kadabra substitui Confusion (mesmo tipo, mais fraco), não Flash (HM)', () => {
    const a = advise(kadabra, 'psychic');
    expect(a.kind).toBe('replace');
    if (a.kind === 'replace') expect(a.replace).toBe('confusion');
  });
  it('Rest + Sleep Talk é um par: nenhum dos dois é sugerido para esquecer', () => {
    for (const tm of ['earthquake', 'ice_beam', 'shadow_ball', 'focus_punch']) {
      const a = advise(snorlax, tm);
      if (a.kind === 'replace') expect(['rest', 'sleep_talk', 'strength']).not.toContain(a.replace);
      if (a.kind === 'keep' && a.bestReplace) expect(['rest', 'sleep_talk', 'strength']).not.toContain(a.bestReplace);
    }
  });
});

// Golden case (issue de validação em campo): equipe real do save, 6 insígnias, nenhum treinador vencido a partir do Nv 30.
describe('HM03 Surf no Snorlax (equipe real)', () => {
  const TEAM = [
    member('gyarados', 32, { atk: 91, def: 58, spe: 63, spa: 53, spd: 74 }, ['ice_beam', 'dragon_rage', 'bite', 'surf']),
    member('jolteon', 36, { atk: 62, def: 47, spe: 100, spa: 100, spd: 75 }, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
    member('snorlax', 38, { atk: 92, def: 66, spe: 33, spa: 62, spd: 91 }, ['body_slam', 'sleep_talk', 'rest', 'strength']),
    member('charizard', 40, { atk: 75, def: 73, spe: 99, spa: 101, spd: 79 }, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
    member('dugtrio', 32, { atk: 64, def: 38, spe: 87, spa: 46, spd: 51 }, ['dig', 'cut', 'rock_slide', 'sand_tomb']),
    member('kadabra', 38, { atk: 44, def: 35, spe: 100, spa: 111, spd: 54 }, ['reflect', 'recover', 'psychic', 'flash']),
  ];
  const coverage = teamCoverage(chart, TEAM, OPP, BADGES);
  const snorlax = TEAM[2]!;
  it('Body Slam vale 15% a mais pela chance de 30% de paralisia', () => {
    expect(secondaryBonus(lookup.move('body_slam'))).toBeCloseTo(1.15);
    expect(secondaryBonus(lookup.move('strength'))).toBe(1);
  });
  it('não compensa: HM exige ganho maior e o Gyarados já cobre Pedra e Terra', () => {
    const a = teachAdvice(chart, snorlax, lookup.move('surf'), OPP, BADGES, rules.hmMoves, { teamBest: coverage.get(snorlax.id) });
    expect(a.kind).toBe('keep');
    if (a.kind === 'keep') expect(a.hm).toBe(true);
  });
  it('mesmo sem considerar a equipe, não compensa (HM + paralisia do Body Slam)', () => {
    expect(teachAdvice(chart, snorlax, lookup.move('surf'), OPP, BADGES, rules.hmMoves).kind).toBe('keep');
  });
});

// Golden case (validação em campo, aba Golpes): Gyarados Nv 34 sobe para o Nv 35 e o jogo oferece Twister.
describe('Twister por nível no Gyarados (aba Golpes)', () => {
  const TEAM = [
    member('gyarados', 34, { atk: 96, def: 61, spe: 66, spa: 56, spd: 78 }, ['ice_beam', 'dragon_rage', 'bite', 'surf']),
    member('jolteon', 36, { atk: 62, def: 47, spe: 100, spa: 100, spd: 75 }, ['thunderbolt', 'sand_attack', 'double_kick', 'quick_attack']),
    member('snorlax', 38, { atk: 92, def: 66, spe: 33, spa: 62, spd: 91 }, ['body_slam', 'sleep_talk', 'rest', 'strength']),
    member('charizard', 40, { atk: 75, def: 73, spe: 99, spa: 101, spd: 79 }, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
    member('dugtrio', 32, { atk: 64, def: 38, spe: 87, spa: 46, spd: 51 }, ['dig', 'cut', 'rock_slide', 'sand_tomb']),
    member('kadabra', 38, { atk: 44, def: 35, spe: 100, spa: 111, spd: 54 }, ['reflect', 'recover', 'psychic', 'flash']),
  ];
  const gyarados = TEAM[0]!;
  const twister = lookup.move('twister');
  it('Twister não é TM: sem `learnable`, a comparação recusa', () => {
    expect(teachAdvice(chart, gyarados, twister, OPP, BADGES, rules.hmMoves).kind).toBe('cannot');
    expect(canLearnMove(gyarados, 'twister')).toBe(true);
    expect(canLearnMove(gyarados, 'psychic')).toBe(false);
  });
  it('não aprender: Dragon Rage (40 fixo) já rende mais que Twister especial com Sp. Atk baixo', () => {
    const a = teachAdvice(chart, gyarados, twister, OPP, BADGES, rules.hmMoves, {
      teamBest: teamCoverage(chart, TEAM, OPP, BADGES).get(gyarados.id),
      learnable: true,
    });
    expect(a).toMatchObject({ kind: 'keep', reason: 'low-gain', protectedMove: 'surf', hm: false });
    if (a.kind === 'keep') expect(a.gain).toBeLessThan(0.05);
  });
});
