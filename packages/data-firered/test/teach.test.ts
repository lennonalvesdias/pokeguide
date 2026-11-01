// Vale ensinar o TM? Golden cases com a equipe de meio de jogo (6 insígnias).
import { createTypeChart, type TeamMember, teachAdvice } from '@pokeguide/domain';
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
  it('Earthquake em Charizard: vale, no lugar de um golpe que não seja HM nem Flamethrower', () => {
    const a = advise(charizard, 'earthquake');
    expect(a.kind).toBe('replace');
    if (a.kind !== 'replace') return;
    expect(['fly', 'flamethrower']).not.toContain(a.replace);
    expect(a.gain).toBeGreaterThan(0.05);
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
