// Gera o dataset firered-gen3 a partir do decomp pret/pokefirered.
// Uso: node tools/data-pipeline/build.mjs [dir-decomp]   (padrão: .decomp)
// Saída: packages/data-firered/data/*.json + manifest.json (com SHA-256 por arquivo).
// Determinístico: mesma entrada gera os mesmos bytes (sem timestamps).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATASET_VERSION = '0.7.0';
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
      expYield: Number(field(body, 'expYield')),
      growthRate: field(body, 'growthRate')?.replace('GROWTH_', '').toLowerCase(),
      levelUpMoves: learnsetBySpecies.get(key) ?? [],
    };
  })
  .sort((a, b) => a.id - b.id);

// ---------- regras específicas do FireRed (src/pokemon.c) ----------
const pokemonC = read('src/pokemon.c');
// Número da Pokédex Nacional (sSpeciesToNationalPokedexNum): o índice interno difere após o #251.
const nationalOrder = [...read('include/constants/pokedex.h').matchAll(/^\s*(NATIONAL_DEX_\w+),/gm)].map((m) => m[1]);
const nationalDex = new Map(nationalOrder.map((n, i) => [n, i]));
for (const m of pokemonC.matchAll(/SPECIES_TO_NATIONAL\((\w+)\)/g)) {
  const sp = species.find((x) => x.key === m[1].toLowerCase());
  const dex = nationalDex.get(`NATIONAL_DEX_${m[1]}`);
  if (sp && dex) sp.dex = dex;
}
for (const sp of species) if (!sp.dex) fail(`dex ausente ${sp.key}`);
if (species.find((x) => x.key === 'treecko')?.dex !== 252) fail('dex: Treecko deveria ser #252');
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
// Tabelas de experiência (gExperienceTables): XP total para estar em cada nível, por ritmo de crescimento.
const cube = (n) => n * n * n;
const idiv = (a, b) => Math.trunc(a / b);
const EXP = {
  EXP_SLOW: (n) => idiv(5 * cube(n), 4),
  EXP_FAST: (n) => idiv(4 * cube(n), 5),
  EXP_MEDIUM_FAST: (n) => cube(n),
  EXP_MEDIUM_SLOW: (n) => idiv(6 * cube(n), 5) - 15 * n * n + 100 * n - 140,
  EXP_ERRATIC: (n) =>
    n <= 50 ? idiv((100 - n) * cube(n), 50) : n <= 68 ? idiv((150 - n) * cube(n), 100) : n <= 98 ? idiv(idiv(1911 - 10 * n, 3) * cube(n), 500) : idiv((160 - n) * cube(n), 100),
  EXP_FLUCTUATING: (n) =>
    n <= 15 ? idiv((idiv(n + 1, 3) + 24) * cube(n), 50) : n <= 36 ? idiv((n + 14) * cube(n), 50) : idiv((idiv(n, 2) + 32) * cube(n), 50),
};
const growthConsts = constants('include/constants/pokemon.h', 'GROWTH_');
const expSrc = read('src/data/pokemon/experience_tables.h').split('gExperienceTables')[1] ?? fail('gExperienceTables ausente');
const expBlocks = [...expSrc.matchAll(/\{\s*\/\/[^\n]*\n([\s\S]*?)\}/g)].map((m) =>
  [...m[1].matchAll(/^\s*(?:(\d+)|(EXP_\w+)\((\d+)\)),/gm)].map((e) => (e[1] !== undefined ? Number(e[1]) : (EXP[e[2]] ?? fail(`macro ${e[2]}`))(Number(e[3])))),
);
const expTables = {};
for (const [name, id] of growthConsts) {
  const table = expBlocks[id] ?? fail(`tabela de XP ${name}`);
  if (table.length !== 101) fail(`tabela de XP ${name} com ${table.length} níveis`);
  expTables[name.replace('GROWTH_', '').toLowerCase()] = table;
}
if (expTables.medium_fast[50] !== 125000 || expTables.slow[100] !== 1250000 || expTables.erratic[100] !== 600000) fail('tabelas de XP inesperadas');
const rules = { hmMoves, expTables };

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
  for (const a of s.areas ?? []) if (!maps.some((m) => m.key.split('_')[0] === a)) fail(`jornada/${s.id}: área ${a} não é prefixo de nenhum mapa`);
  const done = s.done.any ? { any: s.done.any.map((c) => resolveCond(c, s.id)) } : { all: s.done.all.map((c) => resolveCond(c, s.id)) };
  return { ...s, done };
});

// ---------- encontros selvagens (só FireRed) ----------
const mapNameById = new Map();
for (const m of maps) {
  try {
    mapNameById.set(JSON.parse(read(`data/maps/${m.key}/map.json`)).id, m.key);
  } catch {}
}
const encounterSrc = JSON.parse(read('src/data/wild_encounters.json')).wild_encounter_groups.find((g) => g.for_maps);
const fieldRates = Object.fromEntries(encounterSrc.fields.map((f) => [f.type, f]));
const METHODS = { land_mons: 'land', water_mons: 'water', rock_smash_mons: 'rock_smash' };
const encounters = [];
for (const e of encounterSrc.encounters) {
  if (!e.base_label.endsWith('_FireRed')) continue;
  const map = mapNameById.get(e.map) ?? fail(`encontros: mapa ${e.map}`);
  const slots = [];
  const add = (method, mons, rates) => {
    const bySpecies = new Map();
    mons.forEach((mon, i) => {
      const key = speciesByConst.get(mon.species)?.key ?? fail(`encontros: ${mon.species}`);
      const cur = bySpecies.get(key) ?? { species: key, method, rate: 0, minLevel: 100, maxLevel: 0 };
      cur.rate += rates[i];
      cur.minLevel = Math.min(cur.minLevel, mon.min_level);
      cur.maxLevel = Math.max(cur.maxLevel, mon.max_level);
      bySpecies.set(key, cur);
    });
    slots.push(...[...bySpecies.values()].sort((a, b) => b.rate - a.rate));
  };
  for (const [field, method] of Object.entries(METHODS)) if (e[field]) add(method, e[field].mons, fieldRates[field].encounter_rates);
  if (e.fishing_mons) {
    const f = fieldRates.fishing_mons;
    for (const [rod, idx] of Object.entries(f.groups)) {
      // Taxas por vara somam 100 dentro do grupo.
      add(rod, idx.map((i) => e.fishing_mons.mons[i]), idx.map((i) => f.encounter_rates[i]));
    }
  }
  encounters.push({ map, slots });
}
encounters.sort((a, b) => a.map.localeCompare(b.map));
if (!encounters.find((e) => e.map === 'Route1')?.slots.some((s) => s.species === 'pidgey' && s.rate === 50)) fail('encontros: Route1 deveria ter Pidgey 50%');

// ---------- navegação (walkthrough verificável) ----------
// Fonte: layout (colisão por tile), atributos de metatile (comportamento das escadas e buracos),
// eventos do mapa (warps, estátuas, itens, treinadores) e o script compartilhado do interruptor.
// Nada aqui é editorial: rótulos e textos ficam em curated/navigation.json.
const fieldmap = read('include/fieldmap.h');
const NUM_PRIMARY = Number(fieldmap.match(/#define NUM_METATILES_IN_PRIMARY (\d+)/)?.[1] ?? fail('NUM_METATILES_IN_PRIMARY'));
const behaviorNames = new Map([...read('include/constants/metatile_behaviors.h').matchAll(/#define (MB_\w+) (0x[0-9A-Fa-f]+)/g)].map((m) => [Number(m[2]), m[1]]));
const metatileIds = constants('include/constants/metatile_labels.h', 'METATILE_');
const layoutsJson = JSON.parse(read('data/layouts/layouts.json')).layouts;
const TILESET_DIR = { gTileset_Building: 'primary/building', gTileset_PokemonMansion: 'secondary/pokemon_mansion' };
const readU32s = (p) => {
  const b = readFileSync(join(DECOMP, p));
  return Array.from({ length: b.length / 4 }, (_, i) => b.readUInt32LE(i * 4));
};
const readU16s = (p) => {
  const b = readFileSync(join(DECOMP, p));
  return Array.from({ length: b.length / 2 }, (_, i) => b.readUInt16LE(i * 2));
};
// Em FRLG cada atributo de metatile tem 4 bytes; o comportamento fica nos bits 0–8.
const behaviorOf = (layout, metatile) => {
  const prim = readU32s(`data/tilesets/${TILESET_DIR[layout.primary_tileset] ?? fail(`tileset ${layout.primary_tileset}`)}/metatile_attributes.bin`);
  const sec = readU32s(`data/tilesets/${TILESET_DIR[layout.secondary_tileset] ?? fail(`tileset ${layout.secondary_tileset}`)}/metatile_attributes.bin`);
  const attr = metatile < NUM_PRIMARY ? prim[metatile] : sec[metatile - NUM_PRIMARY];
  return behaviorNames.get(attr & 0x1ff) ?? fail(`comportamento ${attr & 0x1ff}`);
};
// setmetatile x, y, METATILE_X, impassable — por rótulo de script.
function setMetatiles(src) {
  const out = new Map();
  let label = null;
  for (const line of src.split('\n')) {
    const l = line.match(/^(\w+)::/);
    if (l) {
      label = l[1];
      out.set(label, []);
      continue;
    }
    const m = line.match(/setmetatile\s+(\d+),\s*(\d+),\s*(METATILE_\w+),\s*(\d)/);
    if (m && label) out.get(label).push({ x: Number(m[1]), y: Number(m[2]), metatile: metatileIds.get(m[3]) ?? fail(m[3]), impassable: m[4] === '1' });
  }
  return out;
}
const STAIRS = new Set(['MB_UP_RIGHT_STAIR_WARP', 'MB_UP_LEFT_STAIR_WARP', 'MB_DOWN_RIGHT_STAIR_WARP', 'MB_DOWN_LEFT_STAIR_WARP']);
const ARROW = { MB_SOUTH_ARROW_WARP: 'down', MB_NORTH_ARROW_WARP: 'up', MB_EAST_ARROW_WARP: 'right', MB_WEST_ARROW_WARP: 'left' };
const FACING = { BG_EVENT_PLAYER_FACING_NORTH: 'up', BG_EVENT_PLAYER_FACING_SOUTH: 'down', BG_EVENT_PLAYER_FACING_EAST: 'right', BG_EVENT_PLAYER_FACING_WEST: 'left' };
const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const MOVEMENT_FACING = { MOVEMENT_TYPE_FACE_LEFT: ['left'], MOVEMENT_TYPE_FACE_RIGHT: ['right'], MOVEMENT_TYPE_FACE_UP: ['up'], MOVEMENT_TYPE_FACE_DOWN: ['down'] };

const itemBallScripts = read('data/scripts/item_ball_scripts.inc');
const curatedNav = JSON.parse(readFileSync(join(ROOT, 'packages/data-firered/curated/navigation.json'), 'utf8'));
const navigation = curatedNav.areas.map((area) => {
  const flagId = flagConsts.get(`FLAG_${area.switchFlag}`) ?? fail(`navegação/${area.id}: flag ${area.switchFlag}`);
  const scripts = setMetatiles(read(area.switchScript));
  const mapJsonByKey = new Map(area.floors.map((f) => [f.map, JSON.parse(read(`data/maps/${f.map}/map.json`))]));
  const keyByConst = new Map(area.floors.map((f) => [mapJsonByKey.get(f.map).id, f.map]));
  const pois = [];
  const floors = area.floors.map((f) => {
    const mj = mapJsonByKey.get(f.map);
    const layout = layoutsJson.find((l) => l.id === mj.layout) ?? fail(`layout ${mj.layout}`);
    const { width, height } = layout;
    const blocks = readU16s(layout.blockdata_filepath);
    if (blocks.length !== width * height) fail(`navegação/${f.map}: layout com tamanho inesperado`);
    const at = (x, y) => blocks[y * width + x];
    // Estado do layout = interruptor desligado (OnLoad só reaplica o "Press" com a flag ligada).
    const pass = { off: blocks.map((b) => ((b >> 10) & 3) === 0), on: blocks.map((b) => ((b >> 10) & 3) === 0) };
    // O próprio mapa diz qual script reaplica o interruptor ao carregar com a flag ligada.
    const mapScripts = read(`data/maps/${f.map}/scripts.inc`);
    const pressLabel = mapScripts.match(new RegExp(`call_if_set FLAG_${area.switchFlag}, (\\w+)`))?.[1] ?? fail(`navegação/${f.map}: OnLoad sem interruptor`);
    const press = scripts.get(pressLabel) ?? fail(`navegação/${f.map}: ${pressLabel}`);
    const reset = scripts.get(pressLabel.replace('PressSwitch', 'ResetSwitch')) ?? fail(`navegação/${f.map}: script Reset`);
    // Sinal visível do estado: a estátua fica com olhos vermelhos ligada e pretos desligada.
    const label = (id) => [...metatileIds.entries()].find(([k, v]) => v === id && k.includes('Statue'))?.[0] ?? '';
    if (!press.some((t) => label(t.metatile).includes('RedEyes')) || !reset.some((t) => label(t.metatile).includes('BlackEyes'))) fail(`navegação/${f.map}: olhos da estátua`);
    for (const t of reset) {
      // O layout precisa já estar no estado desligado: senão o modelo de "off" não é o do jogo.
      if ((at(t.x, t.y) & 0x3ff) !== t.metatile) fail(`navegação/${f.map}: (${t.x},${t.y}) no layout difere do Reset`);
      pass.off[t.y * width + t.x] = !t.impassable;
    }
    for (const t of press) pass.on[t.y * width + t.x] = !t.impassable;
    const objects = (mj.object_events ?? []).map((o) => ({ x: o.x, y: o.y }));
    const grid = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        row += pass.off[i] && pass.on[i] ? '.' : pass.on[i] ? '1' : pass.off[i] ? '0' : '#';
      }
      grid.push(row);
    }
    const src = `data/maps/${f.map}/map.json`;
    // Warps que disparam (escadas, buracos, setas de saída). Os de comportamento comum só recebem quem chega.
    const falls = new Map();
    (mj.warp_events ?? []).forEach((w, i) => {
      const beh = behaviorOf(layout, at(w.x, w.y) & 0x3ff);
      const passable = ((at(w.x, w.y) >> 10) & 3) === 0;
      const destKey = keyByConst.get(w.dest_map);
      const destWarp = destKey ? mapJsonByKey.get(destKey).warp_events[Number(w.dest_warp_id)] : null;
      const to = destKey ? { floor: destKey, x: destWarp.x, y: destWarp.y } : { map: w.dest_map.replace('MAP_', '') };
      const source = `${src}#warp_events[${i}]`;
      if (STAIRS.has(beh) && passable) {
        if (!destKey) fail(`navegação/${f.map}: escada para fora da área`);
        pois.push({ id: `${f.map}:stairs:${i}`, kind: 'stairs', floor: f.map, x: w.x, y: w.y, direction: beh.startsWith('MB_UP') ? 'up' : 'down', to, source });
      } else if (beh === 'MB_FALL_WARP' && passable) {
        // Um buraco = os tiles que caem no mesmo andar; cada tile guarda onde exatamente você cai.
        if (!destKey) fail(`navegação/${f.map}: buraco para fora da área`);
        if (!falls.has(destKey)) falls.set(destKey, { tiles: [], sources: [] });
        falls.get(destKey).tiles.push({ x: w.x, y: w.y, to });
        falls.get(destKey).sources.push(source);
      } else if (ARROW[beh] && passable && !destKey) {
        pois.push({ id: `${f.map}:exit:${i}`, kind: 'exit', floor: f.map, x: w.x, y: w.y, press: ARROW[beh], to, source });
      }
    });
    for (const [, fl] of [...falls.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      fl.tiles.sort((a, b) => a.y - b.y || a.x - b.x);
      const to = { floor: fl.tiles[0].to.floor, x: fl.tiles[0].to.x, y: fl.tiles[0].to.y };
      pois.push({ id: `${f.map}:fall:${fl.tiles[0].x}-${fl.tiles[0].y}`, kind: 'fall', floor: f.map, x: fl.tiles[0].x, y: fl.tiles[0].y, tiles: fl.tiles, to, source: fl.sources.join(' ') });
    }
    (mj.bg_events ?? []).forEach((b, i) => {
      if (b.type !== 'sign' || b.script !== `${f.map}_EventScript_Statue`) return;
      const facing = FACING[b.player_facing_dir] ?? fail(`navegação/${f.map}: estátua sem direção`);
      const [dx, dy] = STEP[facing];
      const stand = { x: b.x - dx, y: b.y - dy };
      pois.push({ id: `${f.map}:switch:${i}`, kind: 'switch', floor: f.map, x: b.x, y: b.y, stand, facing, source: `${src}#bg_events[${i}] ${area.switchScript}` });
    });
    (mj.object_events ?? []).forEach((o, i) => {
      const source = `${src}#object_events[${i}]`;
      const item = o.script.match(/_EventScript_Item(\w+)$/);
      if (item) {
        const itemConst = itemBallScripts.match(new RegExp(`^${o.script}::\\s+finditem\\s+(ITEM_\\w+)`, 'm'))?.[1] ?? fail(`navegação/${o.script}: item`);
        const key = itemKey(itemConst);
        if (!itemKeys.has(key)) fail(`navegação/${o.script}: item ${key}`);
        pois.push({ id: `${f.map}:item:${i}`, kind: 'item', floor: f.map, x: o.x, y: o.y, item: key, hideFlag: flagConsts.get(o.flag) ?? fail(`navegação/${o.flag}`), source });
        return;
      }
      const ts = [...(scriptTrainers(read(`data/maps/${f.map}/scripts.inc`)).get(o.script) ?? [])];
      if (o.trainer_type === 'TRAINER_TYPE_NORMAL' && ts.length === 1) {
        const key = ts[0].replace('TRAINER_', '').toLowerCase();
        if (!trainerKeys.has(key)) fail(`navegação/${o.script}: treinador ${key}`);
        pois.push({ id: `${f.map}:trainer:${i}`, kind: 'trainer', floor: f.map, x: o.x, y: o.y, trainer: key, sight: Number(o.trainer_sight_or_berry_tree_id), facing: MOVEMENT_FACING[o.movement_type] ?? ['up', 'down', 'left', 'right'], source });
      }
    });
    return { map: f.map, label: f.label, allowEscaping: mj.allow_escaping === true, group: maps.find((m) => m.key === f.map).group, num: maps.find((m) => m.key === f.map).num, width, height, grid, objects, source: `${layout.blockdata_filepath} ${src}` };
  });
  const entranceMap = JSON.parse(read(`data/maps/${area.entrance.from}/map.json`));
  const ew = entranceMap.warp_events.find((w) => keyByConst.has(w.dest_map)) ?? fail(`navegação/${area.id}: entrada`);
  const entranceFloor = keyByConst.get(ew.dest_map);
  const ewDest = mapJsonByKey.get(entranceFloor).warp_events[Number(ew.dest_warp_id)];
  const entrance = { floor: entranceFloor, x: ewDest.x, y: ewDest.y };
  const objectives = area.objectives.map((o) => {
    if (o.item && !pois.some((p) => p.kind === 'item' && p.item === o.item)) fail(`navegação/${area.id}: objetivo ${o.id} sem item ${o.item}`);
    return o;
  });
  const result = { id: area.id, name: area.name, mapPrefix: area.mapPrefix, switchFlag: { key: area.switchFlag, id: flagId }, entrance, floors, pois, objectives, notes: area.notes };
  validateNavigation(result);
  return result;
});

/** Alcançabilidade: dos objetivos a partir da entrada, com o interruptor partindo de qualquer estado. */
function validateNavigation(area) {
  const floorOf = new Map(area.floors.map((f) => [f.map, f]));
  const blocked = (f, x, y, on) => {
    const fl = floorOf.get(f);
    if (x < 0 || y < 0 || x >= fl.width || y >= fl.height) return true;
    if (fl.objects.some((o) => o.x === x && o.y === y)) return true;
    const c = fl.grid[y][x];
    return c === '#' || (c === '1' && !on) || (c === '0' && on);
  };
  const warpAt = new Map();
  for (const p of area.pois) {
    if (p.kind === 'stairs') warpAt.set(`${p.floor}:${p.x}:${p.y}`, p.to);
    if (p.kind === 'fall') for (const t of p.tiles) warpAt.set(`${p.floor}:${t.x}:${t.y}`, t.to);
  }
  const reach = (startOn) => {
    const seen = new Set();
    const q = [[area.entrance.floor, area.entrance.x, area.entrance.y, startOn]];
    while (q.length) {
      const [f, x, y, on] = q.pop();
      const k = `${f}:${x}:${y}:${on}`;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const p of area.pois) if (p.kind === 'switch' && p.floor === f && p.stand.x === x && p.stand.y === y) q.push([f, x, y, !on]);
      for (const [dx, dy] of Object.values(STEP)) {
        const nx = x + dx;
        const ny = y + dy;
        if (blocked(f, nx, ny, on)) continue;
        const to = warpAt.get(`${f}:${nx}:${ny}`);
        if (to) q.push([to.floor, to.x, to.y, on]);
        else q.push([f, nx, ny, on]);
      }
    }
    return seen;
  };
  for (const startOn of [false, true]) {
    const seen = reach(startOn);
    const has = (f, x, y) => seen.has(`${f}:${x}:${y}:true`) || seen.has(`${f}:${x}:${y}:false`);
    for (const p of area.pois) {
      if (p.kind === 'switch' && !has(p.floor, p.stand.x, p.stand.y)) fail(`navegação/${area.id}: estátua ${p.id} inalcançável`);
      if (p.kind === 'item' && !Object.values(STEP).some(([dx, dy]) => has(p.floor, p.x + dx, p.y + dy))) fail(`navegação/${area.id}: item ${p.id} inalcançável`);
      if (p.kind === 'stairs' && !area.floors.some((fl) => fl.map === p.to.floor)) fail(`navegação/${area.id}: escada ${p.id} sem destino`);
    }
    if (!area.pois.some((p) => p.kind === 'exit' && has(p.floor, p.x, p.y))) fail(`navegação/${area.id}: saída inalcançável`);
  }
}

// ---------- invariantes ----------
const typeNames = new Set(types.map((t) => t.name));
for (const mv of moves) if (!typeNames.has(mv.type)) fail(`golpe ${mv.key} com tipo inválido`);
for (const sp of species) for (const lm of sp.levelUpMoves) if (!moves.some((m) => m.key === lm.move)) fail(`learnset ${sp.key}: ${lm.move}`);
if (typeChart.length < 100) fail('tabela de tipos incompleta');

// ---------- escrita ----------
mkdirSync(OUT, { recursive: true });
const files = { types, typeChart, abilities, moves, species, items, maps, rules, trainers, walkthrough, machines, encounters, navigation };
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
