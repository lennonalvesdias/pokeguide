// Navegação com um mapa sintético: uma grade que só abre com o interruptor ligado.
import { describe, expect, it } from 'vitest';
import {
  answerSwitch,
  applyOutcome,
  type NavArea,
  nextGuidance,
  planRoute,
  reconcileSave,
  setPosition,
  startNavSession,
  trainerSight,
  undo,
} from '../src/index.ts';

// #########
// #S.@1..B#   S = estátua (em cima), @ = início, 1 = grade (livre só ligado), B = Poké Ball
// #########
const area: NavArea = {
  id: 'test',
  name: 'Teste',
  mapPrefix: 'Test',
  switchFlag: { key: 'TEST_SWITCH', id: 1 },
  entrance: { floor: 'Test_1F', x: 3, y: 1 },
  floors: [{ map: 'Test_1F', label: '1F', allowEscaping: true, group: 0, num: 0, width: 9, height: 3, grid: ['#########', '#...1...#', '#########'], objects: [{ x: 7, y: 1 }], source: 'test' }],
  pois: [
    { id: 'sw', kind: 'switch', floor: 'Test_1F', x: 1, y: 0, stand: { x: 1, y: 1 }, facing: 'up', source: 'test' },
    { id: 'ball', kind: 'item', floor: 'Test_1F', x: 7, y: 1, item: 'key', hideFlag: 2, source: 'test' },
  ],
  objectives: [{ id: 'key', title: 'Pegar a chave', item: 'key', doneText: 'Pronto.' }],
  notes: '',
};
const T = '2026-11-01T00:00:00Z';
const START = { floor: 'Test_1F', x: 3, y: 1 };
const base = () => setPosition(startNavSession(area, 'key', 'test', T), START, T);
const actions = (s: ReturnType<typeof base>) => {
  const out: string[] = [];
  for (let g = nextGuidance(area, s); g.kind === 'step'; g = nextGuidance(area, s)) {
    out.push(g.step.action);
    s = applyOutcome(area, s, g.step, 'done', T).session;
  }
  return out;
};

describe('planejador', () => {
  it('com o interruptor desligado, aperta a estátua antes de passar pela grade', () => {
    expect(actions(answerSwitch(base(), false, T))).toEqual(['press-switch', 'cross-gate', 'collect']);
  });
  it('com o interruptor ligado, vai direto', () => {
    expect(actions(answerSwitch(base(), true, T))).toEqual(['cross-gate', 'collect']);
  });
  it('sem rota no estado, devolve null', () => {
    expect(planRoute(area, START, 'both', { kind: 'item', item: 'key' })).toBeNull();
  });
  it('o primeiro passo diz por onde começar só quando a posição é exata', () => {
    const g = nextGuidance(area, answerSwitch(base(), false, T));
    expect(g.kind === 'step' && g.step.instruction).toContain('comece indo para a esquerda (uns 2 passos)');
  });
});

describe('sessão', () => {
  it('interruptor desconhecido vira pergunta, não direção', () => {
    expect(nextGuidance(area, base()).kind).toBe('ask-switch');
  });
  it('"não consigo ver" leva até a estátua para olhar', () => {
    const g = nextGuidance(area, answerSwitch(base(), null, T));
    expect(g.kind === 'step' && g.step.action).toBe('look-switch');
  });
  it('grade fechada: o interruptor estava no outro estado', () => {
    const s = answerSwitch(base(), true, T);
    const g = nextGuidance(area, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    const r = applyOutcome(area, s, g.step, 'blocked', T);
    expect(r.session.switchOn?.value).toBe(false);
    expect(r.session.position?.value).toEqual(START);
    expect(r.correction).toContain('a grade estava fechada');
  });
  it('não encontrou a referência: esquece a posição e pergunta onde está', () => {
    const s = answerSwitch(base(), true, T);
    const g = nextGuidance(area, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    expect(nextGuidance(area, applyOutcome(area, s, g.step, 'not-found', T).session).kind).toBe('locate');
  });
  it('desfazer volta ao estado anterior', () => {
    const s = answerSwitch(base(), true, T);
    const g = nextGuidance(area, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    const after = applyOutcome(area, s, g.step, 'done', T).session;
    expect(undo(after, T).position).toEqual(s.position);
  });
  it('o save não sobrescreve o que o jogador confirmou: vira conflito', () => {
    const r = reconcileSave(area, answerSwitch(base(), true, T), { mapKey: 'Test_1F', x: 3, y: 1, switchOn: false, hasItem: () => false }, T);
    expect(r.session.switchOn?.value).toBe(true);
    expect(r.conflicts).toHaveLength(1);
  });
});

describe('treinadores', () => {
  it('a linha de visão para na parede e ignora quem já foi vencido', () => {
    const withTrainer: NavArea = { ...area, pois: [...area.pois, { id: 't', kind: 'trainer', floor: 'Test_1F', x: 6, y: 1, trainer: 'bob', sight: 4, facing: ['left'], source: 'test' }] };
    expect([...trainerSight(withTrainer, new Set()).keys()]).toEqual(['Test_1F:5:1', 'Test_1F:4:1', 'Test_1F:3:1', 'Test_1F:2:1']);
    expect(trainerSight(withTrainer, new Set(['bob'])).size).toBe(0);
  });
});
