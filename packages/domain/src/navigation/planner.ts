// Planejador puro: menor caminho em (mapa, x, y, elevação, surfando, interruptor), seguindo as regras de
// movimento do FireRed (decomp: field_player_avatar.c, event_object_movement.c, field_control_avatar.c).
// Nenhum tile é atravessado se não for livre no estado assumido; condição desconhecida = bloqueado.
import type {
  FieldMove,
  NavArea,
  NavBlocker,
  NavDirection,
  NavFacts,
  NavPlace,
  NavTile,
  NavWorld,
  RouteMode,
  SwitchStatue,
  ObjectMove,
  WorldMap,
  WorldObject,
  WorldWarp,
} from './types.ts';

export const DIRS: ReadonlyArray<readonly [NavDirection, number, number]> = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
];
const DELTA: Record<NavDirection, readonly [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** HM de campo → insígnia exigida (party_menu.c: FLAG_BADGE01_GET + fieldMove). */
export const FIELD_MOVE_BADGE: Record<FieldMove, string> = {
  flash: 'boulder',
  cut: 'cascade',
  strength: 'rainbow',
  surf: 'soul',
  rock_smash: 'marsh',
  waterfall: 'volcano',
};
export const canUse = (facts: NavFacts, move: FieldMove) => facts.fieldMoves.has(move) && facts.badges.includes(FIELD_MOVE_BADGE[move]);

const LEDGE: Record<string, NavDirection> = { v: 'down', '^': 'up', '{': 'left', '}': 'right' };
const CURRENT: Record<string, NavDirection> = { '8': 'up', '2': 'down', '4': 'left', '6': 'right' };
const SPIN: Record<string, NavDirection> = { U: 'up', D: 'down', L: 'left', R: 'right' };
/** Lados bloqueados de cada borda. */
const EDGE: Record<string, readonly NavDirection[]> = {
  n: ['up'], e: ['right'], s: ['down'], w: ['left'],
  N: ['up', 'right'], M: ['up', 'left'], S: ['down', 'right'], Z: ['down', 'left'],
};
const OPPOSITE: Record<NavDirection, NavDirection> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const WATER = new Set(['~', 'F', 'W', '8', '2', '4', '6']);
export const isWaterTile = (c: string) => WATER.has(c);

/** `true`/`false`: estado assumido do interruptor. `'both'`: só tiles livres nos dois estados, sem apertar estátuas. */
export type SwitchAssumption = boolean | 'both';

export type PlanGoal =
  | { kind: 'item'; item: string }
  | { kind: 'collect'; ids: readonly string[] }
  | { kind: 'reach'; map: string; x?: number; y?: number }
  | { kind: 'reach-prefix'; prefix: string }
  | { kind: 'talk'; place: NavPlace }
  | { kind: 'exit' }
  | { kind: 'any-switch' };

/** O que falta para passar por uma aresta (no modo que explica o bloqueio). */
export type Requirement = { kind: 'field-move'; move: FieldMove } | { kind: 'blocker'; id: string } | { kind: 'object'; place: NavPlace; flag: number | null };

export type PlanAction =
  | { type: 'move'; map: string; to: NavTile; dir: NavDirection; gate?: boolean; event?: string }
  | { type: 'jump'; map: string; to: NavTile; dir: NavDirection }
  | { type: 'surf'; map: string; to: NavTile; dir: NavDirection }
  | { type: 'land'; map: string; to: NavTile; dir: NavDirection }
  | { type: 'remove'; map: string; at: NavTile; to: NavTile; dir: NavDirection; move: 'cut' | 'rock_smash' | 'interact'; objectId: string; gfx?: string }
  | { type: 'waterfall'; map: string; to: NavTile }
  | { type: 'slide'; map: string; to: NavTile; cause: 'current' | 'spin' | 'ice' | 'waterfall' }
  | { type: 'warp'; map: string; via: NavTile; warp: WorldWarp; press: NavDirection | null; to: NavPlace }
  | { type: 'connect'; map: string; via: NavTile; dir: NavDirection; to: NavPlace }
  | { type: 'press'; map: string; statue: SwitchStatue; switchOnAfter: boolean }
  | { type: 'goal'; map: string; at: NavTile; goal: GoalHit };

export type GoalHit =
  | { kind: 'item'; id: string; item: string; target: NavTile }
  | { kind: 'hidden'; id: string; item: string; target: NavTile }
  | { kind: 'talk'; target: NavTile }
  | { kind: 'reach' }
  | { kind: 'exit' }
  | { kind: 'switch'; statue: SwitchStatue };

export interface Plan {
  start: NavPlace;
  switchOn: SwitchAssumption;
  actions: PlanAction[];
  cost: number;
  /** Só no modo `relaxed`: o que a rota precisaria e o jogador não tem. */
  requirements: Requirement[];
}

export interface PlanOptions {
  mode?: RouteMode;
  /** Ids de itens já pegos (não são alvo e as Poké Balls não estão mais lá). */
  collected?: ReadonlySet<string>;
  /** Permite arestas que exigem algo que falta, com custo alto, para dizer o que falta. */
  relaxed?: boolean;
}

interface MapIndex {
  map: WorldMap;
  inRegion: boolean;
  /** Por tile: objeto presente (índice) ou -1. */
  objectAt: Int32Array;
  warpAt: Map<number, WorldWarp>;
  gateAt: Map<number, { flag: number; passWhenSet: boolean }>;
  blockerAt: Map<number, { blocker: NavBlocker; var: number; value: number }>;
  statueAt: Map<number, SwitchStatue>;
}

interface Ctx {
  maps: MapIndex[];
  idx: Map<string, number>;
  area: NavArea;
}

const ctxCache = new WeakMap<NavWorld, Map<string, Ctx>>();

/** Índices do mundo para a área (mapas da área ou todos, se a área cobre o mundo). */
export function navContext(world: NavWorld, area: NavArea): Ctx {
  let byArea = ctxCache.get(world);
  if (!byArea) ctxCache.set(world, (byArea = new Map()));
  const cached = byArea.get(area.id);
  if (cached && cached.area === area) return cached;
  const region = new Set(area.maps);
  const idx = new Map(world.maps.map((m, i) => [m.key, i]));
  const blockersByMap = new Map<string, NavBlocker[]>();
  for (const b of world.blockers) blockersByMap.set(b.map, [...(blockersByMap.get(b.map) ?? []), b]);
  const maps = world.maps.map((map) => {
    const objectAt = new Int32Array(map.width * map.height).fill(-1);
    map.objects.forEach((o, i) => {
      if (o.x >= 0 && o.y >= 0 && o.x < map.width && o.y < map.height) objectAt[o.y * map.width + o.x] = i;
    });
    const warpAt = new Map(map.warps.map((w) => [w.y * map.width + w.x, w]));
    const gateAt = new Map(map.gates.map((g) => [g.y * map.width + g.x, { flag: g.flag, passWhenSet: g.passWhenSet }]));
    const blockerAt = new Map<number, { blocker: NavBlocker; var: number; value: number }>();
    for (const b of blockersByMap.get(map.key) ?? []) for (const t of b.tiles) blockerAt.set(t.y * map.width + t.x, { blocker: b, var: t.var, value: t.value });
    const statueAt = new Map((area.switch?.statues ?? []).filter((s) => s.map === map.key).map((s) => [s.stand.y * map.width + s.stand.x, s]));
    return { map, inRegion: region.has(map.key), objectAt, warpAt, gateAt, blockerAt, statueAt };
  });
  const ctx = { maps, idx, area };
  byArea.set(area.id, ctx);
  return ctx;
}

export const tileAt = (m: WorldMap, x: number, y: number) => (x < 0 || y < 0 || x >= m.width || y >= m.height ? '#' : m.tiles[y * m.width + x]!);
export const elevAt = (m: WorldMap, x: number, y: number) => parseInt(m.elev[y * m.width + x] ?? '0', 16);

/**
 * O objeto está no mapa agora? Pela flag do save; se o save não traz, pelo valor num jogo novo
 * (o rival do S.S. Anne começa escondido, os fósseis do Mt. Moon começam no chão).
 */
export function objectPresent(o: WorldObject, facts: NavFacts, collected?: ReadonlySet<string>, id?: string, newGame?: ReadonlySet<number>): boolean {
  if (id && (collected?.has(id) || collected?.has(`tmp:${id}`))) return false;
  if (o.hideFlag === null) return true;
  const f = facts.flag(o.hideFlag);
  return f === null ? !newGame?.has(o.hideFlag) : !f;
}

const newGameCache = new WeakMap<NavWorld, ReadonlySet<number>>();
export const newGameFlags = (world: NavWorld): ReadonlySet<number> => {
  let s = newGameCache.get(world);
  if (!s) newGameCache.set(world, (s = new Set(world.newGameFlags)));
  return s;
};

/** A condição de uma posição alternativa vale? null = desconhecida. */
export function moveApplies(mv: ObjectMove, facts: NavFacts): boolean | null {
  if ('always' in mv) return true;
  if ('flag' in mv) {
    const f = facts.flag(mv.flag);
    return f === null ? null : f === mv.set;
  }
  const v = facts.variable(mv.var);
  if (v === null) return null;
  return { eq: v === mv.value, ne: v !== mv.value, lt: v < mv.value, ge: v >= mv.value, le: v <= mv.value, gt: v > mv.value }[mv.cmp];
}

/**
 * Onde o objeto pode estar, segundo o save: a posição alternativa que vale, senão a original.
 * Condição desconhecida = todas as candidatas (conservador).
 */
export function objectTiles(o: WorldObject, facts: NavFacts): NavTile[] {
  if (!o.moves?.length) return [o];
  const known = o.moves.map((mv) => moveApplies(mv, facts));
  const hit = o.moves.find((_, i) => known[i] === true);
  if (hit) return [hit];
  const unknown = o.moves.filter((_, i) => known[i] === null);
  return [o, ...unknown];
}

/** Bloqueio ativo: variável no valor do gatilho (desconhecida = ativo) e nenhuma condição cumprida. */
export function blockerActive(b: { blocker: NavBlocker; var: number; value: number }, facts: NavFacts): boolean {
  const v = facts.variable(b.var);
  if (v !== null && v !== b.value) return false;
  return !b.blocker.clearedBy.some((c) =>
    'flag' in c ? facts.flag(c.flag) === true : 'badges' in c ? c.badges.every((k) => facts.badges.includes(k)) : facts.items.has(c.item),
  );
}

/** Tiles vistos por treinadores ainda não vencidos (linha reta até o alcance, parando em parede). */
export function trainerSight(world: NavWorld, maps: ReadonlySet<string>, defeated: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of world.maps) {
    if (!maps.has(m.key)) continue;
    for (const o of m.objects) {
      if (o.kind !== 'trainer' || defeated.has(o.trainer)) continue;
      for (const d of o.facing) {
        const [dx, dy] = DELTA[d];
        for (let i = 1; i <= o.sight; i++) {
          const x = o.x + dx * i;
          const y = o.y + dy * i;
          if (tileAt(m, x, y) === '#') break;
          out.set(`${m.key}:${x}:${y}`, o.trainer);
        }
      }
    }
  }
  return out;
}

class Heap {
  private a: Array<[number, number]> = [];
  get size() {
    return this.a.length;
  }
  push(c: number, id: number) {
    const a = this.a;
    a.push([c, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

const COST = { move: 1, jump: 1, surf: 3, land: 1, remove: 4, waterfall: 3, warp: 2, connect: 1, press: 4, sight: 6, floor: 40, relax: 400 };

interface State {
  mi: number;
  x: number;
  y: number;
  elev: number;
  surf: boolean;
  on: boolean;
}
const enc = (s: State) => ((((s.mi * 256 + s.y) * 256 + s.x) * 16 + s.elev) * 2 + (s.surf ? 1 : 0)) * 2 + (s.on ? 1 : 0);
const dec = (id: number): State => {
  const on = id % 2 === 1;
  id = (id - (on ? 1 : 0)) / 2;
  const surf = id % 2 === 1;
  id = (id - (surf ? 1 : 0)) / 2;
  const elev = id % 16;
  id = (id - elev) / 16;
  const x = id % 256;
  id = (id - x) / 256;
  const y = id % 256;
  return { mi: (id - y) / 256, x, y, elev, surf, on };
};

/**
 * Menor caminho até o objetivo, partindo de `start`. A elevação inicial é a do tile (o jogador está
 * em pé nele); surfando só se o tile for água.
 */
export function planRoute(
  world: NavWorld,
  area: NavArea,
  facts: NavFacts,
  start: NavPlace,
  switchOn: SwitchAssumption,
  goal: PlanGoal,
  opts: PlanOptions = {},
): Plan | null {
  const ctx = navContext(world, area);
  const startMi = ctx.idx.get(start.map);
  if (startMi === undefined) return null;
  const mode = opts.mode ?? 'fast';
  const collected = opts.collected ?? new Set<string>();
  const both = switchOn === 'both';
  const relaxed = !!opts.relaxed;
  const can = (m: FieldMove) => canUse(facts, m);
  const sight = mode === 'safe' ? trainerSight(world, new Set(area.maps), facts.defeatedTrainers) : new Map<string, string>();
  const ng = newGameFlags(world);
  const startMap = ctx.maps[startMi]!.map;
  const startTile = tileAt(startMap, start.x, start.y);
  const s0: State = { mi: startMi, x: start.x, y: start.y, elev: elevAt(startMap, start.x, start.y), surf: isWaterTile(startTile), on: both ? false : switchOn };

  // Alvos do objetivo, por mapa e tile (chave numérica: mapa, y, x).
  const tkey = (mi: number, x: number, y: number) => (mi * 256 + y) * 256 + x;
  const goalAt = new Map<number, GoalHit>();
  const markAdj = (mi: number, t: NavTile, hit: (target: NavTile) => GoalHit) => {
    for (const [, dx, dy] of DIRS) goalAt.set(tkey(mi, t.x + dx, t.y + dy), hit(t));
  };
  ctx.maps.forEach((mi, mIndex) => {
    if (!mi.inRegion) return;
    const m = mi.map;
    m.objects.forEach((o, i) => {
      const id = `${m.key}#${i}`;
      if (o.kind !== 'item' || !objectPresent(o, facts, collected, id, ng)) return;
      if ((goal.kind === 'item' && goal.item === o.item) || (goal.kind === 'collect' && goal.ids.includes(id))) {
        markAdj(mIndex, o, (target) => ({ kind: 'item', id, item: o.item, target }));
      }
    });
    if (goal.kind === 'collect') {
      m.hidden.forEach((h, i) => {
        const id = `${m.key}#h${i}`;
        if (!goal.ids.includes(id) || collected.has(id) || facts.flag(h.flag) === true) return;
        const hit = (target: NavTile): GoalHit => ({ kind: 'hidden', id, item: h.item, target });
        if (h.underfoot) goalAt.set(tkey(mIndex, h.x, h.y), hit(h));
        else markAdj(mIndex, h, hit);
      });
    }
    if (goal.kind === 'any-switch') for (const st of mi.statueAt.values()) goalAt.set(tkey(mIndex, st.stand.x, st.stand.y), { kind: 'switch', statue: st });
  });
  if (goal.kind === 'talk') {
    const gmi = ctx.idx.get(goal.place.map);
    if (gmi !== undefined) markAdj(gmi, goal.place, (target) => ({ kind: 'talk', target }));
  }
  const reachMi = goal.kind === 'reach' ? ctx.idx.get(goal.map) : undefined;
  // O mapa do objetivo conta como região, mesmo fora da área (ex.: a Route 4 na saída do Mt. Moon).
  const goalMaps = new Set<number>();
  if (reachMi !== undefined) goalMaps.add(reachMi);
  if (goal.kind === 'talk') {
    const t = ctx.idx.get(goal.place.map);
    if (t !== undefined) goalMaps.add(t);
  }
  if (goal.kind === 'reach-prefix') ctx.maps.forEach((mi, i) => mi.map.key.startsWith(goal.prefix) && goalMaps.add(i));
  const inRegion = (mi: number) => ctx.maps[mi]!.inRegion || goalMaps.has(mi);
  const prefixOk = goal.kind === 'reach-prefix' ? ctx.maps.map((mi) => mi.map.key.startsWith(goal.prefix)) : null;

  const reached = (mi: number, x: number, y: number): GoalHit | null => {
    if (goal.kind === 'reach' && mi === reachMi && (goal.x === undefined || (goal.x === x && goal.y === y))) return { kind: 'reach' };
    if (prefixOk?.[mi]) return { kind: 'reach' };
    return goalAt.get(tkey(mi, x, y)) ?? null;
  };

  // Objetos reposicionados por script: libera a posição original e ocupa a que vale (ou todas, se incerto).
  const movedFrom = new Set<number>();
  const movedTo = new Map<number, number>();
  ctx.maps.forEach((mi, mIndex) => {
    mi.map.objects.forEach((o, i) => {
      if (!o.moves?.length) return;
      const tiles = objectTiles(o, facts);
      if (!tiles.some((t) => t.x === o.x && t.y === o.y)) movedFrom.add(tkey(mIndex, o.x, o.y));
      for (const t of tiles) movedTo.set(tkey(mIndex, t.x, t.y), i);
    });
  });
  const objIndex = (mi: number, x: number, y: number): number => {
    const k = tkey(mi, x, y);
    const moved = movedTo.get(k);
    if (moved !== undefined) return moved;
    if (movedFrom.has(k)) return -1;
    const m = ctx.maps[mi]!;
    return x < 0 || y < 0 || x >= m.map.width || y >= m.map.height ? -1 : m.objectAt[y * m.map.width + x]!;
  };

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const how = new Map<number, PlanAction[]>();
  const reqs = new Map<number, Requirement[]>();
  const heap = new Heap();
  const id0 = enc(s0);
  dist.set(id0, 0);
  heap.push(0, id0);
  let goalHit: { id: number; action: PlanAction } | null = null;

  const passWall = (mi: number, x: number, y: number, on: boolean): boolean => {
    const m = ctx.maps[mi]!;
    const c = tileAt(m.map, x, y);
    // Ledges têm colisão no jogo: só passam pulando na direção delas (tratado antes).
    if (c === '#' || LEDGE[c]) return false;
    if (c === 'g') {
      const g = m.gateAt.get(y * m.map.width + x)!;
      if (both) return false;
      const isSwitchFlag = area.switch?.flag.id === g.flag;
      const set = isSwitchFlag ? on : facts.flag(g.flag);
      return set === null ? false : set === g.passWhenSet;
    }
    return true;
  };

  while (heap.size) {
    const [d, id] = heap.pop();
    if (d > (dist.get(id) ?? Infinity)) continue;
    if (goalHit && d >= (dist.get(goalHit.id) ?? Infinity)) break;
    const s = dec(id);
    const mIdx = ctx.maps[s.mi]!;
    const m = mIdx.map;
    const hit = reached(s.mi, s.x, s.y);
    if (hit && !(goal.kind === 'exit')) {
      goalHit = { id, action: { type: 'goal', map: m.key, at: { x: s.x, y: s.y }, goal: hit } };
      break;
    }
    const here = tileAt(m, s.x, s.y);
    const hereElev = elevAt(m, s.x, s.y);
    const relax = (n: State, cost: number, actions: PlanAction[], need: Requirement[] = []) => {
      const nid = enc(n);
      const c = d + cost + need.length * COST.relax;
      if (c < (dist.get(nid) ?? Infinity)) {
        dist.set(nid, c);
        prev.set(nid, id);
        how.set(nid, actions);
        reqs.set(nid, need);
        heap.push(c, nid);
      }
    };
    /** Chegou num tile: warps de pisar, saída da área, movimento forçado. */
    const arrive = (mi: number, x: number, y: number, elev: number, surf: boolean, on: boolean, actions: PlanAction[], cost: number, need: Requirement[], dirIn: NavDirection) => {
      let cur = { mi, x, y, elev, surf, on };
      const acts = [...actions];
      // Movimento forçado (correnteza, girador, gelo): segue até parar.
      let dir = dirIn;
      for (let guard = 0; guard < 256; guard++) {
        const cm = ctx.maps[cur.mi]!.map;
        const c = tileAt(cm, cur.x, cur.y);
        const forced = CURRENT[c] ?? SPIN[c] ?? (c === 'I' ? dir : null);
        if (!forced || c === 'X') break;
        dir = forced;
        const [dx, dy] = DELTA[forced];
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!passWall(cur.mi, nx, ny, cur.on) || objIndex(cur.mi, nx, ny) >= 0) break;
        const ne = elevAt(cm, nx, ny);
        if (cur.elev !== 0 && ne !== 0 && ne !== 15 && ne !== cur.elev) break;
        cur = { ...cur, x: nx, y: ny, elev: ne === 15 ? cur.elev : ne };
        acts.push({ type: 'slide', map: cm.key, to: { x: nx, y: ny }, cause: CURRENT[c] ? 'current' : SPIN[c] ? 'spin' : 'ice' });
      }
      const cm = ctx.maps[cur.mi]!;
      const w = cm.warpAt.get(cur.y * cm.map.width + cur.x);
      if (w && w.trigger === 'step' && w.to) {
        const tmi = ctx.idx.get(w.to.map);
        if (tmi === undefined) return;
        const action: PlanAction = { type: 'warp', map: cm.map.key, via: { x: cur.x, y: cur.y }, warp: w, press: null, to: w.to };
        const extra = mode === 'fewer-floors' ? COST.floor : 0;
        if (!inRegion(tmi)) {
          if (goal.kind === 'exit') {
            const nid = enc({ mi: tmi, x: w.to.x, y: w.to.y, elev: 0, surf: false, on: cur.on });
            if (!goalHit || d + cost < (dist.get(goalHit.id) ?? Infinity)) {
              dist.set(nid, d + cost);
              prev.set(nid, id);
              how.set(nid, [...acts, action]);
              reqs.set(nid, need);
              goalHit = { id: nid, action: { type: 'goal', map: w.to.map, at: { x: w.to.x, y: w.to.y }, goal: { kind: 'exit' } } };
            }
          }
          return;
        }
        const tm = ctx.maps[tmi]!.map;
        relax({ mi: tmi, x: w.to.x, y: w.to.y, elev: elevAt(tm, w.to.x, w.to.y), surf: false, on: cur.on }, cost + COST.warp + extra, [...acts, action], need);
        return;
      }
      relax(cur, cost, acts, need);
    };

    // Warps de apertar direção em cima do tile (tapete de saída, escada lateral).
    const wHere = mIdx.warpAt.get(s.y * m.width + s.x);
    if (wHere && wHere.trigger.startsWith('press-') && wHere.to) {
      const press = wHere.trigger.slice(6) as NavDirection;
      const tmi = ctx.idx.get(wHere.to.map);
      if (tmi !== undefined) {
        const action: PlanAction = { type: 'warp', map: m.key, via: { x: s.x, y: s.y }, warp: wHere, press, to: wHere.to };
        if (!inRegion(tmi)) {
          if (goal.kind === 'exit' && (!goalHit || d < (dist.get(goalHit.id) ?? Infinity))) {
            const nid = enc({ mi: tmi, x: wHere.to.x, y: wHere.to.y, elev: 0, surf: false, on: s.on });
            dist.set(nid, d + COST.warp);
            prev.set(nid, id);
            how.set(nid, [action]);
            reqs.set(nid, []);
            goalHit = { id: nid, action: { type: 'goal', map: wHere.to.map, at: { x: wHere.to.x, y: wHere.to.y }, goal: { kind: 'exit' } } };
          }
        } else {
          const tm = ctx.maps[tmi]!.map;
          const extra = mode === 'fewer-floors' ? COST.floor : 0;
          relax({ mi: tmi, x: wHere.to.x, y: wHere.to.y, elev: elevAt(tm, wHere.to.x, wHere.to.y), surf: false, on: s.on }, COST.warp + extra, [action]);
        }
      }
    }

    // Estátua-interruptor.
    const statue = mIdx.statueAt.get(s.y * m.width + s.x);
    if (statue && !both) relax({ ...s, on: !s.on }, COST.press, [{ type: 'press', map: m.key, statue, switchOnAfter: !s.on }]);

    for (const [dir, dx, dy] of DIRS) {
      let tmi = s.mi;
      let tx = s.x + dx;
      let ty = s.y + dy;
      let connect: PlanAction | null = null;
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) {
        const conn = m.connections.find((c) => c.dir === dir);
        const cmi = conn ? ctx.idx.get(conn.map) : undefined;
        if (!conn || cmi === undefined) continue;
        const cm = ctx.maps[cmi]!.map;
        if (dir === 'up') [tx, ty] = [tx - conn.offset, cm.height - 1];
        else if (dir === 'down') [tx, ty] = [tx - conn.offset, 0];
        else if (dir === 'left') [tx, ty] = [cm.width - 1, ty - conn.offset];
        else [tx, ty] = [0, ty - conn.offset];
        if (tx < 0 || ty < 0 || tx >= cm.width || ty >= cm.height) continue;
        tmi = cmi;
        connect = { type: 'connect', map: m.key, via: { x: s.x, y: s.y }, dir, to: { map: cm.key, x: tx, y: ty } };
        if (!inRegion(cmi)) {
          if (goal.kind === 'exit' && (!goalHit || d < (dist.get(goalHit.id) ?? Infinity))) {
            const nid = enc({ mi: cmi, x: tx, y: ty, elev: 0, surf: false, on: s.on });
            dist.set(nid, d + COST.connect);
            prev.set(nid, id);
            how.set(nid, [connect]);
            reqs.set(nid, []);
            goalHit = { id: nid, action: { type: 'goal', map: cm.key, at: { x: tx, y: ty }, goal: { kind: 'exit' } } };
          }
          continue;
        }
      }
      const T = ctx.maps[tmi]!;
      const tm = T.map;
      const tc = tileAt(tm, tx, ty);
      const pre: PlanAction[] = connect ? [connect] : [];
      const penalty = sight.size && sight.has(`${tm.key}:${tx}:${ty}`) ? COST.sight : 0;

      // Ledge: pula dois tiles, mesmo com colisão no tile da borda (ShouldJumpLedge vem antes).
      if (LEDGE[tc] === dir) {
        const lx = tx + dx;
        const ly = ty + dy;
        if (!passWall(tmi, lx, ly, s.on) || objIndex(tmi, lx, ly) >= 0) continue;
        const le = elevAt(tm, lx, ly);
        arrive(tmi, lx, ly, le === 15 ? s.elev : le, false, s.on, [...pre, { type: 'jump', map: tm.key, to: { x: lx, y: ly }, dir }], COST.jump + penalty, [], dir);
        continue;
      }
      if (!passWall(tmi, tx, ty, s.on)) continue;
      if (EDGE[here]?.includes(dir) || EDGE[tc]?.includes(OPPOSITE[dir])) continue;

      // Gatilho de script que empurra de volta.
      const need: Requirement[] = [];
      const b = T.blockerAt.get(ty * tm.width + tx);
      let event: string | undefined;
      if (b) {
        if (blockerActive(b, facts)) {
          if (!relaxed) continue;
          need.push({ kind: 'blocker', id: b.blocker.id });
        } else if (facts.variable(b.var) !== null ? facts.variable(b.var) === b.value : true) event = b.blocker.text;
      }

      // Objeto no caminho.
      const oi = objIndex(tmi, tx, ty);
      let remove: 'cut' | 'rock_smash' | 'interact' | null = null;
      let removeGfx: string | undefined;
      if (oi >= 0) {
        const o = tm.objects[oi]!;
        const obstacle = o.kind === 'npc' ? world.obstacles[o.gfx] : undefined;
        if (objectPresent(o, facts, collected, `${tm.key}#${oi}`, ng)) {
          if (obstacle?.remove && o.kind === 'npc') {
            // Obstáculo que sai com uma ação do jogador (fóssil, Snorlax com a Poké Flute).
            remove = 'interact';
            removeGfx = o.gfx;
            if (obstacle.remove.needsItem && !facts.items.has(obstacle.remove.needsItem)) {
              if (!relaxed) continue;
              need.push({ kind: 'object', place: { map: tm.key, x: tx, y: ty }, flag: o.hideFlag });
            }
          } else if (o.kind === 'cut-tree' || o.kind === 'smash-rock') {
            const mv = o.kind === 'cut-tree' ? 'cut' : 'rock_smash';
            remove = mv;
            if (!can(mv)) {
              if (!relaxed) continue;
              need.push({ kind: 'field-move', move: mv });
            }
          } else if (o.kind === 'npc' && o.hideFlag !== null && relaxed) {
            need.push({ kind: 'object', place: { map: tm.key, x: tx, y: ty }, flag: o.hideFlag });
          } else continue;
        }
      }

      // Elevação: começar ou terminar de surfar, ou bloqueio.
      const te = elevAt(tm, tx, ty);
      const mismatch = s.elev !== 0 && te !== 0 && te !== 15 && te !== s.elev;
      let surf = s.surf;
      let kind: 'move' | 'surf' | 'land' = 'move';
      if (mismatch) {
        if (s.surf && te === 3 && !isWaterTile(tc)) {
          surf = false;
          kind = 'land';
        } else if (!s.surf && s.elev === 3 && isWaterTile(tc) && tc !== 'F' && tc !== 'W') {
          if (!can('surf')) {
            if (!relaxed) continue;
            need.push({ kind: 'field-move', move: 'surf' });
          }
          surf = true;
          kind = 'surf';
        } else continue;
      }

      // Cachoeira: só subindo, surfando, com Waterfall; descendo, a correnteza leva.
      if (tc === 'W') {
        if (!s.surf) continue;
        if (dir === 'up') {
          if (!can('waterfall')) {
            if (!relaxed) continue;
            need.push({ kind: 'field-move', move: 'waterfall' });
          }
          let y = ty;
          while (tileAt(tm, tx, y - 1) === 'W') y--;
          y--;
          if (!passWall(tmi, tx, y, s.on)) continue;
          arrive(tmi, tx, y, elevAt(tm, tx, y), true, s.on, [...pre, { type: 'waterfall', map: tm.key, to: { x: tx, y } }], COST.waterfall, need, dir);
          continue;
        }
        if (dir !== 'down') continue;
      }

      const newElev = te === 15 || hereElev === 15 ? s.elev : te;
      const acts: PlanAction[] = [...pre];
      if (remove) acts.push({ type: 'remove', map: tm.key, at: { x: tx, y: ty }, to: { x: tx, y: ty }, dir, move: remove, objectId: `${tm.key}#${oi}`, ...(removeGfx ? { gfx: removeGfx } : {}) });
      else if (kind === 'surf') acts.push({ type: 'surf', map: tm.key, to: { x: tx, y: ty }, dir });
      else if (kind === 'land') acts.push({ type: 'land', map: tm.key, to: { x: tx, y: ty }, dir });
      else acts.push({ type: 'move', map: tm.key, to: { x: tx, y: ty }, dir, ...(tc === 'g' ? { gate: true } : {}), ...(event ? { event } : {}) });
      const cost = (remove ? COST.remove : kind === 'surf' ? COST.surf : connect ? COST.connect : COST.move) + penalty;
      arrive(tmi, tx, ty, newElev, surf, s.on, acts, cost, need, dir);
    }
  }
  if (!goalHit) return null;
  const actions: PlanAction[] = [goalHit.action];
  const requirements: Requirement[] = [];
  for (let cur = goalHit.id; prev.has(cur); cur = prev.get(cur)!) {
    actions.push(...[...how.get(cur)!].reverse());
    requirements.push(...(reqs.get(cur) ?? []));
  }
  actions.reverse();
  // A ação "goal" deve ser a última.
  const g = actions.findIndex((a) => a.type === 'goal');
  if (g >= 0 && g !== actions.length - 1) actions.push(actions.splice(g, 1)[0]!);
  return { start, switchOn, actions, cost: dist.get(goalHit.id) ?? 0, requirements };
}
