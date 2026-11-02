// Dataset firered-gen3 gerado por tools/data-pipeline a partir do decomp pret/pokefirered.
// Não editar os JSON à mão: rode `pnpm data:fetch && pnpm data:build`.
import { type AreaOpponent, type NavArea, type NavBlocker, type NavObstacle, type NavWorld, type WorldMap, type JourneyStep, type TrainingSpotInput, type MoveDefinition, type Opponent, type SpeciesDefinition, type TeachOpponent, type TypeChartEntry, type Versions, wildMoveset } from '@pokeguide/domain';
import abilitiesJson from '../data/abilities.json' with { type: 'json' };
import encountersJson from '../data/encounters.json' with { type: 'json' };
import itemsJson from '../data/items.json' with { type: 'json' };
import machinesJson from '../data/machines.json' with { type: 'json' };
import manifestJson from '../data/manifest.json' with { type: 'json' };
import mapsJson from '../data/maps.json' with { type: 'json' };
import navigationJson from '../data/navigation.json' with { type: 'json' };
import movesJson from '../data/moves.json' with { type: 'json' };
import rulesJson from '../data/rules.json' with { type: 'json' };
import speciesJson from '../data/species.json' with { type: 'json' };
import trainersJson from '../data/trainers.json' with { type: 'json' };
import typeChartJson from '../data/typeChart.json' with { type: 'json' };
import walkthroughJson from '../data/walkthrough.json' with { type: 'json' };

export interface ItemDefinition {
  id: number;
  key: string;
  name: string;
  pocket: string;
  price: number;
  holdEffect: string | null;
  keyItem: boolean;
  /** Descrição do jogo (em inglês, como no cartucho). */
  description: string;
}

export interface MachineDefinition {
  /** Chave do item (ex.: 'tm26', 'hm03'). */
  item: string;
  label: string;
  move: string;
  hm: boolean;
}

export interface TrainerPokemon {
  species: string;
  level: number;
  /** IV de todos os stats (0–31), já convertido da escala 0–255 do jogo. */
  iv: number;
  /** Sempre a primeira habilidade da espécie (personality par). */
  ability: string | null;
  nature: string | null;
  /** Golpes fixos; ausente = golpes padrão de level-up. */
  moves?: string[];
  heldItem?: string;
}

export interface TrainerDefinition {
  /** ID do treinador; a flag de vitória no save é 0x500 + id. */
  id: number;
  key: string;
  name: string;
  trainerClass: string;
  double: boolean;
  items: string[];
  maps: string[];
  /** Variantes do rival/campeão pelo inicial dele. */
  rivalStarter?: 'bulbasaur' | 'charmander' | 'squirtle';
  party: TrainerPokemon[];
}

export type EncounterMethod = 'land' | 'water' | 'rock_smash' | 'old_rod' | 'good_rod' | 'super_rod';

export interface EncounterSlot {
  species: string;
  method: EncounterMethod;
  /** Chance (%) dentro do método. */
  rate: number;
  minLevel: number;
  maxLevel: number;
}

export interface MapEncounters {
  /** Chave do mapa (mesma de `maps`). */
  map: string;
  slots: EncounterSlot[];
}

export interface MapDefinition {
  group: number;
  num: number;
  key: string;
}

export const species = speciesJson as unknown as SpeciesDefinition[];
export const moves = movesJson as unknown as MoveDefinition[];
export const typeChart = typeChartJson as unknown as TypeChartEntry[];
export const items = itemsJson as ItemDefinition[];
export const maps = mapsJson as MapDefinition[];
export const abilities = abilitiesJson as Array<{ id: number; key: string; name: string }>;
export const rules = rulesJson as { hmMoves: string[]; expTables: Record<string, number[]> };
export const trainers = trainersJson as TrainerDefinition[];
/** TM/HM → golpe (sTMHMMoves). */
export const machines = machinesJson as MachineDefinition[];
/** Roteiro da história (curado em curated/walkthrough.json, validado pelo pipeline). */
export const walkthrough = walkthroughJson as unknown as JourneyStep[];
/** Pokémon selvagens por mapa (versão FireRed). */
export const encounters = encountersJson as MapEncounters[];
export const manifest = manifestJson;
/** Áreas com guia passo a passo e bloqueios de script (os mapas ficam em `loadWorld`). */
export const navigation = navigationJson as unknown as { areas: NavArea[]; blockers: NavBlocker[]; newGameFlags: number[]; obstacles: Record<string, NavObstacle> };
/** Área com guia que contém o mapa (ex.: 'PokemonMansion_2F'), se houver. */
export const navigationAreaOf = (mapKey: string) => navigation.areas.find((a) => a.maps.includes(mapKey)) ?? null;

let worldPromise: Promise<NavWorld> | null = null;
/**
 * O mundo de Kanto (256 mapas, ~900 KB): carregado sob demanda, num pedaço separado do app,
 * para não atrasar a abertura. Fica em cache depois da primeira vez.
 */
export function loadWorld(): Promise<NavWorld> {
  worldPromise ??= import('../data/world.json', { with: { type: 'json' } }).then((m) => ({
    maps: (m.default as unknown as WorldMap[]),
    areas: navigation.areas,
    blockers: navigation.blockers,
    newGameFlags: navigation.newGameFlags,
    obstacles: navigation.obstacles,
  }));
  return worldPromise;
}

export const versions: Versions = {
  rulesetId: 'firered-gen3',
  contentPackId: 'firered',
  datasetVersion: manifest.datasetVersion,
};

function index<T, K>(list: readonly T[], key: (t: T) => K): Map<K, T> {
  return new Map(list.map((t) => [key(t), t]));
}

const speciesById = index(species, (s) => s.id);
const speciesByKey = index(species, (s) => s.key);
const movesById = index(moves, (m) => m.id);
const movesByKey = index(moves, (m) => m.key);
const itemsById = index(items, (i) => i.id);
const mapsByCoord = index(maps, (m) => `${m.group}.${m.num}`);

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`não encontrado: ${what}`);
  return v;
}

export const lookup = {
  species: (k: string | number) =>
    must(typeof k === 'number' ? speciesById.get(k) : speciesByKey.get(k), `espécie ${k}`),
  move: (k: string | number) => must(typeof k === 'number' ? movesById.get(k) : movesByKey.get(k), `golpe ${k}`),
  item: (id: number) => itemsById.get(id),
  map: (group: number, num: number) => mapsByCoord.get(`${group}.${num}`),
  isKnownItem: (id: number) => itemsById.has(id),
};

/**
 * Adversários de referência para avaliar golpes: o time dos treinadores ainda não vencidos
 * com nível próximo ou acima do da equipe (sem nenhum, todos os treinadores nessa faixa).
 */
export function upcomingOpponents(
  defeatedIds: ReadonlySet<number>,
  teamLevel: number,
  rivalStarter: TrainerDefinition['rivalStarter'] | null = null,
): TeachOpponent[] {
  const inRange = trainers.filter(
    (t) => (!t.rivalStarter || !rivalStarter || t.rivalStarter === rivalStarter) && Math.max(...t.party.map((p) => p.level)) >= teamLevel - 10,
  );
  const pending = inRange.filter((t) => !defeatedIds.has(t.id));
  const seen = new Set<string>();
  const out: TeachOpponent[] = [];
  for (const t of pending.length ? pending : inRange) {
    for (const p of t.party) {
      const k = `${p.species}:${p.level}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ species: lookup.species(p.species), level: p.level, ability: p.ability });
    }
  }
  return out;
}

const areaOf = (mapKey: string) => mapKey.split('_')[0] ?? mapKey;
const METHOD_WEIGHT: Record<EncounterMethod, number> = { land: 1, water: 1, rock_smash: 0.3, old_rod: 0.3, good_rod: 0.3, super_rod: 0.3 };

/** Selvagem no nível médio do encontro, com os golpes de level-up. */
export function wildOpponent(speciesKey: string, level: number): Opponent {
  const sp = lookup.species(speciesKey);
  return { species: sp, level, moves: wildMoveset(sp, level).map((m) => lookup.move(m)) };
}

/** Pokémon de treinador com stats, habilidade e golpes exatos do jogo. */
export function trainerOpponent(p: TrainerPokemon): Opponent {
  const sp = lookup.species(p.species);
  return {
    species: sp,
    level: p.level,
    iv: p.iv,
    nature: p.nature,
    ...(p.ability ? { ability: p.ability } : {}),
    moves: (p.moves ?? wildMoveset(sp, p.level)).map((m) => lookup.move(m)),
  };
}

/**
 * Selvagens das áreas (prefixos de mapa), pesados pela chance de encontro.
 * Varas só contam se o jogador já tem a vara.
 */
export function areaWildOpponents(areas: readonly string[], keyItems: ReadonlySet<string>): AreaOpponent[] {
  const maps = encounters.filter((e) => areas.includes(areaOf(e.map)));
  const byKey = new Map<string, { species: string; level: number; weight: number }>();
  for (const e of maps) {
    for (const s of e.slots) {
      if (s.method.endsWith('_rod') && !keyItems.has(s.method)) continue;
      const level = Math.round((s.minLevel + s.maxLevel) / 2);
      const k = `${s.species}:${level}`;
      const cur = byKey.get(k) ?? { species: s.species, level, weight: 0 };
      cur.weight += (s.rate / 100) * METHOD_WEIGHT[s.method] / maps.length;
      byKey.set(k, cur);
    }
  }
  return [...byKey.values()].sort((a, b) => b.weight - a.weight).map((x) => ({ opponent: wildOpponent(x.species, x.level), weight: x.weight }));
}

/** Treinadores ainda não vencidos nas áreas (o rival só na variante do inicial dele). */
export function areaTrainers(
  areas: readonly string[],
  defeatedIds: ReadonlySet<number>,
  rivalStarter: TrainerDefinition['rivalStarter'] | null = null,
): TrainerDefinition[] {
  return trainers.filter(
    (t) => !defeatedIds.has(t.id) && (!t.rivalStarter || !rivalStarter || t.rivalStarter === rivalStarter) && t.maps.some((m) => areas.includes(areaOf(m))),
  );
}

/** Lugares de treino: um por área + método (grama/caverna, surfando, cada vara), com os encontros no nível médio. */
export function trainingSpotInputs(areas: readonly string[], keyItems: ReadonlySet<string>): TrainingSpotInput[] {
  const groups = new Map<string, { maps: Set<string>; slots: Map<string, { species: string; level: number; rate: number }> }>();
  for (const e of encounters) {
    const area = areaOf(e.map);
    if (!areas.includes(area)) continue;
    for (const s of e.slots) {
      if (s.method === 'rock_smash' || (s.method.endsWith('_rod') && !keyItems.has(s.method))) continue;
      const key = `${area}|${s.method}`;
      const g = groups.get(key) ?? { maps: new Set(), slots: new Map() };
      g.maps.add(e.map);
      const level = Math.round((s.minLevel + s.maxLevel) / 2);
      const k = `${s.species}:${level}`;
      const cur = g.slots.get(k) ?? { species: s.species, level, rate: 0 };
      cur.rate += s.rate;
      g.slots.set(k, cur);
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    slots: [...g.slots.values()].map((x) => ({ opponent: wildOpponent(x.species, x.level), rate: x.rate / g.maps.size })),
  }));
}

export interface WildLevelHint {
  level: number;
  min: number;
  max: number;
  /** 'local': aparece no mapa do save; 'game': aparece em outro lugar do jogo; 'estimate': não aparece selvagem. */
  source: 'local' | 'game' | 'estimate';
  /** Mapa de onde veio a faixa (ausente na estimativa). */
  map?: string;
}

/**
 * Nível provável de um selvagem quando o jogador não informou: a faixa do encontro no mapa do save,
 * senão a faixa do jogo mais próxima do nível da equipe, senão o nível da equipe. Usa o máximo da faixa
 * (a ameaça maior), e a interface sempre pede para conferir o "Lv" na tela.
 */
export function wildLevelHint(speciesKey: string, mapKey: string, teamLevel: number): WildLevelHint {
  const slots = encounters.flatMap((e) => e.slots.filter((s) => s.species === speciesKey).map((s) => ({ map: e.map, ...s })));
  const prefix = areaOf(mapKey);
  const local = slots.filter((s) => s.map === mapKey || areaOf(s.map) === prefix);
  const pool = local.length ? local : slots;
  if (!pool.length) return { level: teamLevel, min: teamLevel, max: teamLevel, source: 'estimate' };
  const dist = (s: { minLevel: number; maxLevel: number }) => (teamLevel < s.minLevel ? s.minLevel - teamLevel : teamLevel > s.maxLevel ? teamLevel - s.maxLevel : 0);
  const best = [...pool].sort((a, b) => dist(a) - dist(b) || a.map.localeCompare(b.map))[0]!;
  return { level: best.maxLevel, min: best.minLevel, max: best.maxLevel, source: local.length ? 'local' : 'game', map: best.map };
}
