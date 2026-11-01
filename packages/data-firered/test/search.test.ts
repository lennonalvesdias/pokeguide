import { findOption, normalizeName } from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { moves, species } from '../src/index.ts';

const sp = species.map((s) => ({ key: s.key, label: s.name }));
const mv = moves.map((m) => ({ key: m.key, label: m.name }));

describe('busca tolerante', () => {
  it('normaliza acentos, pontuação e símbolos de gênero', () => {
    expect(normalizeName("Farfetch'd")).toBe('farfetchd');
    expect(normalizeName('NIDORAN♀')).toBe('nidoranf');
    expect(normalizeName('Pokémon')).toBe('pokemon');
  });
  it.each([
    ['mr mime', 'mr_mime'],
    ['farfetchd', 'farfetchd'],
    ['ARCANINE', 'arcanine'],
    ['Arcan', 'arcanine'],
    ['nidoran f', 'nidoran_f'],
  ])('espécie "%s" → %s', (text, key) => {
    expect(findOption(sp, text).match?.key).toBe(key);
  });
  it('prefixo ambíguo vira sugestões: "nidoran" → ♀ e ♂', () => {
    const r = findOption(sp, 'nidoran');
    expect(r.match).toBeNull();
    expect(r.suggestions.map((s) => s.key)).toEqual(expect.arrayContaining(['nidoran_f', 'nidoran_m']));
  });
  it('nome moderno de golpe encontra o nome de Gen III: "Thunder Punch" → THUNDERPUNCH', () => {
    expect(findOption(mv, 'Thunder Punch').match?.key).toBe('thunder_punch');
    expect(findOption(mv, 'sleep talk').match?.key).toBe('sleep_talk');
  });
  it('texto sem correspondência não casa nem sugere', () => {
    expect(findOption(sp, 'zzzz')).toEqual({ match: null, suggestions: [] });
  });
});
