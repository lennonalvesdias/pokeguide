// Golden cases da Jornada (roteiro curado + flags do jogo).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateJourney, type JourneyFacts } from '@pokeguide/domain';
import { isFlagSet, parseSave } from '@pokeguide/save-parser';
import { describe, expect, it } from 'vitest';
import { lookup, trainers, walkthrough } from '../src/index.ts';

const facts = (over: Partial<JourneyFacts> = {}): JourneyFacts => ({
  isFlagSet: () => false,
  badges: [],
  keyItems: [],
  defeatedTrainers: new Set(),
  ...over,
});

describe('roteiro', () => {
  it('jogo novo: o passo atual é escolher o inicial', () => {
    expect(evaluateJourney(walkthrough, facts()).current?.id).toBe('starter');
  });
  it('a ordem obrigatória cobre as 8 insígnias, a Liga e o campeão', () => {
    const req = walkthrough.filter((s) => s.required).map((s) => s.id);
    for (const id of ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh', 'volcano', 'earth', 'lorelei', 'champion']) expect(req).toContain(id);
    expect(req.indexOf('secret_key')).toBeLessThan(req.indexOf('volcano'));
    expect(req.indexOf('surf')).toBeLessThan(req.indexOf('secret_key'));
  });
  it('campeão conta qualquer variante do rival', () => {
    const st = evaluateJourney(walkthrough, facts({ defeatedTrainers: new Set(['champion_first_squirtle']) }));
    expect(st.steps.find((s) => s.id === 'champion')?.completed).toBe(false); // flag não setada: o passo usa a flag
    const viaTrainer = evaluateJourney(
      [{ id: 'x', title: '', where: '', how: '', required: true, done: { any: [{ trainer: 'champion_first' }] } }],
      facts({ defeatedTrainers: new Set(['champion_first_squirtle']) }),
    );
    expect(viaTrainer.current).toBeNull();
  });
  it('todo treinador citado existe (ou tem variantes do rival)', () => {
    const keys = new Set(trainers.map((t) => t.key));
    for (const s of walkthrough) if (s.trainer) expect(keys.has(s.trainer) || keys.has(`${s.trainer}_squirtle`), s.id).toBe(true);
  });
});

const PRIVATE_SAVE = resolve(import.meta.dirname, '../../../fixtures/private/firered.sav');
describe.skipIf(!existsSync(PRIVATE_SAVE))('jornada com o save real', () => {
  it('6 insígnias, Surf e Strength, sem a Secret Key → próximo passo: Secret Key na Pokémon Mansion', () => {
    const r = parseSave(readFileSync(PRIVATE_SAVE), { isKnownItem: lookup.isKnownItem });
    const byId = new Map(trainers.map((t) => [t.id, t.key]));
    const st = evaluateJourney(walkthrough, {
      isFlagSet: (f) => isFlagSet(r.flagsHex, f),
      badges: r.badges,
      keyItems: r.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? ''),
      defeatedTrainers: new Set(r.defeatedTrainerIds.map((id) => byId.get(id) ?? '')),
    });
    expect(st.current?.id).toBe('secret_key');
    const done = new Set(st.steps.filter((s) => s.completed).map((s) => s.id));
    for (const id of ['bill', 'cut', 'silph_scope', 'poke_flute', 'silph', 'snorlax', 'surf', 'strength', 'marsh', 'soul']) expect(done.has(id), id).toBe(true);
    expect(done.has('volcano')).toBe(false);
  });
});
