// Gera o dataset firered-gen3 a partir do decomp pret/pokefirered.
// Uso: node tools/data-pipeline/build.mjs [dir-decomp]   (padrão: .decomp)
// Saída: packages/data-firered/data/*.json + manifest.json (com SHA-256 por arquivo).
// Determinístico: mesma entrada gera os mesmos bytes (sem timestamps).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATASET_VERSION = '0.3.0';
const ROOT = resolve(import.meta.dirname, '../..');
const DECOMP = resolve(process.argv[2] ?? join(ROOT, '.decomp'));
const OUT = join(ROOT, 'packages/data-firered/data');

const read = (p) => readFileSync(join(DECOMP, p), 'utf8');
const fail = (msg) => {
  throw new Error(`[data-pipeline] ${msg}`);
};

/** Avalia expressões aritméticas simples de #define (números, nomes conhecidos, + - * / e parênteses). */
function evalExpr(expr, known) {
  const replaced = expr.replace(/\b[A-Za-z_]\w*\b/g, (id) => (known.has(id) ? String(known.get(id)) : `#${id}`));
  if (replaced.includes('#') || !/^[\s\d+\-*/()xa-fA-F]+$/.test(replaced)) return NaN;
  // Só números e operadores chegam aqui.
  return Number(Function(`"use strict"; return (${replaced});`)());
}

/** Lê #defines numéricos, resolvendo expressões com nomes já conhecidos (inclusive de `seed`). */
function constants(file, prefix, seed = new Map()) {
  const byName = new Map();
  const known = new Map(seed);
  for (const line of read(file).split('\n')) {
    const m = line.match(new RegExp(`^#define\\s+(${prefix}\\w*)\\s+(.+?)\\s*(//.*)?$`));
    if (!m) continue;
    const [, name, raw] = m;
    const value = evalExpr(raw.trim(), known);
    if (Number.isNaN(value)) continue;
    byName.set(name, value);
    known.set(name, value);
  }
  return byName;
}

function names(file) {
  const out = new Map();
  for (const m of read(file).matchAll(/\[(\w+)\]\s*=\s*_\("([^"]*)"\)/g)) out.set(m[1], m[2]);
  return out;
}

/** Blocos `[KEY] = { ... },` de um inicializador C de array de structs. */
function blocks(src, keyPrefix) {
  const out = [];
  const re = new RegExp(`\\[(${keyPrefix}\\w+)\\]\\s*=\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ key: m[1], body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const field = (body, name) => body.match(new RegExp(`\\.${name}\\s*=\\s*([^,\\n]+)`))?.[1].trim();
const pair = (body, name) =>
  body.match(new RegExp(`\\.${name}\\s*=\\s*\\{\\s*(\\w+)\\s*,\\s*(\\w+)\\s*\\}`))?.slice(1, 3);

// ---------- tipos ----------
const typeConsts = constants('include/constants/pokemon.h', 'TYPE_');
const TYPE_IDS = [...typeConsts].filter(([n, v]) => v < 18 && !n.startsWith('TYPE_MUL'));
const typeName = (c) => {
  if (c === 'TYPE_MYSTERY') return '???';
  if (!typeConsts.has(c)) fail(`tipo desconhecido ${c}`);
  return c.replace('TYPE_', '').toLowerCase();
};
const types = TYPE_IDS.sort((a, b) => a[1] - b[1]).map(([c, id]) => ({ id, name: typeName(c) }));
// Gen III: categoria física/especial é função do tipo (tipos < TYPE_MYSTERY são físicos).
const MYSTERY = typeConsts.get('TYPE_MYSTERY');
const categoryOf = (typeConst, power) =>
  power === 0 ? 'status' : typeConsts.get(typeConst) < MYSTERY ? 'physical' : 'special';

// ---------- tabela de tipos ----------
const tableSrc = read('src/battle_main.c').match(/gTypeEffectiveness\[\d+\]\s*=\s*\{([\s\S]*?)\};/)?.[1];
if (!tableSrc) fail('gTypeEffectiveness não encontrada');
const MUL = { TYPE_MUL_NO_EFFECT: 0, TYPE_MUL_NOT_EFFECTIVE: 0.5, TYPE_MUL_SUPER_EFFECTIVE: 2 };
const typeChart = [];
let afterForesight = false;
for (const m of tableSrc.matchAll(/(\w+)\s*,\s*(\w+)\s*,\s*(\w+)/g)) {
  const [, atk, def, mul] = m;
  if (atk === 'TYPE_FORESIGHT') {
    afterForesight = true;
    continue;
  }
  if (atk === 'TYPE_ENDTABLE') break;
  if (!(mul in MUL)) fail(`multiplicador desconhecido ${mul}`);
  typeChart.push({
    attack: typeName(atk),
    defend: typeName(def),
    multiplier: MUL[mul],
    ...(afterForesight ? { removedByForesight: true } : {}),
  });
}

// ---------- habilidades ----------
const abilityConsts = constants('include/constants/abilities.h', 'ABILITY_');
const abilityNames = names('src/data/text/abilities.h');
const abilities = [...abilityConsts]
  .filter(([c]) => c !== 'ABILITY_NONE' && abilityNames.has(c))
  .map(([c, id]) => ({ id, key: c.replace('ABILITY_', '').toLowerCase(), name: abilityNames.get(c) }))
  .sort((a, b) => a.id - b.id);
const abilityKey = (c) => (c === 'ABILITY_NONE' ? null : c.replace('ABILITY_', '').toLowerCase());

// ---------- golpes ----------
const moveConsts = constants('include/constants/moves.h', 'MOVE_');
const moveNames = names('src/data/text/move_names.h');
const moves = blocks(read('src/data/battle_moves.h'), 'MOVE_')
  .filter((b) => b.key !== 'MOVE_NONE')
  .map(({ key, body }) => {
    const id = moveConsts.get(key) ?? fail(`id de golpe desconhecido ${key}`);
    const type = field(body, 'type');
    const power = Number(field(body, 'power') ?? 0);
    const flags = (field(body, 'flags') ?? '0').split('|').map((f) => f.trim()).filter((f) => f !== '0');
    return {
      id,
      key: key.replace('MOVE_', '').toLowerCase(),
      name: moveNames.get(key) ?? fail(`nome ausente ${key}`),
      type: typeName(type),
      power: power || null,
      accuracy: Number(field(body, 'accuracy') ?? 0) || null,
      pp: Number(field(body, 'pp')),
      priority: Number(field(body, 'priority') ?? 0),
      category: categoryOf(type, power),
      effect: field(body, 'effect')?.replace('EFFECT_', '').toLowerCase() ?? 'hit',
      secondaryEffectChance: Number(field(body, 'secondaryEffectChance') ?? 0),
      target: field(body, 'target')?.replace('MOVE_TARGET_', '').toLowerCase(),
      contact: flags.includes('FLAG_MAKES_CONTACT'),
    };
  })
  .sort((a, b) => a.id - b.id);
const moveKey = (c) => c.replace('MOVE_', '').toLowerCase();

// ---------- learnsets de level-up ----------
const learnsetSrc = read('src/data/pokemon/level_up_learnsets.h');
const learnsetArrays = new Map();
for (const m of learnsetSrc.matchAll(/(s\w+LevelUpLearnset)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
  learnsetArrays.set(
    m[1],
    [...m[2].matchAll(/LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_\w+)\s*\)/g)].map((x) => ({
      level: Number(x[1]),
      move: moveKey(x[2]),
    })),
  );
}
const learnsetBySpecies = new Map();
for (const m of read('src/data/pokemon/level_up_learnset_pointers.h').matchAll(/\[(SPECIES_\w+)\]\s*=\s*(s\w+)/g)) {
  learnsetBySpecies.set(m[1], learnsetArrays.get(m[2]) ?? fail(`learnset ${m[2]} ausente`));
}

// ---------- espécies ----------
const speciesConsts = constants('include/constants/species.h', 'SPECIES_');
const speciesNames = names('src/data/text/species_names.h');
const species = blocks(read('src/data/pokemon/species_info.h'), 'SPECIES_')
  .filter((b) => b.key !== 'SPECIES_NONE' && b.body.includes('.baseHP'))
  .map(({ key, body }) => {
    const [t1, t2] = pair(body, 'types') ?? fail(`tipos ausentes ${key}`);
    const [a1, a2] = pair(body, 'abilities') ?? fail(`habilidades ausentes ${key}`);
    const typesOf = [...new Set([typeName(t1), typeName(t2)])];
    return {
      id: speciesConsts.get(key) ?? fail(`id de espécie desconhecido ${key}`),
      key: key.replace('SPECIES_', '').toLowerCase(),
      name: speciesNames.get(key) ?? fail(`nome ausente ${key}`),
      types: typesOf,
      abilities: [abilityKey(a1), abilityKey(a2)].filter((a, i, arr) => a && arr.indexOf(a) === i),
      baseStats: {
        hp: Number(field(body, 'baseHP')),
        atk: Number(field(body, 'baseAttack')),
        def: Number(field(body, 'baseDefense')),
        spa: Number(field(body, 'baseSpAttack')),
        spd: Number(field(body, 'baseSpDefense')),
        spe: Number(field(body, 'baseSpeed')),
      },
      catchRate: Number(field(body, 'catchRate')),
      growthRate: field(body, 'growthRate')?.replace('GROWTH_', '').toLowerCase(),
      levelUpMoves: learnsetBySpecies.get(key) ?? [],
    };
  })
  .sort((a, b) => a.id - b.id);

// ---------- regras específicas do FireRed (src/pokemon.c) ----------
const pokemonC = read('src/pokemon.c');
// Golpes de HM: não podem ser esquecidos pelo menu comum (exige Move Deleter).
const hmBlock = pokemonC.match(/sHMMoves\[\]\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? fail('sHMMoves ausente');
const hmMoves = [...hmBlock.matchAll(/MOVE_\w+/g)].map((m) => moveKey(m[0]));
// Deoxys: o FireRed substitui os stats base pela Forma Attack em tempo de execução.
const deoxysBlock =
  pokemonC.match(/#if defined\(FIRERED\)[\s\S]*?sDeoxysBaseStats\[\]\s*=\s*\{([\s\S]*?)\};/)?.[1] ??
  fail('sDeoxysBaseStats (FIRERED) ausente');
const deoxysStat = (s) => Number(deoxysBlock.match(new RegExp(`\\[STAT_${s}\\]\\s*=\\s*(\\d+)`))?.[1] ?? fail(`STAT_${s}`));
const deoxys = species.find((s) => s.key === 'deoxys') ?? fail('deoxys ausente');
deoxys.baseStats = {
  hp: deoxysStat('HP'),
  atk: deoxysStat('ATK'),
  def: deoxysStat('DEF'),
  spa: deoxysStat('SPATK'),
  spd: deoxysStat('SPDEF'),
  spe: deoxysStat('SPEED'),
};
deoxys.form = 'attack';
const rules = { hmMoves };

// ---------- itens ----------
const itemConsts = constants('include/constants/items.h', 'ITEM_');
const items = JSON.parse(read('src/data/items.json'))
  .items.filter((it) => it.itemId !== 'ITEM_NONE')
  .map((it) => ({
    id: itemConsts.get(it.itemId) ?? fail(`id de item desconhecido ${it.itemId}`),
    key: it.itemId.replace('ITEM_', '').toLowerCase(),
    name: it.english,
    pocket: it.pocket.replace('POCKET_', '').toLowerCase(),
    price: it.price,
    holdEffect: it.holdEffect === 'HOLD_EFFECT_NONE' ? null : it.holdEffect.replace('HOLD_EFFECT_', '').toLowerCase(),
    keyItem: it.importance > 0,
    description: (it.description_english ?? '').replace(/\s*(\\n|\n)\s*/g, ' ').trim(),
  }))
  .sort((a, b) => a.id - b.id);

// ---------- mapas ----------
const mapGroups = JSON.parse(read('data/maps/map_groups.json'));
const maps = mapGroups.group_order.flatMap((g, group) =>
  mapGroups[g].map((name, num) => ({ group, num, key: name })),
);

// ---------- treinadores ----------
// Fonte: src/data/trainers.h, src/data/trainer_parties.h e os scripts de mapa (trainerbattle_*).
// Só entram treinadores usados por algum mapa do FireRed (descarta sobras de Ruby/Sapphire).
const trainerConsts = constants('include/constants/opponents.h', 'TRAINER_');
const classNames = names('src/data/text/trainer_class_names.h');
const itemKey = (c) => c.replace('ITEM_', '').toLowerCase();

// Codificação de texto do jogo, para reproduzir o hash de nome que define personality/nature.
const GAME_CHARS = { ' ': 0x00, 'é': 0x1b, '!': 0xab, '?': 0xac, '.': 0xad, '-': 0xae, "'": 0xb4, '♂': 0xb5, '♀': 0xb6, ',': 0xb8, '/': 0xba };
for (let i = 0; i < 10; i++) GAME_CHARS[String(i)] = 0xa1 + i;
for (let i = 0; i < 26; i++) {
  GAME_CHARS[String.fromCharCode(65 + i)] = 0xbb + i;
  GAME_CHARS[String.fromCharCode(97 + i)] = 0xd5 + i;
}
const gameBytesSum = (s) => {
  let sum = 0;
  for (const ch of s) {
    if (!(ch in GAME_CHARS)) return null;
    sum += GAME_CHARS[ch];
  }
  return sum;
};
const NATURES = ['hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax', 'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash', 'calm', 'gentle', 'sassy', 'careful', 'quirky'];

const partiesSrc = read('src/data/trainer_parties.h');
const parties = new Map();
for (const m of partiesSrc.matchAll(/static const struct (TrainerMon\w+) (sParty_\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
  const mons = [];
  for (const b of m[3].matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const body = b[1];
    const speciesC = field(body, 'species');
    if (!speciesC) continue;
    const movesM = body.match(/\.moves\s*=\s*\{([^}]*)\}/);
    const held = field(body, 'heldItem');
    mons.push({
      iv: Number(field(body, 'iv') ?? 0),
      level: Number(field(body, 'lvl')),
      speciesC,
      ...(movesM ? { moves: movesM[1].split(',').map((x) => x.trim()).filter((x) => x && x !== 'MOVE_NONE').map(moveKey) } : {}),
      ...(held && held !== 'ITEM_NONE' ? { heldItem: itemKey(held) } : {}),
    });
  }
  parties.set(m[2], mons);
}

// Rótulo de script → treinadores que ele enfrenta.
function scriptTrainers(src) {
  const out = new Map();
  let label = null;
  for (const line of src.split('\n')) {
    const l = line.match(/^(\w+)::/);
    if (l) {
      label = l[1];
      continue;
    }
    const t = line.match(/trainerbattle\w*\s+(TRAINER_\w+)/);
    if (t && label) {
      if (!out.has(label)) out.set(label, new Set());
      out.get(label).add(t[1]);
    }
  }
  return out;
}
const sharedScripts = scriptTrainers(read('data/scripts/trainers.inc'));
const trainerMaps = new Map();
const addTrainerMap = (t, mapName) => {
  if (!trainerMaps.has(t)) trainerMaps.set(t, new Set());
  trainerMaps.get(t).add(mapName);
};
for (const mapName of maps.map((m) => m.key)) {
  // Batalhas no script do próprio mapa (líderes, rival, eventos).
  try {
    for (const ts of scriptTrainers(read(`data/maps/${mapName}/scripts.inc`)).values()) for (const t of ts) addTrainerMap(t, mapName);
  } catch {}
  // Treinadores de rota: o objeto do mapa aponta para um script em data/scripts/trainers.inc.
  try {
    const mapJson = JSON.parse(read(`data/maps/${mapName}/map.json`));
    for (const ev of mapJson.object_events ?? []) {
      for (const t of sharedScripts.get(ev.script) ?? []) addTrainerMap(t, mapName);
    }
  } catch {}
}

const speciesByConst = new Map(species.map((s) => [`SPECIES_${s.key.toUpperCase()}`, s]));
const trainers = blocks(read('src/data/trainers.h'), 'TRAINER_')
  .filter(({ key }) => trainerMaps.has(key))
  .map(({ key, body }) => {
    const id = trainerConsts.get(key) ?? fail(`id de treinador desconhecido ${key}`);
    const name = body.match(/\.trainerName\s*=\s*_\("([^"]*)"\)/)?.[1] ?? '';
    const classC = field(body, 'trainerClass');
    const female = /F_TRAINER_FEMALE/.test(field(body, 'encounterMusic_gender') ?? '');
    const double = field(body, 'doubleBattle') === 'TRUE';
    const partySym = body.match(/\.party\s*=\s*\w+\((sParty_\w+)\)/)?.[1] ?? fail(`party ausente ${key}`);
    const partyRaw = parties.get(partySym) ?? fail(`party ${partySym} não encontrada`);
    const items = (body.match(/\.items\s*=\s*\{([^}]*)\}/)?.[1] ?? '')
      .split(',').map((x) => x.trim()).filter((x) => x && x !== 'ITEM_NONE').map(itemKey);
    // Reproduz CreateNPCTrainerParty (src/battle_main.c): o hash de nome acumula entre os Pokémon.
    const base = double ? 0x80 : female ? 0x78 : 0x88;
    let hash = 0;
    let hashOk = true;
    const party = partyRaw.map((mon) => {
      const sp = speciesByConst.get(mon.speciesC) ?? fail(`espécie ${mon.speciesC} em ${key}`);
      const tSum = gameBytesSum(name);
      const sSum = gameBytesSum(speciesNames.get(mon.speciesC) ?? '');
      if (tSum === null || sSum === null) hashOk = false;
      hash += (tSum ?? 0) + (sSum ?? 0);
      const personality = (base + hash * 256) >>> 0;
      return {
        species: sp.key,
        level: mon.level,
        iv: Math.floor((mon.iv * 31) / 255),
        // personality é sempre par: em Gen III, o bit 0 escolhe a habilidade, então é sempre a primeira.
        ability: sp.abilities[0] ?? null,
        nature: hashOk ? NATURES[personality % 25] : null,
        ...(mon.moves ? { moves: mon.moves } : {}),
        ...(mon.heldItem ? { heldItem: mon.heldItem } : {}),
      };
    });
    const variant = key.match(/_(BULBASAUR|CHARMANDER|SQUIRTLE)$/)?.[1]?.toLowerCase();
    return {
      id,
      key: key.replace('TRAINER_', '').toLowerCase(),
      name,
      trainerClass: classNames.get(classC) ?? classC,
      double,
      items,
      maps: [...trainerMaps.get(key)].sort(),
      ...(variant ? { rivalStarter: variant } : {}),
      party,
    };
  })
  .sort((a, b) => a.id - b.id);

// ---------- TMs e HMs (src/data/party_menu.h: sTMHMMoves; tmhm_learnsets.h) ----------
const tmBlock = read('src/data/party_menu.h').match(/sTMHMMoves\[\]\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? fail('sTMHMMoves ausente');
const tmMoves = [...tmBlock.matchAll(/MOVE_\w+/g)].map((m) => moveKey(m[0]));
if (tmMoves.length !== 58) fail(`esperava 58 TMs/HMs, achei ${tmMoves.length}`);
const pad2 = (n) => String(n).padStart(2, '0');
const machines = tmMoves.map((move, i) => {
  const hm = i >= 50;
  const label = hm ? `HM${pad2(i - 49)}` : `TM${pad2(i + 1)}`;
  const item = label.toLowerCase();
  if (!items.some((it) => it.key === item)) fail(`item ${item} ausente`);
  if (!moves.some((m) => m.key === move)) fail(`golpe ${move} ausente`);
  return { item, label, move, hm };
});
const learnSrc = read('src/data/pokemon/tmhm_learnsets.h');
for (const m of learnSrc.matchAll(/\[(SPECIES_\w+)\]\s*=\s*TMHM_LEARNSET\(([\s\S]*?)\),?\s*\n(?=\s*\[|\s*\};)/g)) {
  const sp = speciesByConst.get(m[1]);
  if (!sp) continue;
  sp.tmhm = [...m[2].matchAll(/TMHM\((TM|HM)(\d\d)_\w+\)/g)].map(([, kind, num]) => machines[kind === 'TM' ? Number(num) - 1 : 49 + Number(num)].move);
}
if (!species.find((x) => x.key === 'snorlax')?.tmhm?.includes('earthquake')) fail('tmhm: Snorlax deveria aprender Earthquake');

// ---------- jornada (roteiro curado, validado contra o jogo) ----------
const maxTrainers = constants('include/constants/opponents.h', 'MAX_TRAINERS_COUNT');
const flagConsts = constants('include/constants/flags.h', '(?:FLAG_|SYS_FLAGS|TRAINER_FLAGS_|NUM_)', maxTrainers);
if (flagConsts.get('SYS_FLAGS') !== 0x800) fail(`SYS_FLAGS inesperado: ${flagConsts.get('SYS_FLAGS')}`);
const curated = JSON.parse(readFileSync(join(ROOT, 'packages/data-firered/curated/walkthrough.json'), 'utf8'));
const BADGE_KEYS = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh', 'volcano', 'earth'];
const itemKeys = new Set(items.map((i) => i.key));
const trainerKeys = new Set(trainers.map((t) => t.key));
const trainerRef = (k) => trainerKeys.has(k) || ['bulbasaur', 'charmander', 'squirtle'].some((v) => trainerKeys.has(`${k}_${v}`));
const resolveCond = (c, stepId) => {
  if ('flag' in c) {
    const id = flagConsts.get(c.flag);
    if (id === undefined) fail(`jornada/${stepId}: flag ${c.flag} não existe`);
    return { flag: id, name: c.flag };
  }
  if ('badge' in c) {
    if (!BADGE_KEYS.includes(c.badge)) fail(`jornada/${stepId}: insígnia ${c.badge}`);
    return c;
  }
  if ('item' in c) {
    if (!itemKeys.has(c.item)) fail(`jornada/${stepId}: item ${c.item}`);
    return c;
  }
  if ('trainer' in c) {
    if (!trainerRef(c.trainer)) fail(`jornada/${stepId}: treinador ${c.trainer}`);
    return c;
  }
  fail(`jornada/${stepId}: condição inválida ${JSON.stringify(c)}`);
};
const walkthrough = curated.steps.map((s) => {
  if (s.trainer && !trainerRef(s.trainer)) fail(`jornada/${s.id}: treinador ${s.trainer}`);
  const done = s.done.any ? { any: s.done.any.map((c) => resolveCond(c, s.id)) } : { all: s.done.all.map((c) => resolveCond(c, s.id)) };
  return { ...s, done };
});

// ---------- invariantes ----------
const typeNames = new Set(types.map((t) => t.name));
for (const mv of moves) if (!typeNames.has(mv.type)) fail(`golpe ${mv.key} com tipo inválido`);
for (const sp of species) for (const lm of sp.levelUpMoves) if (!moves.some((m) => m.key === lm.move)) fail(`learnset ${sp.key}: ${lm.move}`);
if (typeChart.length < 100) fail('tabela de tipos incompleta');

// ---------- escrita ----------
mkdirSync(OUT, { recursive: true });
const files = { types, typeChart, abilities, moves, species, items, maps, rules, trainers, walkthrough, machines };
const hashes = {};
for (const [name, value] of Object.entries(files)) {
  const json = `${JSON.stringify(value, null, 1)}\n`;
  writeFileSync(join(OUT, `${name}.json`), json);
  hashes[`${name}.json`] = createHash('sha256').update(json).digest('hex');
}
let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', DECOMP, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}
const manifest = {
  rulesetId: 'firered-gen3',
  contentPackId: 'firered',
  datasetVersion: DATASET_VERSION,
  source: { repo: 'https://github.com/pret/pokefirered', commit, note: 'Somente dados derivados; nenhum código ou asset é redistribuído.' },
  counts: Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v).length]),
  ),
  sha256: hashes,
};
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`dataset ${DATASET_VERSION} gerado:`, manifest.counts);
