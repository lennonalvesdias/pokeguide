// Demonstração sem save: um jogo de exemplo logo depois da 3ª insígnia, na Route 10, perto do Rock Tunnel.
// Stats saem das fórmulas do jogo e os golpes do learnset por nível, para as recomendações serem reais.
// Fica só na memória: nunca é gravado nem confundido com o save do jogador.
import { items, lookup, maps, rules, trainers } from '@pokeguide/data-firered';
import { gen3Hp, gen3Stat, wildMoveset } from '@pokeguide/domain';
import { NATURES, type SavedPokemon, type SaveImportPreview } from '@pokeguide/save-parser';
import type { StoredSave } from '../../state.ts';

const itemId = (key: string) => items.find((i) => i.key === key)!.id;
const stack = (key: string, quantity = 1) => ({ itemId: itemId(key), quantity });

interface DemoMon {
  species: string;
  level: number;
  nature: (typeof NATURES)[number];
  iv: number;
  hpRatio: number;
}

const TEAM: DemoMon[] = [
  { species: 'wartortle', level: 29, nature: 'modest', iv: 22, hpRatio: 1 },
  { species: 'pidgeotto', level: 26, nature: 'jolly', iv: 18, hpRatio: 0.25 },
  { species: 'pikachu', level: 25, nature: 'timid', iv: 25, hpRatio: 1 },
  { species: 'diglett', level: 24, nature: 'adamant', iv: 15, hpRatio: 1 },
];

function mon(d: DemoMon, i: number): SavedPokemon {
  const sp = lookup.species(d.species);
  const b = sp.baseStats;
  const ev = 40;
  const hp = gen3Hp(b.hp, d.level, d.iv, ev);
  const nat = NATURES.indexOf(d.nature);
  const moves = wildMoveset(sp, d.level).map((k) => lookup.move(k));
  const table = rules.expTables[sp.growthRate ?? 'medium_fast'];
  return {
    // Gen III: natureza = personalidade % 25.
    personality: nat + 25 * (1000 + i),
    otId: 0,
    nickname: '',
    speciesId: sp.id,
    level: d.level,
    hp: { current: Math.max(1, Math.round(hp * d.hpRatio)), max: hp },
    stats: {
      atk: gen3Stat(b.atk, d.level, d.iv, ev, d.nature, 'atk'),
      def: gen3Stat(b.def, d.level, d.iv, ev, d.nature, 'def'),
      spa: gen3Stat(b.spa, d.level, d.iv, ev, d.nature, 'spa'),
      spd: gen3Stat(b.spd, d.level, d.iv, ev, d.nature, 'spd'),
      spe: gen3Stat(b.spe, d.level, d.iv, ev, d.nature, 'spe'),
    },
    moves: moves.map((m) => ({ moveId: m.id, pp: m.pp ?? 10 })),
    heldItemId: null,
    nature: d.nature,
    abilitySlot: 0,
    ivs: { hp: d.iv, atk: d.iv, def: d.iv, spe: d.iv, spa: d.iv, spd: d.iv },
    evs: { hp: ev, atk: ev, def: ev, spe: ev, spa: ev, spd: ev },
    status: null,
    friendship: 120,
    experience: (table?.[d.level] ?? 0) + 150,
    isEgg: false,
    checksumValid: true,
  };
}

/** Flags do progresso da demo: inicial, Pokédex, S.S. Ticket, HM01 e as três primeiras insígnias. */
const DEMO_FLAGS = [0x828, 0x829, 0x234, 0x237, 0x820, 0x821, 0x822];

function flagsHex(flags: number[]): string {
  const bytes = new Uint8Array(0x900 / 8);
  for (const f of flags) bytes[f >> 3]! |= 1 << (f & 7);
  return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function demoSave(): StoredSave {
  const route10 = maps.find((m) => m.key === 'Route10')!;
  const preview: SaveImportPreview = {
    parserVersion: 'demo',
    slots: [
      { valid: true, counter: 1, problems: [] },
      { valid: false, counter: null, problems: [] },
    ],
    saveCounter: 1,
    trainer: { name: 'DEMO', gender: 'M', publicId: 0, secretId: 0 },
    gameFingerprint: 'demo',
    playTime: { hours: 9, minutes: 41, seconds: 0 },
    location: { mapGroup: route10.group, mapNum: route10.num, x: 13, y: 21 },
    money: 8420,
    badges: ['boulder', 'cascade', 'thunder'],
    pokedex: { owned: 21, seen: 38 },
    defeatedTrainerIds: ['leader_brock', 'leader_misty', 'leader_lt_surge'].map((k) => trainers.find((t) => t.key === k)!.id),
    flagsHex: flagsHex(DEMO_FLAGS),
    // Sem variáveis de script: o guia trata o que depende delas como desconhecido e pergunta.
    varsHex: '',
    party: TEAM.map(mon),
    bag: {
      items: [stack('potion', 5), stack('super_potion', 2), stack('antidote', 2), stack('awakening'), stack('escape_rope'), stack('repel', 3)],
      keyItems: [stack('bicycle'), stack('ss_ticket'), stack('old_rod')],
      pokeBalls: [stack('poke_ball', 8), stack('great_ball', 3)],
      tmhm: [stack('hm01'), stack('tm03'), stack('tm28'), stack('tm34'), stack('tm39')],
      berries: [],
      pc: [],
    },
    warnings: [],
  };
  const now = new Date().toISOString();
  return { preview, importedAt: now, savedAt: now, fileName: 'demonstração', demo: true };
}
