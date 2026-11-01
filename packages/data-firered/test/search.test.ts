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
  it('começo de qualquer palavra: "blaine" acha "Leader Blaine"; "janice" acha "Lass Janice"', () => {
    const opts = [
      { key: 'leader_blaine', label: 'Leader Blaine' },
      { key: 'lass_janice', label: 'Lass Janice' },
      { key: 'grunt_1', label: 'Team Rocket Grunt · Mt Moon' },
      { key: 'grunt_2', label: 'Team Rocket Grunt · Rocket Hideout' },
    ];
    expect(findOption(opts, 'blaine').match?.key).toBe('leader_blaine');
    expect(findOption(opts, 'janice').match?.key).toBe('lass_janice');
    expect(findOption(opts, 'grunt').suggestions.map((o) => o.key)).toEqual(['grunt_1', 'grunt_2']);
  });
  it('texto sem correspondência não casa nem sugere', () => {
    expect(findOption(sp, 'zzzz')).toEqual({ match: null, suggestions: [] });
  });
});
