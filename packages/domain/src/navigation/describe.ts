// Textos de orientação: referências visíveis no jogo (escada, buraco, estátua, grade), nunca coordenadas.
import type { NavArea, NavDirection, NavFloor, NavPoi, NavTile } from './types.ts';

export interface NavNames {
  item: (key: string) => string;
  trainer: (key: string) => string;
}

export const defaultNames: NavNames = { item: (k) => k, trainer: (k) => k };

export const floorLabel = (area: NavArea, map: string) => area.floors.find((f) => f.map === map)?.label ?? map;

const bboxCache = new WeakMap<NavFloor, { x0: number; x1: number; y0: number; y1: number }>();
/** Retângulo da parte andável do andar (o layout tem bordas e áreas mortas). */
function bbox(f: NavFloor) {
  const c = bboxCache.get(f);
  if (c) return c;
  let x0 = f.width;
  let x1 = 0;
  let y0 = f.height;
  let y1 = 0;
  f.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  });
  const b = { x0, x1, y0, y1 };
  bboxCache.set(f, b);
  return b;
}

/** "no canto superior esquerdo", "no meio do andar"... pela posição na tela do jogo. */
export function zone(area: NavArea, floor: string, t: NavTile): string {
  const f = area.floors.find((fl) => fl.map === floor);
  if (!f) return '';
  const b = bbox(f);
  const third = (v: number, lo: number, hi: number) => {
    const r = (v - lo) / Math.max(1, hi - lo);
    return r < 1 / 3 ? 0 : r > 2 / 3 ? 2 : 1;
  };
  const col = third(t.x, b.x0, b.x1);
  const row = third(t.y, b.y0, b.y1);
  const names = [
    ['no canto superior esquerdo', 'na parte de cima, no meio', 'no canto superior direito'],
    ['no lado esquerdo', 'no meio do andar', 'no lado direito'],
    ['no canto inferior esquerdo', 'na parte de baixo, no meio', 'no canto inferior direito'],
  ];
  return names[row]![col]!;
}

/**
 * Qual dentre as iguais no mesmo andar ("a da esquerda", "o de cima"...). Vazio quando a zona já
 * distingue. `feminine` concorda com o substantivo (escada/estátua vs. buraco).
 */
export function ordinal(area: NavArea, target: NavPoi, feminine: boolean): string {
  const same = area.pois
    .filter((p) => p.floor === target.floor && p.kind === target.kind && (p.kind !== 'stairs' || target.kind !== 'stairs' || p.direction === target.direction))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (same.length < 2) return '';
  const zones = same.map((p) => zone(area, p.floor, p));
  if (new Set(zones).size === zones.length) return '';
  const art = feminine ? 'a' : 'o';
  const distinct = (vals: number[]) => new Set(vals).size === vals.length;
  const byX = distinct(same.map((p) => p.x));
  const byY = distinct(same.map((p) => p.y));
  if (!byX && !byY) return '';
  const order = byX ? same : [...same].sort((a, b) => a.y - b.y);
  const i = order.findIndex((p) => p.id === target.id);
  const [first, mid, last] = byX
    ? [`${art} da esquerda`, `${art} do meio`, `${art} da direita`]
    : [`${art} de cima`, `${art} do meio`, `${art} de baixo`];
  if (order.length === 2) return i === 0 ? first : last;
  if (order.length === 3) return i === 1 ? mid : byX ? `${art} mais à ${i === 0 ? 'esquerda' : 'direita'}` : i === 0 ? first : last;
  return '';
}

export const DIR_TEXT: Record<NavDirection, string> = { up: 'para cima', down: 'para baixo', left: 'para a esquerda', right: 'para a direita' };

/** Primeiro trecho reto do caminho: "comece indo para a esquerda (uns 4 passos)". */
export function firstLeg(from: NavTile, path: readonly NavTile[]): string {
  if (!path.length) return '';
  const dir = (a: NavTile, b: NavTile): NavDirection => (b.x < a.x ? 'left' : b.x > a.x ? 'right' : b.y < a.y ? 'up' : 'down');
  const d0 = dir(from, path[0]!);
  let n = 1;
  while (n < path.length && dir(path[n - 1]!, path[n]!) === d0) n++;
  return `comece indo ${DIR_TEXT[d0]} (${n === 1 ? '1 passo' : `uns ${n} passos`})`;
}

export const switchColor = (on: boolean) => (on ? 'vermelhos' : 'pretos');
export const switchState = (on: boolean) => (on ? 'ligado' : 'desligado');
