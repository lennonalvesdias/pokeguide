// Invariantes bloqueantes do ADR de navegação, verificados no mundo gerado do decomp.
import { answerSwitch, nextGuidance, planRoute, setPosition, startNavSession, tileAt } from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { loadWorld, navigation } from '../src/index.ts';
import { facts } from './nav-facts.ts';

const T = '2026-11-01T00:00:00Z';

describe('Pokémon Mansion: invariantes', async () => {
  const world = await loadWorld();
  const area = navigation.areas.find((a) => a.id === 'pokemon_mansion')!;
  const F = facts();
  const gateOpen = (map: string, x: number, y: number, on: boolean) => {
    const g = world.maps.find((m) => m.key === map)!.gates.find((t) => t.x === x && t.y === y);
    return g ? g.passWhenSet === on : true;
  };
  // Amostra de tiles livres de todos os andares (1 a cada 3 em x e y).
  const starts = world.maps
    .filter((m) => area.maps.includes(m.key))
    .flatMap((m) =>
      Array.from({ length: m.height }, (_, y) => y).flatMap((y) =>
        Array.from({ length: m.width }, (_, x) => x)
          .filter((x) => x % 3 === 0 && y % 3 === 0 && tileAt(m, x, y) === '.' && !m.objects.some((o) => o.x === x && o.y === y))
          .map((x) => ({ map: m.key, x, y })),
      ),
    );

  it('há pontos de partida em todos os andares', () => {
    expect(new Set(starts.map((s) => s.map)).size).toBe(4);
  });
  it('nenhuma rota pisa em grade fechada no estado do interruptor naquele momento', () => {
    let checked = 0;
    for (const start of starts) {
      for (const on of [false, true]) {
        const plan = planRoute(world, area, F, start, on, { kind: 'item', item: 'secret_key' });
        if (!plan) continue;
        let state = on;
        for (const a of plan.actions) {
          if (a.type === 'press') state = a.switchOnAfter;
          if (a.type === 'move') expect(gateOpen(a.map, a.to.x, a.to.y, state)).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);
  it('com o interruptor desconhecido, nenhum passo depende dele', () => {
    for (const start of starts) {
      const g = nextGuidance(world, area, F, setPosition(startNavSession(area, 'secret_key', 'test', T), start, T));
      if (g.kind === 'step') {
        expect(g.step.assumesSwitchOn).toBeUndefined();
        expect(['cross-gate', 'press-switch']).not.toContain(g.step.action);
      } else expect(['ask-switch', 'stuck']).toContain(g.kind);
    }
  }, 60_000);
  it('todo passo tem resultado esperado e pergunta de verificação', () => {
    for (const start of starts.slice(0, 40)) {
      for (const on of [false, true]) {
        const g = nextGuidance(world, area, F, answerSwitch(setPosition(startNavSession(area, 'secret_key', 'test', T), start, T), on, T));
        if (g.kind !== 'step') continue;
        expect(g.step.expectedResult.length).toBeGreaterThan(5);
        expect(g.step.verificationQuestion).toMatch(/\?$/);
      }
    }
  });
});
