// Planejador puro: menor caminho em (andar, x, y, interruptor), com escadas, buracos e estátuas.
// Nenhum tile é atravessado se não for livre no estado assumido do interruptor.
import type { NavArea, NavDirection, NavFloor, NavPlace, NavPoi, NavPoiOf, NavTile, RouteMode } from './types.ts';

export const DIRS: ReadonlyArray<readonly [NavDirection, number, number]> = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
];

/** `true`/`false`: estado assumido do interruptor. `'both'`: só tiles livres nos dois estados, sem apertar estátuas. */
export type SwitchAssumption = boolean | 'both';

/** `items`: o mais perto dentre esses pontos de item (rota completa). */
export type PlanGoal = { kind: 'item'; item: string } | { kind: 'items'; poiIds: readonly string[] } | { kind: 'exit' } | { kind: 'any-switch' };

export type PlanAction =
  | { type: 'move'; floor: string; to: NavTile }
  | { type: 'warp'; floor: string; via: NavTile; poi: NavPoiOf<'stairs'> | NavPoiOf<'fall'>; to: NavPlace }
  | { type: 'press'; floor: string; poi: NavPoiOf<'switch'>; switchOnAfter: boolean }
  | { type: 'goal'; floor: string; poi: NavPoi };

export interface Plan {
  start: NavPlace;
  switchOn: SwitchAssumption;
  actions: PlanAction[];
  cost: number;
}

export interface PlanOptions {
  mode?: RouteMode;
  /** Treinadores já vencidos (não desafiam mais). */
  defeatedTrainers?: ReadonlySet<string>;
}

interface Ctx {
  floors: NavFloor[];
  /** Por andar, por tile: bit 0 = livre desligado, bit 1 = livre ligado (objetos já descontados). */
  pass: Uint8Array[];
  /** Por andar, por tile: índice em `warpList` (+1; 0 = nenhum). */
  warpAt: Int32Array[];
  warpList: Array<{ poi: NavPoiOf<'stairs'> | NavPoiOf<'fall'>; to: NavPlace; toFi: number }>;
  /** Por andar, por tile: índice da estátua em `switchList` (+1) para quem está em `stand`. */
  switchAt: Int32Array[];
  switchList: NavPoiOf<'switch'>[];
  floorIdx: Map<string, number>;
  objects: Set<string>;
  warps: Map<string, { poi: NavPoiOf<'stairs'> | NavPoiOf<'fall'>; to: NavPlace }>;
  switchesByStand: Map<string, NavPoiOf<'switch'>>;
  offsets: number[];
  total: number;
}

const ctxCache = new WeakMap<NavArea, Ctx>();
const key = (floor: string, x: number, y: number) => `${floor}:${x}:${y}`;

function context(area: NavArea): Ctx {
  const cached = ctxCache.get(area);
  if (cached) return cached;
  const floorIdx = new Map(area.floors.map((f, i) => [f.map, i]));
  const objects = new Set(area.floors.flatMap((f) => f.objects.map((o) => key(f.map, o.x, o.y))));
  const warps: Ctx['warps'] = new Map();
  const switchesByStand: Ctx['switchesByStand'] = new Map();
  for (const p of area.pois) {
    if (p.kind === 'stairs') warps.set(key(p.floor, p.x, p.y), { poi: p, to: p.to });
    if (p.kind === 'fall') for (const t of p.tiles) warps.set(key(p.floor, t.x, t.y), { poi: p, to: t.to });
    if (p.kind === 'switch') switchesByStand.set(key(p.floor, p.stand.x, p.stand.y), p);
  }
  const offsets: number[] = [];
  let total = 0;
  for (const f of area.floors) {
    offsets.push(total);
    total += f.width * f.height * 2;
  }
  const pass = area.floors.map((f) => {
    const a = new Uint8Array(f.width * f.height);
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (objects.has(key(f.map, x, y))) continue;
        const c = f.grid[y]![x];
        a[y * f.width + x] = c === '.' ? 3 : c === '0' ? 1 : c === '1' ? 2 : 0;
      }
    }
    return a;
  });
  const warpList: Ctx['warpList'] = [];
  const warpAt = area.floors.map((f) => new Int32Array(f.width * f.height));
  for (const [k, w] of warps) {
    const [floor, x, y] = k.split(':');
    const fi = floorIdx.get(floor!)!;
    warpList.push({ ...w, toFi: floorIdx.get(w.to.floor)! });
    warpAt[fi]![Number(y) * area.floors[fi]!.width + Number(x)] = warpList.length;
  }
  const switchList: NavPoiOf<'switch'>[] = [];
  const switchAt = area.floors.map((f) => new Int32Array(f.width * f.height));
  for (const sw of switchesByStand.values()) {
    const fi = floorIdx.get(sw.floor)!;
    switchList.push(sw);
    switchAt[fi]![sw.stand.y * area.floors[fi]!.width + sw.stand.x] = switchList.length;
  }
  const ctx = { floors: area.floors, pass, warpAt, warpList, switchAt, switchList, floorIdx, objects, warps, switchesByStand, offsets, total };
  ctxCache.set(area, ctx);
  return ctx;
}

/** O tile é livre com o interruptor nesse estado? Objetos (Poké Balls, treinadores) bloqueiam. */
export function isPassable(area: NavArea, floor: string, x: number, y: number, switchOn: SwitchAssumption): boolean {
  const ctx = context(area);
  const fi = ctx.floorIdx.get(floor);
  if (fi === undefined) return false;
  return passAt(ctx, fi, x, y, switchOn);
}

function passAt(ctx: Ctx, fi: number, x: number, y: number, switchOn: SwitchAssumption): boolean {
  const f = ctx.floors[fi]!;
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return false;
  const v = ctx.pass[fi]![y * f.width + x]!;
  return switchOn === 'both' ? v === 3 : (v & (switchOn ? 2 : 1)) !== 0;
}

/** Tile que depende do interruptor (uma grade). */
export function isGateTile(area: NavArea, floor: string, x: number, y: number): boolean {
  const f = area.floors.find((fl) => fl.map === floor);
  const c = f?.grid[y]?.[x];
  return c === '0' || c === '1';
}

/** Tiles vistos por treinadores ainda não vencidos (linha reta até o alcance, parando em parede). */
export function trainerSight(area: NavArea, defeated: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of area.pois) {
    if (p.kind !== 'trainer' || defeated.has(p.trainer)) continue;
    for (const d of p.facing) {
      const [, dx, dy] = DIRS.find(([n]) => n === d)!;
      for (let i = 1; i <= p.sight; i++) {
        const x = p.x + dx * i;
        const y = p.y + dy * i;
        if (!isPassable(area, p.floor, x, y, 'both') && !isGateTile(area, p.floor, x, y)) break;
        out.set(key(p.floor, x, y), p.trainer);
      }
    }
  }
  return out;
}

class Heap {
  private items: Array<[number, number]> = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, id: number) {
    const a = this.items;
    a.push([cost, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
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

const COST = { move: 1, warp: 2, press: 4, sightPenalty: 6, floorPenalty: 40 };

/**
 * Menor caminho até o objetivo. Com `switchOn` booleano, pode apertar estátuas (o estado muda).
 * Retorna null se não há rota comprovada a partir desse estado.
 */
export function planRoute(area: NavArea, start: NavPlace, switchOn: SwitchAssumption, goal: PlanGoal, opts: PlanOptions = {}): Plan | null {
  const ctx = context(area);
  const startFi = ctx.floorIdx.get(start.floor);
  if (startFi === undefined) return null;
  const mode = opts.mode ?? 'fast';
  const sight = mode === 'safe' ? trainerSight(area, opts.defeatedTrainers ?? new Set()) : new Map<string, string>();
  const enc = (fi: number, x: number, y: number, on: boolean) => ctx.offsets[fi]! + (y * ctx.floors[fi]!.width + x) * 2 + (on ? 1 : 0);
  const dec = (id: number) => {
    let fi = ctx.offsets.length - 1;
    while (ctx.offsets[fi]! > id) fi--;
    const local = id - ctx.offsets[fi]!;
    const on = local % 2 === 1;
    const cell = (local - (on ? 1 : 0)) / 2;
    const w = ctx.floors[fi]!.width;
    return { fi, x: cell % w, y: Math.floor(cell / w), on };
  };
  const both = switchOn === 'both';
  const dist = new Float64Array(ctx.total).fill(Infinity);
  const prev = new Int32Array(ctx.total).fill(-1);
  const how: Array<PlanAction | undefined> = new Array(ctx.total);
  const startId = enc(startFi, start.x, start.y, both ? false : switchOn);
  dist[startId] = 0;
  const heap = new Heap();
  heap.push(0, startId);

  // Tiles de chegada ao objetivo, marcados uma vez por chamada.
  const goalPoi = ctx.floors.map((f) => new Map<number, NavPoi>());
  const mark = (floor: string, x: number, y: number, poi: NavPoi) => {
    const fi = ctx.floorIdx.get(floor);
    if (fi === undefined) return;
    const f = ctx.floors[fi]!;
    if (x >= 0 && y >= 0 && x < f.width && y < f.height) goalPoi[fi]!.set(y * f.width + x, poi);
  };
  for (const p of area.pois) {
    if (goal.kind === 'any-switch' && p.kind === 'switch') mark(p.floor, p.stand.x, p.stand.y, p);
    if (goal.kind === 'exit' && p.kind === 'exit') mark(p.floor, p.x, p.y, p);
    if (goal.kind === 'item' && p.kind === 'item' && p.item === goal.item) for (const [, dx, dy] of DIRS) mark(p.floor, p.x + dx, p.y + dy, p);
    if (goal.kind === 'items' && p.kind === 'item' && goal.poiIds.includes(p.id)) for (const [, dx, dy] of DIRS) mark(p.floor, p.x + dx, p.y + dy, p);
  }

  while (heap.size) {
    const [d, id] = heap.pop();
    if (d > dist[id]!) continue;
    const st = dec(id);
    const fl = ctx.floors[st.fi]!;
    const floor = fl.map;
    const g = goalPoi[st.fi]!.get(st.y * fl.width + st.x);
    if (g) {
      const actions: PlanAction[] = [{ type: 'goal', floor, poi: g }];
      for (let cur = id; prev[cur]! >= 0; cur = prev[cur]!) actions.push(how[cur]!);
      actions.reverse();
      return { start, switchOn, actions, cost: d };
    }
    const relax = (nid: number, cost: number, action: () => PlanAction) => {
      if (d + cost < dist[nid]!) {
        dist[nid] = d + cost;
        prev[nid] = id;
        how[nid] = action();
        heap.push(d + cost, nid);
      }
    };
    for (const [, dx, dy] of DIRS) {
      const nx = st.x + dx;
      const ny = st.y + dy;
      if (!passAt(ctx, st.fi, nx, ny, both ? 'both' : st.on)) continue;
      const penalty = sight.size && sight.has(key(floor, nx, ny)) ? COST.sightPenalty : 0;
      const wi = ctx.warpAt[st.fi]![ny * fl.width + nx]!;
      if (wi) {
        const w = ctx.warpList[wi - 1]!;
        const extra = mode === 'fewer-floors' ? COST.floorPenalty : 0;
        relax(enc(w.toFi, w.to.x, w.to.y, st.on), COST.warp + penalty + extra, () => ({ type: 'warp', floor, via: { x: nx, y: ny }, poi: w.poi, to: w.to }));
      } else {
        relax(enc(st.fi, nx, ny, st.on), COST.move + penalty, () => ({ type: 'move', floor, to: { x: nx, y: ny } }));
      }
    }
    const si = ctx.switchAt[st.fi]![st.y * fl.width + st.x]!;
    if (si && !both) {
      const sw = ctx.switchList[si - 1]!;
      relax(enc(st.fi, st.x, st.y, !st.on), COST.press, () => ({ type: 'press', floor, poi: sw, switchOnAfter: !st.on }));
    }
  }
  return null;
}
