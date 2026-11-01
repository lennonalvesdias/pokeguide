import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup, trainers } from '@pokeguide/data-firered';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSave, SaveParseError, type SaveImportPreview } from '../src/index.ts';
import { syntheticSave } from './synthetic.ts';

describe('save sintético', () => {
  it('lê o slot com maior contador', () => {
    const r = parseSave(syntheticSave({ counterA: 10, counterB: 11 }));
    expect(r.saveCounter).toBe(11);
    expect(r.trainer).toMatchObject({ name: 'TEST', publicId: 12345, secretId: 54321 });
    expect(r.gameFingerprint).toBe('3039D431');
  });

  it('usa o outro slot quando o mais recente está corrompido', () => {
    const save = syntheticSave({ counterA: 10, counterB: 11 });
    const at = 14 * 0x1000 + 0x10;
    save[at] = save[at]! ^ 0xff; // quebra o checksum de um setor do slot B
    const r = parseSave(save);
    expect(r.saveCounter).toBe(10);
    expect(r.slots[1].valid).toBe(false);
    expect(r.slots[1].problems.join()).toMatch(/checksum/);
  });

  it('lê insígnias que ficam na seção 2', () => {
    expect(parseSave(syntheticSave({ badges: 0b0011_1111 })).badges).toEqual([
      'boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh',
    ]);
  });

  it('rejeita tamanho inválido e saves sem slot íntegro', () => {
    expect(() => parseSave(new Uint8Array(1000))).toThrow(SaveParseError);
    expect(() => parseSave(new Uint8Array(0x20000))).toThrowError(/nenhum slot/);
  });

  it('não altera o buffer recebido e é idempotente', () => {
    const save = syntheticSave();
    const before = save.slice();
    const a = parseSave(save);
    const b = parseSave(save);
    expect(save).toEqual(before);
    expect(a).toEqual(b);
  });

  it('fuzz: bytes corrompidos só geram SaveParseError, nunca outro erro', () => {
    const base = syntheticSave();
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 0x1ffff }), fc.integer({ min: 0, max: 255 })), { maxLength: 64 }),
        (mutations) => {
          const save = base.slice();
          for (const [off, byte] of mutations) save[off] = byte;
          try {
            parseSave(save);
          } catch (e) {
            if (!(e instanceof SaveParseError)) throw e;
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

const PRIVATE_SAVE = resolve(import.meta.dirname, '../../../fixtures/private/firered.sav');

// Save real do mantenedor; não versionado (ver fixtures/private/README.md).
describe.skipIf(!existsSync(PRIVATE_SAVE))('save real (fixture privada)', () => {
  // O corpo de um describe pulado ainda executa: a leitura fica no beforeAll.
  let r: SaveImportPreview;
  beforeAll(() => {
    r = parseSave(readFileSync(PRIVATE_SAVE), { isKnownItem: lookup.isKnownItem });
  });
  const name = (id: number) => lookup.species(id).key;

  it('valida os dois slots e escolhe o mais recente', () => {
    expect(r.slots.every((s) => s.valid)).toBe(true);
    expect(r.saveCounter).toBe(Math.max(...r.slots.map((s) => s.counter ?? 0)));
  });

  it('extrai a equipe com checksums válidos', () => {
    expect(r.party.length).toBe(6);
    expect(r.party.every((p) => p.checksumValid)).toBe(true);
    expect(r.party.map((p) => name(p.speciesId))).toContain('snorlax');
  });

  it('stats batem com a fórmula de Gen III (HP do Snorlax)', () => {
    const snorlax = r.party.find((p) => name(p.speciesId) === 'snorlax')!;
    const base = lookup.species('snorlax').baseStats.hp;
    const hp = Math.floor(((2 * base + snorlax.ivs.hp + Math.floor(snorlax.evs.hp / 4)) * snorlax.level) / 100) + snorlax.level + 10;
    expect(snorlax.hp.max).toBe(hp);
  });

  it('lê os treinadores derrotados: 6 líderes vencidos, Blaine ainda não', () => {
    const leader = (n: string) => trainers.find((t) => t.key === `leader_${n}`)!.id;
    for (const n of ['brock', 'misty', 'lt_surge', 'erika', 'koga', 'sabrina']) expect(r.defeatedTrainerIds).toContain(leader(n));
    expect(r.defeatedTrainerIds).not.toContain(leader('blaine'));
    expect(r.defeatedTrainerIds).not.toContain(leader('giovanni'));
  });

  it('descarta itens com ID inexistente e avisa', () => {
    for (const pocket of Object.values(r.bag)) for (const it of pocket) expect(lookup.isKnownItem(it.itemId)).toBe(true);
    expect(r.warnings.some((w) => w.includes('inexistente'))).toBe(true);
  });
});
