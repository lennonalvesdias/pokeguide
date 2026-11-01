// Dataset firered-gen3 gerado por tools/data-pipeline a partir do decomp pret/pokefirered.
// Não editar os JSON à mão: rode `pnpm data:fetch && pnpm data:build`.
import type { JourneyStep, MoveDefinition, SpeciesDefinition, TypeChartEntry, Versions } from '@pokeguide/domain';
import abilitiesJson from '../data/abilities.json' with { type: 'json' };
import itemsJson from '../data/items.json' with { type: 'json' };
import machinesJson from '../data/machines.json' with { type: 'json' };
import manifestJson from '../data/manifest.json' with { type: 'json' };
import mapsJson from '../data/maps.json' with { type: 'json' };
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
export const rules = rulesJson as { hmMoves: string[] };
export const trainers = trainersJson as TrainerDefinition[];
/** TM/HM → golpe (sTMHMMoves). */
export const machines = machinesJson as MachineDefinition[];
/** Roteiro da história (curado em curated/walkthrough.json, validado pelo pipeline). */
export const walkthrough = walkthroughJson as unknown as JourneyStep[];
export const manifest = manifestJson;

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
