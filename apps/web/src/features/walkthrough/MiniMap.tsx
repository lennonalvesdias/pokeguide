// Minimapa de um mapa do jogo: paredes, água, ledges, grades (abertas/fechadas/desconhecidas), portas e
// escadas, você, o caminho do passo e o alvo.
import type { NavArea, NavTile, WorldMap } from '@pokeguide/domain';

const CELL = 8;
const LEDGE = new Set(['v', '^', '{', '}']);
const WATER = new Set(['~', 'F', 'W', '8', '2', '4', '6']);

export function MiniMap({
  map,
  area,
  switchOn,
  you,
  path,
  target,
}: {
  map: WorldMap;
  area: NavArea;
  /** null = estado desconhecido. */
  switchOn: boolean | null;
  you: NavTile | null;
  path: NavTile[];
  target: NavTile | null;
}) {
  // Recorta a parte andável (o layout tem bordas mortas).
  let x0 = map.width;
  let x1 = 0;
  let y0 = map.height;
  let y1 = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y * map.width + x] === '#') continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(map.width - 1, x1 + 1);
  y1 = Math.min(map.height - 1, y1 + 1);
  const w = (x1 - x0 + 1) * CELL;
  const h = (y1 - y0 + 1) * CELL;
  const px = (x: number) => (x - x0) * CELL;
  const py = (y: number) => (y - y0) * CELL;
  const center = (t: NavTile) => `${px(t.x) + CELL / 2},${py(t.y) + CELL / 2}`;
  // Tiles das grades do interruptor da área (Pokémon Mansion).
  const switchAt = new Map<number, { c: string; set: boolean }>();
  for (const ov of map.overlays) {
    if (!('flag' in ov.when) || ov.when.flag !== area.switch?.flag.id) continue;
    for (const t of ov.tiles) switchAt.set(t.y * map.width + t.x, { c: t.c, set: ov.when.set });
  }
  const cells: React.ReactNode[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = map.tiles[y * map.width + x]!;
      if (c === '#' && !switchAt.has(y * map.width + x)) continue;
      let cls = 'mm-floor';
      if (WATER.has(c)) cls = 'mm-water';
      else if (LEDGE.has(c)) cls = 'mm-ledge';
      const sw = switchAt.get(y * map.width + x);
      if (sw) {
        const open = switchOn === null ? null : (switchOn === sw.set ? sw.c : c) !== '#';
        cls = open === null ? 'mm-gate unknown' : open ? 'mm-gate open' : 'mm-gate closed';
      }
      cells.push(<rect key={`${x},${y}`} className={cls} x={px(x)} y={py(y)} width={CELL} height={CELL} />);
    }
  }
  const line = you && path.length ? [you, ...path].map(center).join(' ') : '';
  return (
    <figure className="minimap">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Mapa de ${map.name}`}>
        <rect className="mm-wall" x={0} y={0} width={w} height={h} />
        {cells}
        {map.warps
          .filter((wp) => wp.trigger !== 'none')
          .map((wp) => (
            <rect key={`w${wp.x},${wp.y}`} className={wp.kind === 'fall' ? 'mm-hole' : 'mm-stairs'} x={px(wp.x) + 1} y={py(wp.y) + 1} width={CELL - 2} height={CELL - 2} />
          ))}
        {(area.switch?.statues ?? [])
          .filter((s) => s.map === map.key)
          .map((s) => (
            <rect key={s.id} className="mm-statue" x={px(s.x) + 1} y={py(s.y) + 1} width={CELL - 2} height={CELL - 2} rx={2} />
          ))}
        {map.objects
          .filter((o) => o.kind === 'item')
          .map((o) => (
            <circle key={`i${o.x},${o.y}`} className="mm-item" cx={px(o.x) + CELL / 2} cy={py(o.y) + CELL / 2} r={CELL / 3} />
          ))}
        {line && <polyline className="mm-path" points={line} />}
        {target && <circle className="mm-target" cx={px(target.x) + CELL / 2} cy={py(target.y) + CELL / 2} r={CELL / 2 + 1} />}
        {you && <circle className="mm-you" cx={px(you.x) + CELL / 2} cy={py(you.y) + CELL / 2} r={CELL / 2} />}
      </svg>
      <figcaption className="fine">
        <span className="mm-key you" /> você · <span className="mm-key target" /> próximo ponto · <span className="mm-key stairs" /> porta/escada ·{' '}
        <span className="mm-key water" /> água
        {switchAt.size > 0 && <> · grades: {switchOn === null ? 'estado desconhecido (amarelo)' : 'verde aberta, vermelha fechada'}</>}
      </figcaption>
    </figure>
  );
}
