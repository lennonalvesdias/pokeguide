// Quebra-cabeças de Strength resolvidos a partir dos dados: qual pedra vai a qual botão vem do script do
// botão (copyobjectxytoperm LOCALID_..._BOULDER); a sequência de empurrões vem de uma busca em largura com
// as regras de field_player_avatar.c (TryPushBoulder: a pedra anda se o destino não tem colisão, objeto
// nem diferença de elevação, ou se é um buraco).

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const LEDGE = new Set(['v', '^', '{', '}']);
const WATER = new Set(['~', 'F', 'W', '8', '2', '4', '6']);

/**
 * Resolve uma pedra até o alvo. `closed` = tiles fechados enquanto o quebra-cabeça não é resolvido.
 * Retorna os empurrões agrupados ({stand, from, dir, times}) ou null.
 */
export function solveBoulder(map, boulder, target, starts, closed, opts = {}) {
  const targets = Array.isArray(target) ? target : [target];
  const isTarget = (x, y) => targets.some((t) => t.x === x && t.y === y);
  // Buracos: a pedra cai neles; o jogador também, então não pisa.
  const holes = new Set((opts.holes ?? []).map((h) => h.y * map.width + h.x));
  const present = opts.present ? new Set(opts.present.map((o) => o.y * map.width + o.x)) : null;
  const { width: W, height: H } = map;
  const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : closed.has(y * W + x) ? '#' : map.tiles[y * W + x]);
  const elev = (x, y) => parseInt(map.elev[y * W + x] ?? '0', 16);
  const others = new Set(
    map.objects
      .filter((o) => !(o.x === boulder.x && o.y === boulder.y))
      .filter((o) => o.kind !== 'boulder' || !present || present.has(o.y * W + o.x))
      .map((o) => o.y * W + o.x),
  );
  const walk = (x, y) => {
    const c = tile(x, y);
    return c !== '#' && !LEDGE.has(c) && !WATER.has(c) && !others.has(y * W + x) && !holes.has(y * W + x);
  };
  const boulderElev = elev(boulder.x, boulder.y);
  const boulderCan = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H || others.has(y * W + x)) return false;
    const c = tile(x, y);
    if (holes.has(y * W + x)) return true;
    if (c === '#' || LEDGE.has(c) || WATER.has(c)) return false;
    const e = elev(x, y);
    return e === 0 || e === 15 || e === boulderElev;
  };
  // Região que o jogador alcança sem passar pela pedra (regra de elevação do jogo).
  const region = (px, py, bx, by) => {
    const seen = new Set();
    const q = [[px, py, elev(px, py)]];
    while (q.length) {
      const [x, y, pe] = q.pop();
      const k = y * W + x;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const [dx, dy] of Object.values(DIRS)) {
        const nx = x + dx;
        const ny = y + dy;
        if ((nx === bx && ny === by) || !walk(nx, ny) || seen.has(ny * W + nx)) continue;
        const te = elev(nx, ny);
        if (pe !== 0 && te !== 0 && te !== 15 && te !== pe) continue;
        q.push([nx, ny, te === 15 ? pe : te]);
      }
    }
    return seen;
  };
  for (const start of starts) {
    const r0 = region(start.x, start.y, boulder.x, boulder.y);
    const key = (bx, by, r) => `${bx},${by}:${Math.min(...r)}`;
    const q = [{ bx: boulder.x, by: boulder.y, r: r0, path: [] }];
    const seen = new Set([key(boulder.x, boulder.y, r0)]);
    while (q.length) {
      const s = q.shift();
      if (isTarget(s.bx, s.by)) return group(s.path);
      for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
        const sx = s.bx - dx;
        const sy = s.by - dy;
        if (!s.r.has(sy * W + sx)) continue;
        const nx = s.bx + dx;
        const ny = s.by + dy;
        if (!boulderCan(nx, ny)) continue;
        const r = region(s.bx, s.by, nx, ny);
        const k = key(nx, ny, r);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push({ bx: nx, by: ny, r, path: [...s.path, { stand: { x: sx, y: sy }, from: { x: s.bx, y: s.by }, dir }] });
      }
    }
  }
  return null;
}

/** Empurrões seguidos na mesma direção, sem o jogador dar a volta, viram um grupo. */
function group(pushes) {
  const out = [];
  for (const p of pushes) {
    const last = out[out.length - 1];
    if (last && last.dir === p.dir && last.stand.x + (last.times - 1) * DIRS[p.dir][0] + DIRS[p.dir][0] === p.stand.x && last.stand.y + (last.times - 1) * DIRS[p.dir][1] + DIRS[p.dir][1] === p.stand.y) last.times++;
    else out.push({ stand: p.stand, from: p.from, dir: p.dir, times: 1 });
  }
  return out;
}

/**
 * Várias pedras no andar: leva a pedra `goal` a um buraco, podendo empurrar as outras para abrir caminho
 * (no Seafoam B3F uma pedra está encostada na outra). As outras não podem cair em buracos.
 * Retorna empurrões agrupados ({stand, from, dir, times}) ou null.
 */
export function solveBoulders(map, boulders, goal, holesList, starts, maxStates = 400000) {
  const { width: W, height: H } = map;
  const holes = new Set(holesList.map((h) => h.y * W + h.x));
  const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : map.tiles[y * W + x]);
  const elev = (x, y) => parseInt(map.elev[y * W + x] ?? '0', 16);
  const isBoulder = (o) => boulders.some((b) => b.x === o.x && b.y === o.y);
  const fixed = new Set(map.objects.filter((o) => o.kind !== 'boulder' || !isBoulder(o)).filter((o) => o.kind !== 'boulder').map((o) => o.y * W + o.x));
  const ground = (x, y) => {
    const c = tile(x, y);
    return c !== '#' && !LEDGE.has(c) && !WATER.has(c) && !fixed.has(y * W + x);
  };
  const region = (px, py, occ) => {
    const seen = new Set();
    const q = [[px, py, elev(px, py)]];
    while (q.length) {
      const [x, y, pe] = q.pop();
      const k = y * W + x;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const [dx, dy] of Object.values(DIRS)) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = ny * W + nx;
        if (occ.has(nk) || holes.has(nk) || !ground(nx, ny) || seen.has(nk)) continue;
        const te = elev(nx, ny);
        if (pe !== 0 && te !== 0 && te !== 15 && te !== pe) continue;
        q.push([nx, ny, te === 15 ? pe : te]);
      }
    }
    return seen;
  };
  const gIdx = boulders.findIndex((b) => b.x === goal.x && b.y === goal.y);
  for (const start of starts) {
    if (!ground(start.x, start.y) || boulders.some((b) => b.x === start.x && b.y === start.y)) continue;
    const init = boulders.map((b) => b.y * W + b.x);
    const r0 = region(start.x, start.y, new Set(init));
    const key = (pos, r) => `${pos.join(',')}:${Math.min(...r)}`;
    const q = [{ pos: init, r: r0, path: [] }];
    const seen = new Set([key(init, r0)]);
    for (let head = 0; head < q.length && seen.size < maxStates; head++) {
      const s = q[head];
      const occ = new Set(s.pos);
      for (let i = 0; i < s.pos.length; i++) {
        const bx = s.pos[i] % W;
        const by = Math.floor(s.pos[i] / W);
        for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
          if (!s.r.has((by - dy) * W + (bx - dx))) continue;
          const nx = bx + dx;
          const ny = by + dy;
          const nk = ny * W + nx;
          if (occ.has(nk)) continue;
          const intoHole = holes.has(nk);
          if (intoHole && i !== gIdx) continue;
          if (!intoHole) {
            if (!ground(nx, ny)) continue;
            const e = elev(nx, ny);
            const be = elev(bx, by);
            if (e !== 0 && e !== 15 && be !== 0 && be !== 15 && e !== be) continue;
          }
          const step = { stand: { x: bx - dx, y: by - dy }, from: { x: bx, y: by }, dir };
          if (intoHole) return group([...s.path, step]);
          const pos = [...s.pos];
          pos[i] = nk;
          const r = region(bx, by, new Set(pos));
          const k = key(pos, r);
          if (seen.has(k)) continue;
          seen.add(k);
          q.push({ pos, r, path: [...s.path, step] });
        }
      }
    }
  }
  return null;
}
