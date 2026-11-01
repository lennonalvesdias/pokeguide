// Golden cases de TMs/HMs (sTMHMMoves e tmhm_learnsets.h) e itens.
import { describe, expect, it } from 'vitest';
import { items, lookup, machines } from '../src/index.ts';

describe('TMs e HMs', () => {
  it('50 TMs e 8 HMs, na ordem do jogo', () => {
    expect(machines.filter((m) => !m.hm)).toHaveLength(50);
    expect(machines.filter((m) => m.hm).map((m) => m.move)).toEqual(['cut', 'fly', 'surf', 'strength', 'flash', 'rock_smash', 'waterfall', 'dive']);
  });
  it('TM26 é Earthquake e TM13 é Ice Beam', () => {
    expect(machines.find((m) => m.item === 'tm26')?.move).toBe('earthquake');
    expect(machines.find((m) => m.item === 'tm13')?.move).toBe('ice_beam');
  });
  it('compatibilidade: Snorlax aprende Earthquake; Charizard aprende Fly; Snorlax não aprende Fly', () => {
    expect(lookup.species('snorlax').tmhm).toContain('earthquake');
    expect(lookup.species('charizard').tmhm).toContain('fly');
    expect(lookup.species('snorlax').tmhm).not.toContain('fly');
  });
  it('itens trazem a descrição do jogo sem quebras de linha', () => {
    const rc = items.find((i) => i.key === 'rare_candy')!;
    expect(rc.description).toMatch(/raises the level/i);
    expect(items.every((i) => !i.description.includes('\\n'))).toBe(true);
  });
});
