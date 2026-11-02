// Extração do mundo de Kanto para a navegação: um registro por mapa com a grade de tiles
// (colisão + comportamento), a elevação, warps com o jeito de disparar, conexões entre mapas,
// objetos, itens escondidos e gatilhos de script. Tudo vem do decomp; nada é editorial.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Seções do mapa regional de Kanto (o resto é Sevii ou área especial). */
export const KANTO_MAPSECS = new Set([
  'PALLET_TOWN', 'VIRIDIAN_CITY', 'PEWTER_CITY', 'CERULEAN_CITY', 'LAVENDER_TOWN', 'VERMILION_CITY', 'CELADON_CITY',
  'FUCHSIA_CITY', 'CINNABAR_ISLAND', 'INDIGO_PLATEAU', 'SAFFRON_CITY', 'VIRIDIAN_FOREST', 'MT_MOON', 'S_S_ANNE',
  'UNDERGROUND_PATH', 'UNDERGROUND_PATH_2', 'DIGLETTS_CAVE', 'KANTO_VICTORY_ROAD', 'ROCKET_HIDEOUT', 'SILPH_CO',
  'POKEMON_MANSION', 'KANTO_SAFARI_ZONE', 'POKEMON_LEAGUE', 'ROCK_TUNNEL', 'SEAFOAM_ISLANDS', 'POKEMON_TOWER',
  'CERULEAN_CAVE', 'POWER_PLANT', ...Array.from({ length: 25 }, (_, i) => `ROUTE_${i + 1}`),
]);

/**
 * Um caractere por tile. Ordem de decisão igual à do jogo: ledge primeiro (pula mesmo com colisão),
 * depois colisão, depois o comportamento do tile livre.
 */
export const TILE = {
  wall: '#',
  floor: '.',
  water: '~',
  fastWater: 'F',
  waterfall: 'W',
  ledge: { MB_JUMP_SOUTH: 'v', MB_JUMP_NORTH: '^', MB_JUMP_WEST: '{', MB_JUMP_EAST: '}' },
  /** Bordas bloqueadas: a letra diz quais lados do tile não deixam passar. */
  edge: {
    MB_IMPASSABLE_NORTH: 'n', MB_IMPASSABLE_EAST: 'e', MB_IMPASSABLE_SOUTH: 's', MB_IMPASSABLE_WEST: 'w',
    MB_IMPASSABLE_NORTHEAST: 'N', MB_IMPASSABLE_NORTHWEST: 'M', MB_IMPASSABLE_SOUTHEAST: 'S', MB_IMPASSABLE_SOUTHWEST: 'Z',
  },
  current: { MB_NORTHWARD_CURRENT: '8', MB_SOUTHWARD_CURRENT: '2', MB_WESTWARD_CURRENT: '4', MB_EASTWARD_CURRENT: '6' },
  spin: { MB_SPIN_UP: 'U', MB_SPIN_DOWN: 'D', MB_SPIN_LEFT: 'L', MB_SPIN_RIGHT: 'R' },
  stopSpin: 'X',
  ice: 'I',
  strengthButton: 'B',
  cyclingPull: 'P',
};

const TERRAIN_WATER = 2;
// MB_REGULAR_WARP = teletransportador (metatile_behavior.c: MetatileBehavior_IsWarpPad).
const STEP_WARP = new Set(['MB_REGULAR_WARP', 'MB_LADDER', 'MB_UP_ESCALATOR', 'MB_DOWN_ESCALATOR', 'MB_CAVE_DOOR', 'MB_FALL_WARP']);
const WARP_KIND = {
  MB_WARP_DOOR: 'door', MB_LADDER: 'ladder', MB_UP_ESCALATOR: 'escalator', MB_DOWN_ESCALATOR: 'escalator',
  MB_CAVE_DOOR: 'cave', MB_REGULAR_WARP: 'pad', MB_FALL_WARP: 'fall',
};
const ARROW = { MB_SOUTH_ARROW_WARP: 'down', MB_NORTH_ARROW_WARP: 'up', MB_WEST_ARROW_WARP: 'left', MB_EAST_ARROW_WARP: 'right' };
const STAIR = { MB_UP_RIGHT_STAIR_WARP: 'right', MB_DOWN_RIGHT_STAIR_WARP: 'right', MB_UP_LEFT_STAIR_WARP: 'left', MB_DOWN_LEFT_STAIR_WARP: 'left' };
const FACING = { MOVEMENT_TYPE_FACE_LEFT: ['left'], MOVEMENT_TYPE_FACE_RIGHT: ['right'], MOVEMENT_TYPE_FACE_UP: ['up'], MOVEMENT_TYPE_FACE_DOWN: ['down'] };

export function buildWorld(ctx) {
  const { DECOMP, read, fail, flagConsts, varConsts, trainerConsts, itemKeys, trainerKeys, scriptTrainers, itemKey, mapsIndex, sharedScripts } = ctx;
  const buf = (p) => readFileSync(join(DECOMP, p));
  const behaviorNames = new Map([...read('include/constants/metatile_behaviors.h').matchAll(/#define (MB_\w+) (0x[0-9A-Fa-f]+)/g)].map((m) => [Number(m[2]), m[1]]));
  const NUM_PRIMARY = Number(read('include/fieldmap.h').match(/#define NUM_METATILES_IN_PRIMARY (\d+)/)?.[1] ?? fail('NUM_METATILES_IN_PRIMARY'));
  const layouts = new Map(JSON.parse(read('data/layouts/layouts.json')).layouts.filter((l) => l.id).map((l) => [l.id, l]));
  // Tileset → arquivo de atributos, pela tabela do próprio jogo (headers.h + metatiles.h).
  const attrPath = new Map([...read('src/data/tilesets/metatiles.h').matchAll(/gMetatileAttributes_(\w+)\[\] = INCBIN_U32\("([^"]+)"\)/g)].map((m) => [m[1], m[2]]));
  const headerAttr = new Map([...read('src/data/tilesets/headers.h').matchAll(/const struct Tileset (gTileset_\w+) =\s*\{[\s\S]*?\.metatileAttributes = gMetatileAttributes_(\w+)/g)].map((m) => [m[1], m[2]]));
  const attrCache = new Map();
  const tilesetAttrs = (name) => {
    if (attrCache.has(name)) return attrCache.get(name);
    const path = attrPath.get(headerAttr.get(name) ?? '') ?? fail(`mundo: atributos do tileset ${name}`);
    const b = buf(path);
    const attrs = Array.from({ length: b.length / 4 }, (_, i) => b.readUInt32LE(i * 4));
    attrCache.set(name, attrs);
    return attrs;
  };
  const itemBallScripts = read('data/scripts/item_ball_scripts.inc');
  const parseLabels = (src) => {
    const out = new Map();
    let cur = null;
    for (const line of src.split('\n')) {
      const l = line.match(/^(\w+)::/);
      if (l) {
        cur = l[1];
        out.set(cur, []);
      } else if (cur) out.get(cur).push(line.trim());
    }
    return out;
  };
  // Rótulos de scripts compartilhados que os mapas chamam ao carregar (interruptor da mansão, portas da Silph Co.).
  const sharedLabels = new Map(sharedScripts.flatMap((p) => [...parseLabels(read(p)).entries()]));
  const metatileIds = new Map([...read('include/constants/metatile_labels.h').matchAll(/#define (METATILE_\w+)\s+(0x[0-9A-Fa-f]+|\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const sharedTrainerScripts = scriptTrainers(read('data/scripts/trainers.inc'));

  const mapJson = new Map();
  for (const m of mapsIndex) {
    try {
      mapJson.set(m.key, JSON.parse(read(`data/maps/${m.key}/map.json`)));
    } catch {}
  }
  const keyByConst = new Map([...mapJson.entries()].map(([k, j]) => [j.id, k]));
  const kanto = mapsIndex.filter((m) => KANTO_MAPSECS.has(mapJson.get(m.key)?.region_map_section?.replace('MAPSEC_', '')));

  const world = kanto.map((m) => {
    const j = mapJson.get(m.key);
    const layout = layouts.get(j.layout) ?? fail(`mundo: layout ${j.layout}`);
    const { width, height } = layout;
    const blocks = (() => {
      const b = buf(layout.blockdata_filepath);
      return Array.from({ length: b.length / 2 }, (_, i) => b.readUInt16LE(i * 2));
    })();
    if (blocks.length !== width * height) fail(`mundo/${m.key}: layout com tamanho inesperado`);
    const prim = tilesetAttrs(layout.primary_tileset);
    const sec = tilesetAttrs(layout.secondary_tileset);
    const attrOf = (block) => {
      const mt = block & 0x3ff;
      return mt < NUM_PRIMARY ? (prim[mt] ?? 0) : (sec[mt - NUM_PRIMARY] ?? 0);
    };
    const behaviorAt = (x, y) => behaviorNames.get(attrOf(blocks[y * width + x]) & 0x1ff) ?? 'MB_NORMAL';
    /** Caractere do tile para um bloco (metatile + colisão), com os tilesets de `lay`. */
    const charOf = (b, lay = layout) => {
      const p = tilesetAttrs(lay.primary_tileset);
      const q = tilesetAttrs(lay.secondary_tileset);
      const mt = b & 0x3ff;
      const attr = mt < NUM_PRIMARY ? (p[mt] ?? 0) : (q[mt - NUM_PRIMARY] ?? 0);
      const beh = behaviorNames.get(attr & 0x1ff) ?? 'MB_NORMAL';
      const terrain = (attr >> 9) & 0x1f;
      if (TILE.ledge[beh]) return TILE.ledge[beh];
      if ((b >> 10) & 3) return TILE.wall;
      if (TILE.edge[beh]) return TILE.edge[beh];
      if (TILE.current[beh]) return TILE.current[beh];
      if (TILE.spin[beh]) return TILE.spin[beh];
      if (beh === 'MB_STOP_SPINNING') return TILE.stopSpin;
      if (beh === 'MB_ICE') return TILE.ice;
      if (beh === 'MB_WATERFALL') return TILE.waterfall;
      if (beh === 'MB_FAST_WATER') return TILE.fastWater;
      if (beh === 'MB_STRENGTH_BUTTON') return TILE.strengthButton;
      if (beh === 'MB_CYCLING_ROAD_PULL_DOWN' || beh === 'MB_CYCLING_ROAD_PULL_DOWN_GRASS') return TILE.cyclingPull;
      if (terrain === TERRAIN_WATER) return TILE.water;
      return TILE.floor;
    };
    const tiles = blocks.map((b) => charOf(b)).join('');
    const elev = blocks.map((b) => (b >> 12).toString(16)).join('');

    // Warps: o comportamento do tile diz como disparam; tile comum = só ponto de chegada.
    const warps = (j.warp_events ?? []).map((w, i) => {
      const beh = behaviorAt(w.x, w.y);
      // Porta: o tile tem colisão; o warp dispara com o jogador logo abaixo, andando para cima (TryDoorWarp).
      const trigger = beh === 'MB_WARP_DOOR' ? 'door' : STEP_WARP.has(beh) ? 'step' : ARROW[beh] ? `press-${ARROW[beh]}` : STAIR[beh] ? `press-${STAIR[beh]}` : 'none';
      const kind = WARP_KIND[beh] ?? (ARROW[beh] ? 'exit-mat' : STAIR[beh] ? 'stairs' : 'arrival');
      let to = null;
      if (w.dest_map !== 'MAP_DYNAMIC') {
        const destKey = keyByConst.get(w.dest_map) ?? fail(`mundo/${m.key}: destino ${w.dest_map}`);
        const dw = mapJson.get(destKey).warp_events?.[Number(w.dest_warp_id)] ?? fail(`mundo/${m.key}: warp ${w.dest_warp_id} de ${destKey}`);
        to = { map: destKey, x: dw.x, y: dw.y };
      }
      const vertical = STAIR[beh] ? (beh.includes('_UP_') ? 'up' : 'down') : beh === 'MB_UP_ESCALATOR' ? 'up' : beh === 'MB_DOWN_ESCALATOR' ? 'down' : null;
      return { x: w.x, y: w.y, trigger, kind, ...(vertical ? { vertical } : {}), to, source: `data/maps/${m.key}/map.json#warp_events[${i}]` };
    });

    const connections = (j.connections ?? [])
      .filter((c) => ['up', 'down', 'left', 'right'].includes(c.direction))
      .map((c) => ({ dir: c.direction, offset: c.offset, map: keyByConst.get(c.map) ?? fail(`mundo/${m.key}: conexão ${c.map}`) }));

    const scripts = (() => {
      try {
        return read(`data/maps/${m.key}/scripts.inc`);
      } catch {
        return '';
      }
    })();
    const localTrainers = scriptTrainers(scripts);
    // Pessoas reposicionadas ao entrar no mapa (setobjectxyperm no OnTransition, sob condição).
    const labels = new Map();
    {
      let cur = null;
      for (const line of scripts.split('\n')) {
        const l = line.match(/^(\w+)::/);
        if (l) {
          cur = l[1];
          labels.set(cur, []);
        } else if (cur) labels.get(cur).push(line.trim());
      }
    }
    const moves = new Map();
    const onTransition = scripts.match(/map_script MAP_SCRIPT_ON_TRANSITION, (\w+)/)?.[1];
    const CMP = { eq: 'eq', ne: 'ne', lt: 'lt', ge: 'ge', le: 'le', gt: 'gt' };
    const collectMoves = (label, when) => {
      for (const line of labels.get(label) ?? []) {
        const mv = line.match(/^setobjectxyperm (\w+), (\d+), (\d+)/);
        if (mv) {
          if (!moves.has(mv[1])) moves.set(mv[1], []);
          moves.get(mv[1]).push({ ...when, x: Number(mv[2]), y: Number(mv[3]) });
        }
        if (/^(return|end)$/.test(line)) break;
      }
    };
    for (const line of (onTransition ? labels.get(onTransition) : null) ?? []) {
      let mm;
      if ((mm = line.match(/^call_if_(eq|ne|lt|ge|le|gt) (VAR_\w+), (\w+), (\w+)/))) {
        const value = Number(mm[3]);
        if (!Number.isFinite(value)) continue;
        collectMoves(mm[4], { var: varConsts.get(mm[2]) ?? fail(`mundo/${m.key}: var ${mm[2]}`), cmp: CMP[mm[1]], value });
      } else if ((mm = line.match(/^call_if_(set|unset) (FLAG_\w+), (\w+)/))) {
        collectMoves(mm[3], { flag: flagConsts.get(mm[2]) ?? fail(`mundo/${m.key}: flag ${mm[2]}`), set: mm[1] === 'set' });
      } else if ((mm = line.match(/^call (\w+)$/))) {
        collectMoves(mm[1], { always: true });
      } else if (/^(end|return)$/.test(line)) break;
    }
    const objects = (j.object_events ?? []).flatMap((o, i) => {
      if (o.type && o.type !== 'object') return [];
      const source = `data/maps/${m.key}/map.json#object_events[${i}]`;
      const flagId = o.flag && o.flag !== '0' ? (flagConsts.get(o.flag) ?? fail(`mundo/${m.key}: flag ${o.flag}`)) : null;
      // Flags temporárias (0x00–0x1F) são zeradas ao entrar no mapa: o objeto volta a cada visita.
      const temp = flagId !== null && flagId < 0x20;
      const alt = o.local_id ? moves.get(o.local_id) : undefined;
      const base = { x: o.x, y: o.y, hideFlag: temp ? null : flagId, ...(temp ? { tempFlag: true } : {}), ...(alt ? { moves: alt } : {}), source };
      const item = o.script?.match(/_EventScript_Item\w+$/) ? itemBallScripts.match(new RegExp(`^${o.script}::\\s+finditem\\s+(ITEM_\\w+)`, 'm'))?.[1] : null;
      if (item) {
        const key = itemKey(item);
        if (!itemKeys.has(key)) fail(`mundo/${m.key}: item ${key}`);
        return [{ ...base, kind: 'item', item: key }];
      }
      if (o.graphics_id === 'OBJ_EVENT_GFX_CUT_TREE') return [{ ...base, kind: 'cut-tree' }];
      if (o.graphics_id === 'OBJ_EVENT_GFX_ROCK_SMASH_ROCK') return [{ ...base, kind: 'smash-rock' }];
      if (o.graphics_id === 'OBJ_EVENT_GFX_PUSHABLE_BOULDER') {
        // A pedra guarda no trainer_type a flag que revela a pedra do andar de baixo quando ela cai
        // (event_object_movement.c: GetBoulderRevealFlagByLocalIdAndMap).
        const reveal = o.trainer_type?.startsWith('FLAG_') ? (flagConsts.get(o.trainer_type) ?? fail(`mundo/${m.key}: ${o.trainer_type}`)) : null;
        return [{ ...base, kind: 'boulder', ...(reveal !== null ? { revealFlag: reveal } : {}) }];
      }
      const ts = [...(localTrainers.get(o.script) ?? sharedTrainerScripts.get(o.script) ?? [])];
      if ((o.trainer_type === 'TRAINER_TYPE_NORMAL' || o.trainer_type === 'TRAINER_TYPE_BURIED') && ts.length >= 1) {
        const key = ts[0].replace('TRAINER_', '').toLowerCase();
        if (!trainerKeys.has(key)) fail(`mundo/${m.key}: treinador ${key}`);
        return [{ ...base, kind: 'trainer', trainer: key, sight: Number(o.trainer_sight_or_berry_tree_id) || 0, facing: FACING[o.movement_type] ?? ['up', 'down', 'left', 'right'] }];
      }
      return [{ ...base, kind: 'npc', gfx: o.graphics_id.replace('OBJ_EVENT_GFX_', ''), range: [o.movement_range_x ?? 0, o.movement_range_y ?? 0] }];
    });
    const hidden = (j.bg_events ?? [])
      .filter((b) => b.type === 'hidden_item')
      .map((b) => {
        const flag = flagConsts.get(b.flag) ?? fail(`mundo/${m.key}: flag ${b.flag}`);
        // Game Corner: ITEM_NONE com quantidade = fichas escondidas.
        if (b.item === 'ITEM_NONE') return { x: b.x, y: b.y, item: 'coins', quantity: b.quantity, flag, underfoot: !!b.underfoot };
        const key = itemKey(b.item);
        if (!itemKeys.has(key)) fail(`mundo/${m.key}: item escondido ${key}`);
        return { x: b.x, y: b.y, item: key, quantity: b.quantity ?? 1, flag, underfoot: !!b.underfoot };
      });
    const triggers = (j.coord_events ?? [])
      .filter((c) => c.type === 'trigger')
      .map((c) => ({ x: c.x, y: c.y, var: c.var, value: Number(c.var_value), script: c.script }));

    // Sobreposições: o que o script de carga do mapa troca (setmetatile, setmaplayoutindex) sob uma condição.
    const overlays = [];
    const onLoad = scripts.match(/map_script MAP_SCRIPT_ON_LOAD, (\w+)/)?.[1];
    const labelBody = (l) => labels.get(l) ?? sharedLabels.get(l) ?? [];
    const triggerOf = (b, lay) => {
      const q = tilesetAttrs(lay.primary_tileset);
      const r = tilesetAttrs(lay.secondary_tileset);
      const mt = b & 0x3ff;
      const beh = behaviorNames.get((mt < NUM_PRIMARY ? (q[mt] ?? 0) : (r[mt - NUM_PRIMARY] ?? 0)) & 0x1ff) ?? 'MB_NORMAL';
      return beh === 'MB_WARP_DOOR' ? 'door' : STEP_WARP.has(beh) ? 'step' : ARROW[beh] ? `press-${ARROW[beh]}` : STAIR[beh] ? `press-${STAIR[beh]}` : 'none';
    };
    const overlayFrom = (label, when) => {
      const changed = new Map();
      const altBlock = new Map();
      for (const line of labelBody(label)) {
        let mm;
        if ((mm = line.match(/^setmetatile\s+(\d+),\s*(\d+),\s*(METATILE_\w+),\s*(\d)/))) {
          const x = Number(mm[1]);
          const y = Number(mm[2]);
          const metatile = metatileIds.get(mm[3]) ?? fail(`mundo/${m.key}: ${mm[3]}`);
          if (x >= width || y >= height) continue;
          const b = (blocks[y * width + x] & 0xf000) | metatile | (mm[4] === '1' ? 0x400 : 0);
          changed.set(y * width + x, charOf(b));
          altBlock.set(y * width + x, { b, lay: layout });
        } else if ((mm = line.match(/^setmaplayoutindex (LAYOUT_\w+)/))) {
          const alt = layouts.get(mm[1]) ?? fail(`mundo/${m.key}: ${mm[1]}`);
          if (alt.width !== width || alt.height !== height) fail(`mundo/${m.key}: layout alternativo com outro tamanho`);
          const ab = buf(alt.blockdata_filepath);
          for (let i = 0; i < blocks.length; i++) {
            changed.set(i, charOf(ab.readUInt16LE(i * 2), alt));
            altBlock.set(i, { b: ab.readUInt16LE(i * 2), lay: alt });
          }
        } else if (/^(return|end)$/.test(line)) break;
      }
      // Em tile de warp, a troca também muda se o warp dispara (a escada escondida do Game Corner não leva a lugar nenhum).
      const warpAt = new Map(warps.map((w) => [w.y * width + w.x, w]));
      const list = [...changed.entries()]
        .map(([i, c]) => {
          const w = warpAt.get(i);
          const t = w ? triggerOf(altBlock.get(i).b, altBlock.get(i).lay) : null;
          return { x: i % width, y: Math.floor(i / width), c, ...(w && t !== w.trigger ? { trigger: t } : {}) };
        })
        .filter((t) => t.c !== tiles[t.y * width + t.x] || 'trigger' in t);
      if (list.length) overlays.push({ when, tiles: list, label });
    };
    for (const entry of [onLoad, onTransition]) {
      for (const line of (entry ? labels.get(entry) : null) ?? []) {
        let mm;
        if ((mm = line.match(/^call_if_(set|unset) (FLAG_\w+), (\w+)/))) {
          overlayFrom(mm[3], { flag: flagConsts.get(mm[2]) ?? fail(`mundo/${m.key}: flag ${mm[2]}`), set: mm[1] === 'set' });
        } else if ((mm = line.match(/^call_if_(eq|ne|lt|ge|le|gt) (VAR_\w+), (\d+), (\w+)/))) {
          overlayFrom(mm[4], { var: varConsts.get(mm[2]) ?? fail(`mundo/${m.key}: var ${mm[2]}`), cmp: mm[1], value: Number(mm[3]) });
        } else if ((mm = line.match(/^call_if_(not_defeated|defeated) (TRAINER_\w+),? (\w+)/))) {
          // Treinador vencido = flag 0x500 + id (TRAINER_FLAGS_START).
          const id = trainerConsts.get(mm[2]) ?? fail(`mundo/${m.key}: ${mm[2]}`);
          overlayFrom(mm[3], { flag: 0x500 + id, set: mm[1] === 'defeated', trainer: mm[2].replace('TRAINER_', '').toLowerCase() });
        } else if (/^(end|return)$/.test(line)) break;
      }
    }
    // Elevador: o painel escolhe o andar (setdynamicwarp MAP_X, 255, x, y); alguns exigem uma flag (Lift Key).
    const elevatorFloors = [...scripts.matchAll(/setdynamicwarp (MAP_\w+), 255, (\d+), (\d+)/g)].map((e) => ({
      map: keyByConst.get(e[1]) ?? fail(`mundo/${m.key}: elevador para ${e[1]}`),
      x: Number(e[2]),
      y: Number(e[3]),
    }));
    const needKey = scripts.match(/_EventScript_FloorSelect::[^:]*?goto_if_unset (FLAG_\w+), \w+NeedKey/)?.[1];
    const elevator = elevatorFloors.length
      ? { floors: elevatorFloors, ...(needKey ? { needsFlag: flagConsts.get(needKey) ?? fail(`mundo/${m.key}: ${needKey}`) } : {}) }
      : null;
    return {
      ...(elevator ? { elevator } : {}),
      key: m.key,
      group: m.group,
      num: m.num,
      mapsec: j.region_map_section.replace('MAPSEC_', ''),
      name: j.name,
      type: j.map_type.replace('MAP_TYPE_', '').toLowerCase(),
      allowEscaping: j.allow_escaping === true,
      allowCycling: j.allow_cycling === true,
      width,
      height,
      tiles,
      elev,
      connections,
      warps,
      objects,
      hidden,
      triggers,
      overlays,
      source: `${layout.blockdata_filepath} data/maps/${m.key}/map.json`,
    };
  });

  // Coerência: todo warp e conexão aponta para um mapa conhecido (dentro ou fora de Kanto).
  const inWorld = new Set(world.map((w) => w.key));
  for (const w of world) {
    for (const wp of w.warps) if (wp.to && !mapJson.has(wp.to.map)) fail(`mundo/${w.key}: warp para mapa inexistente ${wp.to.map}`);
    for (const c of w.connections) if (!inWorld.has(c.map)) fail(`mundo/${w.key}: conexão para fora de Kanto ${c.map}`);
  }
  return world;
}
