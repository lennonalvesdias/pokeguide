// Textos de orientação: referências visíveis no jogo (porta, escada, buraco, estátua, grade, borda do mapa),
// nunca coordenadas. Nomes de lugares em inglês, como no cartucho.
import { tileAt } from './planner.ts';
import type { NavArea, NavDirection, NavTile, NavWorld, WorldMap, WorldWarp } from './types.ts';

export interface NavNames {
  item: (key: string) => string;
  trainer: (key: string) => string;
}

export const defaultNames: NavNames = { item: (k) => k, trainer: (k) => k };

const MAPSEC_NAME: Record<string, string> = {
  POKEMON_MANSION: 'Pokémon Mansion',
  POKEMON_TOWER: 'Pokémon Tower',
  POKEMON_LEAGUE: 'Pokémon League',
  S_S_ANNE: 'S.S. Anne',
  MT_MOON: 'Mt. Moon',
  KANTO_VICTORY_ROAD: 'Victory Road',
  KANTO_SAFARI_ZONE: 'Safari Zone',
  DIGLETTS_CAVE: "Diglett's Cave",
  UNDERGROUND_PATH: 'Underground Path',
  UNDERGROUND_PATH_2: 'Underground Path',
  SILPH_CO: 'Silph Co.',
};

export function mapsecName(mapsec: string): string {
  if (MAPSEC_NAME[mapsec]) return MAPSEC_NAME[mapsec];
  const route = mapsec.match(/^ROUTE_(\d+)$/);
  if (route) return `Route ${route[1]}`;
  return mapsec
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const PART: Array<[RegExp, string]> = [
  [/^PokemonCenter_1F$/, 'Centro Pokémon'],
  [/^PokemonCenter_2F$/, 'Centro Pokémon (2º andar)'],
  [/^Mart$/, 'Poké Mart'],
  [/^Gym$/, 'Ginásio'],
  [/House\d*$/, 'casa'],
];

/** Cômodos dentro de prédios e navios. */
const ROOM: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/Corridor/, () => 'corredor'],
  [/Room(\d+)/, (m) => `cabine ${m[1]}`],
  [/Deck/, () => 'convés'],
  [/Kitchen/, () => 'cozinha'],
  [/CaptainsOffice/, () => 'sala do capitão'],
  [/Exterior/, () => 'cais'],
  [/Elevator/, () => 'elevador'],
];

const dungeonCache = new WeakMap<NavArea, boolean>();
/** Área de um lugar só (todos os mapas da mesma seção), não o mundo inteiro. */
function dungeonArea(world: NavWorld, area: NavArea): boolean {
  let v = dungeonCache.get(area);
  if (v === undefined) {
    const secs = new Set(world.maps.filter((m) => area.maps.includes(m.key)).map((m) => m.mapsec));
    dungeonCache.set(area, (v = secs.size === 1));
  }
  return v;
}

/** Nome do mapa: rótulo da área (ex.: "B1F"), senão "Centro Pokémon de Viridian City", "Route 2"... */
export function mapName(world: NavWorld, area: NavArea | null, key: string): string {
  const m = world.maps.find((x) => x.key === key);
  if (!m) return key;
  const sec = mapsecName(m.mapsec);
  const label = area?.labels[key];
  if (label) return area!.maps.length > 1 && !area!.name.includes(label) ? `${area!.name} ${label}` : label;
  const rest = key.split('_').slice(1).join('_');
  if (!rest) return sec;
  const gate = rest.match(/^(?:(\w+?)_)?(North|South|East|West)Entrance(?:_(\dF))?$/);
  if (gate) {
    const dir = { North: 'norte', South: 'sul', East: 'leste', West: 'oeste' }[gate[2] as 'North'];
    const of = gate[1] ? gate[1].replace(/([a-z])([A-Z])/g, '$1 $2') : sec;
    return `portão ${dir} ${gate[1] ? 'da' : 'da'} ${of}${gate[3] ? ` (${gate[3]})` : ''}`;
  }
  for (const [re, name] of PART) if (re.test(rest)) return `${name} de ${sec}`;
  const floor = rest.match(/(?:^|_)(B?\d+F)(?:_|$)/)?.[1];
  const room = ROOM.find(([re]) => re.test(rest));
  const roomText = room ? room[1](rest.match(room[0])!) : '';
  if (area && dungeonArea(world, area) && area.maps.includes(key)) return [sec, floor, roomText && `(${roomText})`].filter(Boolean).join(' ');
  const words = rest
    .replace(/_?(B?\d+F)$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  if (!words.trim()) return floor ? `${sec} ${floor}` : sec;
  return `${sec} (${words}${floor ? ` ${floor}` : ''})`;
}

const bboxCache = new WeakMap<WorldMap, { x0: number; x1: number; y0: number; y1: number }>();
function bbox(m: WorldMap) {
  const c = bboxCache.get(m);
  if (c) return c;
  let x0 = m.width;
  let x1 = 0;
  let y0 = m.height;
  let y1 = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (tileAt(m, x, y) === '#') continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const b = { x0, x1, y0, y1 };
  bboxCache.set(m, b);
  return b;
}

/** "no canto superior esquerdo", "no meio do mapa"... pela posição na tela do jogo. */
export function zone(m: WorldMap, t: NavTile): string {
  const b = bbox(m);
  const third = (v: number, lo: number, hi: number) => {
    const r = (v - lo) / Math.max(1, hi - lo);
    return r < 1 / 3 ? 0 : r > 2 / 3 ? 2 : 1;
  };
  const names = [
    ['no canto superior esquerdo', 'na parte de cima, no meio', 'no canto superior direito'],
    ['no lado esquerdo', 'no meio do mapa', 'no lado direito'],
    ['no canto inferior esquerdo', 'na parte de baixo, no meio', 'no canto inferior direito'],
  ];
  return names[third(t.y, b.y0, b.y1)]![third(t.x, b.x0, b.x1)]!;
}

/**
 * Qual dentre as iguais no mesmo mapa ("a da esquerda", "o de cima"...). Vazio quando a zona já
 * distingue. `feminine` concorda com o substantivo.
 */
export function ordinalAmong(m: WorldMap, all: readonly NavTile[], target: NavTile, feminine: boolean): string {
  if (all.length < 2) return '';
  const zones = all.map((p) => zone(m, p));
  if (new Set(zones).size === zones.length) return '';
  const art = feminine ? 'a' : 'o';
  const distinct = (vals: number[]) => new Set(vals).size === vals.length;
  const byX = distinct(all.map((p) => p.x));
  const byY = distinct(all.map((p) => p.y));
  if (!byX && !byY) return '';
  const order = [...all].sort((a, b) => (byX ? a.x - b.x : a.y - b.y));
  const i = order.findIndex((p) => p.x === target.x && p.y === target.y);
  const [first, mid, last] = byX ? [`${art} da esquerda`, `${art} do meio`, `${art} da direita`] : [`${art} de cima`, `${art} do meio`, `${art} de baixo`];
  if (order.length === 2) return i === 0 ? first : last;
  if (order.length === 3) return i === 1 ? mid : byX ? `${art} mais à ${i === 0 ? 'esquerda' : 'direita'}` : i === 0 ? first : last;
  return '';
}

/**
 * Warps que o jogador enxerga como uma coisa só (os tiles lado a lado de uma escada, de um buraco ou de
 * um tapete) e que levam ao mesmo mapa.
 */
export function warpGroup(m: WorldMap, w: WorldWarp): WorldWarp[] {
  const same = m.warps.filter((o) => o.kind === w.kind && o.trigger === w.trigger && o.to?.map === w.to?.map);
  const group = [w];
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of same) {
      if (group.includes(o)) continue;
      if (group.some((g) => Math.abs(g.x - o.x) + Math.abs(g.y - o.y) === 1)) {
        group.push(o);
        grew = true;
      }
    }
  }
  return group;
}

/** Artigo de nomes genéricos ("o portão...", "a casa...", "o Centro Pokémon..."); nomes próprios não têm. */
export function article(name: string): 'o' | 'a' | '' {
  if (/^(portão|Centro Pokémon|Poké Mart|Ginásio|ponto)/.test(name)) return 'o';
  if (/^(casa|cabine|sala|escada)/.test(name)) return 'a';
  return '';
}
/** "no portão", "na casa", "em Viridian City". */
export const inName = (name: string) => ({ o: 'no', a: 'na', '': 'em' })[article(name)] + ' ' + name;
/** "para o portão", "para a casa", "para Route 2". */
export const toName = (name: string) => `para ${article(name) ? `${article(name)} ` : ''}${name}`;

export const DIR_TEXT: Record<NavDirection, string> = { up: 'para cima', down: 'para baixo', left: 'para a esquerda', right: 'para a direita' };
export const EDGE_TEXT: Record<NavDirection, string> = { up: 'pela borda de cima (norte)', down: 'pela borda de baixo (sul)', left: 'pela borda esquerda (oeste)', right: 'pela borda direita (leste)' };

/** Primeiro trecho reto do caminho: "comece indo para a esquerda (uns 4 passos)". */
export function firstLeg(from: NavTile, path: readonly NavTile[]): string {
  if (!path.length) return '';
  const dir = (a: NavTile, b: NavTile): NavDirection => (b.x < a.x ? 'left' : b.x > a.x ? 'right' : b.y < a.y ? 'up' : 'down');
  const d0 = dir(from, path[0]!);
  let n = 1;
  while (n < path.length && Math.abs(path[n]!.x - path[n - 1]!.x) + Math.abs(path[n]!.y - path[n - 1]!.y) === 1 && dir(path[n - 1]!, path[n]!) === d0) n++;
  return `comece indo ${DIR_TEXT[d0]} (${n === 1 ? '1 passo' : `uns ${n} passos`})`;
}

export const switchColor = (on: boolean) => (on ? 'vermelhos' : 'pretos');
export const switchState = (on: boolean) => (on ? 'ligado' : 'desligado');

/**
 * O caminho em trechos retos: "6 passos para cima, 4 para a direita e 8 para cima".
 * Um salto de dois tiles (ledge) vira "pule a borda para baixo".
 */
export function describeRuns(from: NavTile, path: readonly NavTile[]): string {
  const parts: string[] = [];
  let prev = from;
  let run: { dir: NavDirection; n: number } | null = null;
  const flush = () => {
    if (run) parts.push(`${run.n} ${run.n === 1 ? 'passo' : 'passos'} ${DIR_TEXT[run.dir]}`);
    run = null;
  };
  for (const t of path) {
    const dx = t.x - prev.x;
    const dy = t.y - prev.y;
    const dir: NavDirection = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
    if (Math.abs(dx) + Math.abs(dy) === 2) {
      flush();
      parts.push(`pule a borda ${DIR_TEXT[dir]}`);
    } else if (Math.abs(dx) + Math.abs(dy) === 1) {
      if (run && run.dir === dir) run.n++;
      else {
        flush();
        run = { dir, n: 1 };
      }
    }
    prev = t;
  }
  flush();
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}
