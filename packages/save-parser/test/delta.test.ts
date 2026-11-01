import { describe, expect, it } from 'vitest';
import { deltaSaveFiles } from '../src/index.ts';

// Nomes e tamanhos observados na pasta do Delta Sync de um usuário real (sem conteúdo).
const LISTING = [
  { name: 'Game-41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc', size: 1242 },
  { name: 'Game-41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc-game', size: 16777216 },
  { name: 'GameSave-41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc', size: 565 },
  { name: 'GameSave-41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc-gameSave', size: 131072 },
  { name: 'GameSave-691e00d9a5dd80b04f80cc7559503e8b06848785-gameSave', size: 262144 },
  { name: 'GameSave-6b47bb75d16514b6a476aa0c73a683a2a4c18765-gameSave', size: 2048 },
  { name: 'SaveState-77C6E20D-F543-47F0-A179-4774DAE2021A-saveState', size: 57517 },
  { name: 'GameCollection-com.rileytestut.delta.game.gba', size: 179 },
].map((e) => ({ ...e, path: `/Delta Emulator/${e.name}` }));

describe('pasta do Delta Sync', () => {
  it('escolhe só o save bruto de GBA (128 KB)', () => {
    expect(deltaSaveFiles(LISTING)).toEqual([
      {
        gameId: '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc',
        path: '/Delta Emulator/GameSave-41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc-gameSave',
        size: 131072,
      },
    ]);
  });

  it('nunca seleciona ROMs, metadados ou save states', () => {
    const picked = deltaSaveFiles(LISTING).map((f) => f.path);
    expect(picked.some((p) => p.endsWith('-game'))).toBe(false);
    expect(picked.some((p) => p.includes('SaveState'))).toBe(false);
  });

  it('ignora entradas sem tamanho', () => {
    expect(deltaSaveFiles([{ name: 'GameSave-41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc-gameSave', path: '/x' }])).toEqual([]);
  });
});
