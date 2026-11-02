// Minimapa de um andar: paredes, grades (abertas/fechadas/desconhecidas), você, o caminho e o alvo.
import type { NavArea, NavTile } from '@pokeguide/domain';

const CELL = 8;

export function MiniMap({
  area,
  floor,
  switchOn,
  you,
  path,
  target,
}: {
  area: NavArea;
  floor: string;
  /** null = estado desconhecido. */
  switchOn: boolean | null;
  you: NavTile | null;
  path: NavTile[];
  target: NavTile | null;
}) {
  const f = area.floors.find((x) => x.map === floor);
  if (!f) return null;
  // Recorta a parte andável (o layout tem bordas mortas).
  let x0 = f.width;
  let x1 = 0;
  let y0 = f.height;
  let y1 = 0;
  f.grid.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') return;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }));
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(f.width - 1, x1 + 1);
  y1 = Math.min(f.height - 1, y1 + 1);
  const w = (x1 - x0 + 1) * CELL;
  const h = (y1 - y0 + 1) * CELL;
  const px = (x: number) => (x - x0) * CELL;
  const py = (y: number) => (y - y0) * CELL;
  const cells: React.ReactNode[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = f.grid[y]![x]!;
      if (c === '#') continue;
      const gate = c === '0' || c === '1';
      const open = gate && switchOn !== null ? (c === '1') === switchOn : null;
      const cls = !gate ? 'mm-floor' : open === null ? 'mm-gate unknown' : open ? 'mm-gate open' : 'mm-gate closed';
      cells.push(<rect key={`${x},${y}`} className={cls} x={px(x)} y={py(y)} width={CELL} height={CELL} />);
    }
  }
  const pois = area.pois.filter((p) => p.floor === floor);
  const center = (t: NavTile) => `${px(t.x) + CELL / 2},${py(t.y) + CELL / 2}`;
  const line = you && path.length ? [you, ...path].map(center).join(' ') : '';
  const gateState = switchOn === null ? 'estado das grades desconhecido' : 'verde = aberta, vermelho = fechada';
  return (
    <figure className="minimap">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Mapa do ${f.label}: ${gateState}`}>
        <rect className="mm-wall" x={0} y={0} width={w} height={h} />
        {cells}
        {pois.map((p) => {
          if (p.kind === 'stairs') return <rect key={p.id} className="mm-stairs" x={px(p.x) + 1} y={py(p.y) + 1} width={CELL - 2} height={CELL - 2} />;
          if (p.kind === 'fall') return p.tiles.map((t) => <circle key={`${p.id}-${t.x}`} className="mm-hole" cx={px(t.x) + CELL / 2} cy={py(t.y) + CELL / 2} r={CELL / 2 - 1} />);
          if (p.kind === 'switch') return <rect key={p.id} className="mm-statue" x={px(p.x) + 1} y={py(p.y) + 1} width={CELL - 2} height={CELL - 2} rx={2} />;
          if (p.kind === 'item') return <circle key={p.id} className="mm-item" cx={px(p.x) + CELL / 2} cy={py(p.y) + CELL / 2} r={CELL / 3} />;
          return null;
        })}
        {line && <polyline className="mm-path" points={line} />}
        {target && <circle className="mm-target" cx={px(target.x) + CELL / 2} cy={py(target.y) + CELL / 2} r={CELL / 2 + 1} />}
        {you && <circle className="mm-you" cx={px(you.x) + CELL / 2} cy={py(you.y) + CELL / 2} r={CELL / 2} />}
      </svg>
      <figcaption className="fine">
        {f.label} · <span className="mm-key you" /> você · <span className="mm-key target" /> próximo ponto · <span className="mm-key stairs" /> escada ·{' '}
        <span className="mm-key statue" /> estátua · grades: {switchOn === null ? 'estado desconhecido (amarelo)' : 'verde aberta, vermelha fechada'}
      </figcaption>
    </figure>
  );
}
