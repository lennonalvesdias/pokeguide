// Gera o dataset firered-gen3 a partir do decomp pret/pokefirered.
// Uso: node tools/data-pipeline/build.mjs [dir-decomp]   (padrão: .decomp)
// Saída: packages/data-firered/data/*.json + manifest.json (com SHA-256 por arquivo).
// Determinístico: mesma entrada gera os mesmos bytes (sem timestamps).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATASET_VERSION = '0.1.0';
const ROOT = resolve(import.meta.dirname, '../..');
const DECOMP = resolve(process.argv[2] ?? join(ROOT, '.decomp'));
const OUT = join(ROOT, 'packages/data-firered/data');

const read = (p) => readFileSync(join(DECOMP, p), 'utf8');
const fail = (msg) => {
  throw new Error(`[data-pipeline] ${msg}`);
};

/** Lê #defines numéricos, resolvendo referências simples (A + 1, (A + 0x20)). */
function constants(file, prefix) {
  const byName = new Map();
  for (const line of read(file).split('\n')) {
    const m = line.match(new RegExp(`^#define\\s+(${prefix}\\w+)\\s+(.+?)\\s*(//.*)?$`));
    if (!m) continue;
    const [, name, raw] = m;
    const expr = raw.replace(/[()]/g, '').trim();
    let value = Number(expr);
    if (Number.isNaN(value)) {
      const ref = expr.match(/^(\w+)\s*\+\s*(\w+)$/);
      if (ref && byName.has(ref[1])) value = byName.get(ref[1]) + Number(ref[2]);
      else if (byName.has(expr)) value = byName.get(expr);
      else continue;
    }
    byName.set(name, value);
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
  }))
  .sort((a, b) => a.id - b.id);

// ---------- mapas ----------
const mapGroups = JSON.parse(read('data/maps/map_groups.json'));
const maps = mapGroups.group_order.flatMap((g, group) =>
  mapGroups[g].map((name, num) => ({ group, num, key: name })),
);

// ---------- invariantes ----------
const typeNames = new Set(types.map((t) => t.name));
for (const mv of moves) if (!typeNames.has(mv.type)) fail(`golpe ${mv.key} com tipo inválido`);
for (const sp of species) for (const lm of sp.levelUpMoves) if (!moves.some((m) => m.key === lm.move)) fail(`learnset ${sp.key}: ${lm.move}`);
if (typeChart.length < 100) fail('tabela de tipos incompleta');

// ---------- escrita ----------
mkdirSync(OUT, { recursive: true });
const files = { types, typeChart, abilities, moves, species, items, maps, rules };
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
