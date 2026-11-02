// Invariantes bloqueantes do ADR de navegação, verificados em toda a Pokémon Mansion.
import { answerSwitch, isPassable, nextGuidance, planRoute, setPosition, startNavSession } from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { navigation } from '../src/index.ts';

const area = navigation.find((a) => a.id === 'pokemon_mansion')!;
const T = '2026-11-01T00:00:00Z';
// Amostra de tiles livres de todos os andares (1 a cada 3 em x e y).
const starts = area.floors.flatMap((f) =>
  f.grid.flatMap((row, y) => [...row].map((_, x) => ({ floor: f.map, x, y })).filter((p) => p.x % 3 === 0 && p.y % 3 === 0 && isPassable(area, f.map, p.x, p.y, 'both'))),
);

describe('Pokémon Mansion: invariantes', () => {
  it('há pontos de partida em todos os andares', () => {
    expect(new Set(starts.map((s) => s.floor)).size).toBe(4);
  });
  it('nenhuma rota pisa em tile fechado no estado do interruptor naquele momento', () => {
    let checked = 0;
    for (const start of starts) {
      for (const on of [false, true]) {
        const plan = planRoute(area, start, on, { kind: 'item', item: 'secret_key' });
        if (!plan) continue;
        let state = on;
        for (const a of plan.actions) {
          if (a.type === 'press') state = a.switchOnAfter;
          if (a.type === 'move') expect(isPassable(area, a.floor, a.to.x, a.to.y, state)).toBe(true);
          if (a.type === 'warp') expect(isPassable(area, a.floor, a.via.x, a.via.y, state)).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
  it('com o interruptor desconhecido, nenhum passo depende dele', () => {
    for (const start of starts) {
      const g = nextGuidance(area, setPosition(startNavSession(area, 'secret_key', 'test', T), start, T));
      if (g.kind === 'step') {
        expect(g.step.assumesSwitchOn).toBeUndefined();
        expect(['cross-gate', 'press-switch']).not.toContain(g.step.action);
      } else expect(['ask-switch', 'stuck']).toContain(g.kind);
    }
  });
  it('todo passo tem resultado esperado e pergunta de verificação', () => {
    for (const start of starts.slice(0, 40)) {
      for (const on of [false, true]) {
        const g = nextGuidance(area, answerSwitch(setPosition(startNavSession(area, 'secret_key', 'test', T), start, T), on, T));
        if (g.kind !== 'step') continue;
        expect(g.step.expectedResult.length).toBeGreaterThan(5);
        expect(g.step.verificationQuestion).toMatch(/\?$/);
      }
    }
  });
});
