import { describe, expect, it } from 'vitest';
import { parseSave, pickLatestSave, type SaveCandidate } from '../src/index.ts';
import { syntheticSave } from './synthetic.ts';

const save = (name: string, counter: number, opts: { secretId?: number } = {}): SaveCandidate => {
  const bytes = syntheticSave({ counterA: counter - 1, counterB: counter });
  const preview = parseSave(bytes);
  if (opts.secretId !== undefined) {
    return { name, preview: { ...preview, gameFingerprint: `3039${opts.secretId.toString(16).padStart(4, '0')}`.toUpperCase() } };
  }
  return { name, preview };
};

describe('escolha do save mais recente', () => {
  it('usa o maior contador de save, não a ordem dos arquivos', () => {
    const r = pickLatestSave([save('a.sav', 10), save('c.sav', 42), save('b.sav', 30)]);
    expect(r).toMatchObject({ kind: 'picked', chosen: { name: 'c.sav' } });
    if (r.kind === 'picked') expect(r.ignored.map((i) => i.name).sort()).toEqual(['a.sav', 'b.sav']);
  });

  it('não substitui o save carregado por um mais antigo da mesma campanha', () => {
    const current = save('atual.sav', 41).preview;
    expect(pickLatestSave([save('velho.sav', 39)], current)).toMatchObject({ kind: 'older-than-current', currentCounter: 41 });
  });

  it('reimportar o mesmo save é permitido (idempotente)', () => {
    const current = save('atual.sav', 41).preview;
    expect(pickLatestSave([save('atual.sav', 41)], current).kind).toBe('picked');
  });

  it('com save carregado, prefere a mesma campanha mesmo que outra tenha contador maior', () => {
    const current = save('atual.sav', 41).preview;
    const r = pickLatestSave([save('outra.sav', 99, { secretId: 1 }), save('novo.sav', 45)], current);
    expect(r).toMatchObject({ kind: 'picked', chosen: { name: 'novo.sav' } });
  });

  it('avisa quando todos os arquivos são de outra campanha', () => {
    const current = save('atual.sav', 41).preview;
    expect(pickLatestSave([save('outra.sav', 5, { secretId: 1 })], current).kind).toBe('other-campaign');
  });

  it('sem arquivos válidos, não escolhe nada', () => {
    expect(pickLatestSave([]).kind).toBe('none');
  });
});
