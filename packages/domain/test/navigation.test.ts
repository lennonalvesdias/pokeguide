// Navegação num mundo sintético: cada regra de movimento do FireRed isolada num mapa pequeno.
import { describe, expect, it } from 'vitest';
import {
  answerSwitch,
  applyOutcome,
  type FieldMove,
  type NavArea,
  type NavFacts,
  type NavWorld,
  nextGuidance,
  planRoute,
  reconcileSave,
  setPosition,
  startNavSession,
  trainerSight,
  undo,
  type WorldMap,
  type WorldObject,
} from '../src/index.ts';

const T = '2026-11-01T00:00:00Z';
const facts = (o: { flags?: Record<number, boolean>; vars?: Record<number, number>; badges?: string[]; items?: string[]; moves?: FieldMove[] } = {}): NavFacts => ({
  flag: (id) => o.flags?.[id] ?? null,
  variable: (id) => o.vars?.[id] ?? null,
  badges: o.badges ?? [],
  items: new Set(o.items ?? []),
  fieldMoves: new Set(o.moves ?? []),
  defeatedTrainers: new Set(),
});

/** Monta um mapa a partir de linhas; elevação 3 em terra e 1 na água, salvo indicação. */
function map(key: string, rows: string[], extra: Partial<WorldMap> = {}): WorldMap {
  const tiles = rows.join('');
  return {
    key,
    group: 0,
    num: 0,
    mapsec: 'TEST',
    name: key,
    type: 'route',
    allowEscaping: true,
    allowCycling: true,
    width: rows[0]!.length,
    height: rows.length,
    tiles,
    elev: [...tiles].map((c) => (c === '~' ? '1' : '3')).join(''),
    connections: [],
    warps: [],
    objects: [],
    hidden: [],
    triggers: [],
    overlays: [],
    source: 'teste',
    ...extra,
  };
}
const world = (maps: WorldMap[], more: Partial<NavWorld> = {}): NavWorld => ({ maps, areas: [], blockers: [], newGameFlags: [], obstacles: {}, openers: [], elevatorKeys: [], ...more });
const area = (maps: string[], more: Partial<NavArea> = {}): NavArea => ({
  id: 'test',
  name: 'Teste',
  maps,
  labels: {},
  entrance: { map: maps[0]!, x: 1, y: 1 },
  objectives: [{ id: 'go', title: 'Ir', doneText: 'Pronto.', reach: { map: maps[0]!, x: 5, y: 1 } }],
  notes: '',
  ...more,
});
const types = (w: NavWorld, a: NavArea, f: NavFacts, from: { map: string; x: number; y: number }, goal: Parameters<typeof planRoute>[5]) =>
  planRoute(w, a, f, from, false, goal)?.actions.map((x) => x.type);

describe('regras de movimento', () => {
  it('ledge: pula para baixo, mas não dá para subir por ela', () => {
    const m = map('L', ['#######', '#.....#', '#vvvvv#', '#.....#', '#######']);
    const w = world([m]);
    const a = area(['L']);
    expect(types(w, a, facts(), { map: 'L', x: 1, y: 1 }, { kind: 'reach', map: 'L', x: 1, y: 3 })).toEqual(['jump', 'goal']);
    expect(planRoute(w, a, facts(), { map: 'L', x: 1, y: 3 }, false, { kind: 'reach', map: 'L', x: 1, y: 1 })).toBeNull();
  });
  it('água: só com Surf e a Soul Badge; sai da água na margem', () => {
    const m = map('W', ['#######', '#.~~~.#', '#######']);
    const w = world([m]);
    const a = area(['W']);
    const goal = { kind: 'reach', map: 'W', x: 5, y: 1 } as const;
    expect(planRoute(w, a, facts({ moves: ['surf'] }), { map: 'W', x: 1, y: 1 }, false, goal)).toBeNull();
    expect(types(w, a, facts({ moves: ['surf'], badges: ['soul'] }), { map: 'W', x: 1, y: 1 }, goal)).toEqual(['surf', 'move', 'move', 'land', 'goal']);
  });
  it('borda bloqueada (decomp: IsNorthBlocked): não entra por cima nem sai para cima', () => {
    const m = map('E', ['#####', '#...#', '#.n.#', '#...#', '#####']);
    const w = world([m]);
    const a = area(['E']);
    // Descer de (2,1) para (2,3) passando por (2,2) cruzaria a borda norte: contorna pela lateral.
    expect(types(w, a, facts(), { map: 'E', x: 2, y: 1 }, { kind: 'reach', map: 'E', x: 2, y: 3 })).toEqual(['move', 'move', 'move', 'move', 'goal']);
    // Subir de (2,3) até (2,2) pode (entra por baixo), mas sair dele para cima não.
    expect(types(w, a, facts(), { map: 'E', x: 2, y: 3 }, { kind: 'reach', map: 'E', x: 2, y: 2 })).toEqual(['move', 'goal']);
  });
  it('conexão: sai pela borda e entra no mapa vizinho com x - offset (fieldmap.c: SetPositionFromConnection)', () => {
    const a1 = map('A', ['#..#', '#..#'], { connections: [{ dir: 'up', offset: 1, map: 'B' }] });
    const b = map('B', ['#...#', '#...#']);
    const w = world([a1, b]);
    const plan = planRoute(w, area(['A', 'B']), facts(), { map: 'A', x: 1, y: 1 }, false, { kind: 'reach', map: 'B', x: 2, y: 1 });
    // De A (2,0) para cima: B (2 - 1, altura - 1) = (1,1). Por A (1,0) cairia em B (0,1), que é parede.
    expect(plan?.actions.find((x) => x.type === 'connect')).toMatchObject({ to: { map: 'B', x: 1, y: 1 } });
  });
  it('Cut: a árvore pequena sai com o golpe e a Cascade Badge', () => {
    const tree: WorldObject = { x: 2, y: 1, hideFlag: null, source: 't', kind: 'cut-tree' };
    const m = map('C', ['#####', '#...#', '#####'], { objects: [tree] });
    const w = world([m]);
    const goal = { kind: 'reach', map: 'C', x: 3, y: 1 } as const;
    expect(planRoute(w, area(['C']), facts(), { map: 'C', x: 1, y: 1 }, false, goal)).toBeNull();
    expect(types(w, area(['C']), facts({ moves: ['cut'], badges: ['cascade'] }), { map: 'C', x: 1, y: 1 }, goal)).toEqual(['remove', 'move', 'goal']);
  });
  it('gatilho de script: bloqueia enquanto a variável tem o valor e a condição não foi cumprida', () => {
    const m = map('G', ['#####', '#...#', '#####'], { triggers: [{ x: 2, y: 1, var: 'VAR_X', value: 0, script: 's' }] });
    const w = world([m], { blockers: [{ id: 'b', map: 'G', tiles: [{ x: 2, y: 1, var: 0x4050, value: 0 }], clearedBy: [{ item: 'tea' }], text: 'Precisa do Tea.' }] });
    const go = (f: NavFacts) => planRoute(w, area(['G']), f, { map: 'G', x: 1, y: 1 }, false, { kind: 'reach', map: 'G', x: 3, y: 1 });
    expect(go(facts())).toBeNull();
    expect(go(facts({ vars: { 0x4050: 1 } }))).not.toBeNull();
    expect(go(facts({ items: ['tea'] }))).not.toBeNull();
  });
  it('pessoa reposicionada por script: bloqueia onde a variável diz; desconhecida bloqueia as duas posições', () => {
    const man: WorldObject = { x: 1, y: 1, hideFlag: null, source: 't', kind: 'npc', gfx: 'MAN', range: [0, 0], moves: [{ var: 0x4051, cmp: 'eq', value: 0, x: 2, y: 2 }] };
    const m = map('P', ['#####', '#...#', '#.#.#', '#...#', '#####'], { objects: [man] });
    const w = world([m]);
    const go = (f: NavFacts) => planRoute(w, area(['P']), f, { map: 'P', x: 1, y: 3 }, false, { kind: 'reach', map: 'P', x: 1, y: 1 });
    // Variável 0: o homem está em (2,2), que nem é chão... fica livre o caminho pela esquerda.
    expect(go(facts({ vars: { 0x4051: 0 } }))).not.toBeNull();
    // Variável 1: ele fica na posição original (1,1), que é o destino: bloqueado.
    expect(go(facts({ vars: { 0x4051: 1 } }))).toBeNull();
  });
});

describe('sessão (interruptor e grade)', () => {
  // #########
  // #S.@#...#   S = estátua (em cima), @ = início, grade em (4,1): parede no layout, livre com a flag ligada
  // #########
  const m = map('M', ['#########', '#...#...#', '#########'], {
    overlays: [{ when: { flag: 1, set: true }, label: 'press', tiles: [{ x: 4, y: 1, c: '.' }] }],
    objects: [{ x: 7, y: 1, hideFlag: 2, source: 't', kind: 'item', item: 'key' }],
  });
  const w = world([m]);
  const a = area(['M'], {
    entrance: { map: 'M', x: 3, y: 1 },
    switch: { flag: { key: 'TEST', id: 1 }, statues: [{ id: 'sw', map: 'M', x: 1, y: 0, stand: { x: 1, y: 1 }, facing: 'up', source: 't' }] },
    objectives: [{ id: 'key', title: 'Pegar a chave', item: 'key', doneText: 'Pronto.' }],
  });
  const F = facts();
  const START = { map: 'M', x: 3, y: 1 };
  const base = () => setPosition(startNavSession(a, 'key', 'test', T), START, T);
  const actions = (s: ReturnType<typeof base>) => {
    const out: string[] = [];
    for (let g = nextGuidance(w, a, F, s); g.kind === 'step'; g = nextGuidance(w, a, F, s)) {
      out.push(g.step.action);
      s = applyOutcome(w, a, s, g.step, 'done', T).session;
    }
    return out;
  };

  it('com o interruptor desligado, aperta a estátua antes de passar pela grade', () => {
    expect(actions(answerSwitch(base(), false, T))).toEqual(['press-switch', 'cross-gate', 'collect']);
  });
  it('com o interruptor ligado, vai direto', () => {
    expect(actions(answerSwitch(base(), true, T))).toEqual(['cross-gate', 'collect']);
  });
  it('o primeiro passo diz por onde começar quando a posição é exata', () => {
    const g = nextGuidance(w, a, F, answerSwitch(base(), false, T));
    expect(g.kind === 'step' && g.step.instruction).toContain('comece indo para a esquerda (uns 2 passos)');
  });
  it('interruptor desconhecido vira pergunta, não direção', () => {
    expect(nextGuidance(w, a, F, base()).kind).toBe('ask-switch');
  });
  it('"não consigo ver" leva até a estátua para olhar', () => {
    const g = nextGuidance(w, a, F, answerSwitch(base(), null, T));
    expect(g.kind === 'step' && g.step.action).toBe('look-switch');
  });
  it('grade fechada: o interruptor estava no outro estado', () => {
    const s = answerSwitch(base(), true, T);
    const g = nextGuidance(w, a, F, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    const r = applyOutcome(w, a, s, g.step, 'blocked', T);
    expect(r.session.switchOn?.value).toBe(false);
    expect(r.session.position?.value).toEqual(START);
    expect(r.correction).toContain('a grade estava fechada');
  });
  it('não encontrou a referência: esquece a posição e pergunta onde está', () => {
    const s = answerSwitch(base(), true, T);
    const g = nextGuidance(w, a, F, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    expect(nextGuidance(w, a, F, applyOutcome(w, a, s, g.step, 'not-found', T).session).kind).toBe('locate');
  });
  it('desfazer volta ao estado anterior', () => {
    const s = answerSwitch(base(), true, T);
    const g = nextGuidance(w, a, F, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    expect(undo(applyOutcome(w, a, s, g.step, 'done', T).session, T).position).toEqual(s.position);
  });
  it('o save não sobrescreve o que o jogador confirmou: vira conflito', () => {
    const r = reconcileSave(w, a, answerSwitch(base(), true, T), { mapKey: 'M', x: 3, y: 1, switchOn: false, hasItem: () => false }, T);
    expect(r.session.switchOn?.value).toBe(true);
    expect(r.conflicts).toHaveLength(1);
  });
  it('sem rota: diz o que falta', () => {
    const water = map('S', ['#######', '#.~~~.#', '#######']);
    const sa = area(['S'], { objectives: [{ id: 'go', title: 'Atravessar', doneText: 'ok', reach: { map: 'S', x: 5, y: 1 } }] });
    const g = nextGuidance(world([water]), sa, facts(), setPosition(startNavSession(sa, 'go', 'test', T), { map: 'S', x: 1, y: 1 }, T));
    expect(g).toEqual({ kind: 'stuck', text: 'Daqui ainda não dá para chegar: falta algo.', missing: ['Surf: falta alguém na equipe com Surf e a Soul Badge.'] });
  });
});

describe('treinadores', () => {
  it('a linha de visão para na parede e ignora quem já foi vencido', () => {
    const m = map('V', ['#########', '#.......#', '#########'], { objects: [{ x: 6, y: 1, hideFlag: null, source: 't', kind: 'trainer', trainer: 'bob', sight: 4, facing: ['left'] }] });
    const w = world([m]);
    expect([...trainerSight(w, new Set(['V']), new Set()).keys()]).toEqual(['V:5:1', 'V:4:1', 'V:3:1', 'V:2:1']);
    expect(trainerSight(w, new Set(['V']), new Set(['bob'])).size).toBe(0);
  });
});

describe('sobreposições e aberturas', () => {
  // Porta fechada enquanto a flag 9 está desligada; o Card Key abre (uma ação, depois passa).
  const door = map('D', ['#######', '#.....#', '#######'], { overlays: [{ when: { flag: 9, set: false }, label: 'close', tiles: [{ x: 3, y: 1, c: '#' }] }] });
  const opener = { id: 'card', map: 'D', label: 'close', effect: 'remove' as const, needsItem: 'card_key', why: 'Precisa do Card Key.', steps: [{ instruction: 'Use o Card Key.', expected: 'Abre.', question: 'Abriu?' }] };
  const w = world([door], { openers: [opener] });
  const a = area(['D'], { objectives: [{ id: 'go', title: 'Passar', doneText: 'ok', reach: { map: 'D', x: 5, y: 1 } }] });
  const go = (f: NavFacts) => planRoute(w, a, f, { map: 'D', x: 1, y: 1 }, false, { kind: 'reach', map: 'D', x: 5, y: 1 });
  it('flag desconhecida e sem Card Key: fechada', () => {
    expect(go(facts())).toBeNull();
  });
  it('flag ligada (porta já aberta no save): passa direto', () => {
    expect(go(facts({ flags: { 9: true } }))?.actions.map((x) => x.type)).toEqual(['move', 'move', 'move', 'move', 'goal']);
  });
  it('com o Card Key: abre a porta no caminho e, confirmado, não pede de novo', () => {
    expect(go(facts({ items: ['card_key'] }))?.actions.map((x) => x.type)).toEqual(['move', 'open', 'move', 'move', 'goal']);
    const s = setPosition(startNavSession(a, 'go', 't', T), { map: 'D', x: 1, y: 1 }, T);
    const F = facts({ items: ['card_key'] });
    const g = nextGuidance(w, a, F, s);
    if (g.kind !== 'step') throw new Error(g.kind);
    expect(g.step.action).toBe('open');
    const after = applyOutcome(w, a, s, g.step, 'done', T).session;
    expect(after.collected).toContain('open:D:close');
    const next = nextGuidance(w, a, F, after);
    expect(next.kind === 'step' && next.step.action).not.toBe('open');
  });
  it('sem rota: explica a abertura que falta', () => {
    const g = nextGuidance(w, a, facts(), setPosition(startNavSession(a, 'go', 't', T), { map: 'D', x: 1, y: 1 }, T));
    expect(g.kind === 'stuck' && g.missing).toEqual(['Precisa do Card Key. (precisa do item card key)']);
  });
});
