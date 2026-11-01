// Parser somente leitura de saves de FireRed/LeafGreen (ADR-007).
// Puro: sem APIs de Node ou DOM, roda em Web Worker. Nunca altera o buffer recebido.
// Offsets conferidos contra pret/pokefirered include/global.h.

export const SAVE_PARSER_VERSION = '0.2.0';

const SECTION_SIZE = 0x1000;
const SLOT_SIZE = 14 * SECTION_SIZE;
const SIGNATURE = 0x08012025;
const DATA_SIZES: Record<number, number> = { 0: 0xf2c, 1: 0xf80, 2: 0xf80, 3: 0xf80, 4: 0xf08, 13: 0x7d0 };
for (let i = 5; i <= 12; i++) DATA_SIZES[i] = 0xf80;
const VALID_SIZES = new Set([0x20000, 0x20010]);

const SUB_ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG',
] as const;
export const NATURES = [
  'hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax',
  'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash',
  'calm', 'gentle', 'sassy', 'careful', 'quirky',
] as const;
export const BADGES = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh', 'volcano', 'earth'] as const;

export type SaveErrorCode = 'invalid-size' | 'no-valid-slot' | 'unsupported-game';
export class SaveParseError extends Error {
  readonly code: SaveErrorCode;
  constructor(code: SaveErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SaveParseError';
  }
}

export interface SlotReport {
  valid: boolean;
  counter: number | null;
  problems: string[];
}

export interface SavedPokemon {
  personality: number;
  otId: number;
  nickname: string;
  speciesId: number;
  level: number;
  hp: { current: number; max: number };
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  moves: Array<{ moveId: number; pp: number }>;
  heldItemId: number | null;
  nature: (typeof NATURES)[number];
  abilitySlot: 0 | 1;
  ivs: { hp: number; atk: number; def: number; spe: number; spa: number; spd: number };
  evs: { hp: number; atk: number; def: number; spe: number; spa: number; spd: number };
  status: string | null;
  friendship: number;
  isEgg: boolean;
  checksumValid: boolean;
}

export interface ItemStack {
  itemId: number;
  quantity: number;
}

export interface SaveImportPreview {
  parserVersion: string;
  slots: [SlotReport, SlotReport];
  saveCounter: number;
  trainer: { name: string; gender: 'M' | 'F'; publicId: number; secretId: number };
  /** Trainer ID + Secret ID: identifica a campanha e detecta um novo jogo. */
  gameFingerprint: string;
  playTime: { hours: number; minutes: number; seconds: number };
  location: { mapGroup: number; mapNum: number; x: number; y: number };
  money: number;
  badges: Array<(typeof BADGES)[number]>;
  pokedex: { owned: number; seen: number };
  /** IDs dos treinadores já derrotados (flag 0x500 + id). */
  defeatedTrainerIds: number[];
  party: SavedPokemon[];
  bag: {
    items: ItemStack[];
    keyItems: ItemStack[];
    pokeBalls: ItemStack[];
    tmhm: ItemStack[];
    berries: ItemStack[];
    pc: ItemStack[];
  };
  warnings: string[];
}

export interface ParseOptions {
  /** Quando fornecido, slots de item com ID desconhecido são descartados com aviso. */
  isKnownItem?: (id: number) => boolean;
}

const CHARS: Record<number, string> = (() => {
  const m: Record<number, string> = {
    0x00: ' ', 0xab: '!', 0xac: '?', 0xad: '.', 0xae: '-', 0xb0: '…', 0xb1: '“', 0xb2: '”',
    0xb3: '‘', 0xb4: '’', 0xb5: '♂', 0xb6: '♀', 0xb8: ',', 0xba: '/',
  };
  for (let i = 0; i < 10; i++) m[0xa1 + i] = String(i);
  for (let i = 0; i < 26; i++) {
    m[0xbb + i] = String.fromCharCode(65 + i);
    m[0xd5 + i] = String.fromCharCode(97 + i);
  }
  return m;
})();

export function decodeText(bytes: Uint8Array): string {
  let out = '';
  for (const c of bytes) {
    if (c === 0xff) break;
    out += CHARS[c] ?? '?';
  }
  return out;
}

function sectionChecksum(view: DataView, offset: number, size: number): number {
  let sum = 0;
  for (let i = 0; i < size; i += 4) sum = (sum + view.getUint32(offset + i, true)) >>> 0;
  return ((sum >>> 16) + (sum & 0xffff)) & 0xffff;
}

interface Slot extends SlotReport {
  sections: Map<number, Uint8Array>;
}

function readSlot(bytes: Uint8Array, base: number): Slot {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = new Map<number, Uint8Array>();
  const problems: string[] = [];
  const counters = new Set<number>();
  for (let i = 0; i < 14; i++) {
    const off = base + i * SECTION_SIZE;
    const id = view.getUint16(off + 0xff4, true);
    const checksum = view.getUint16(off + 0xff6, true);
    const signature = view.getUint32(off + 0xff8, true);
    const counter = view.getUint32(off + 0xffc, true);
    const size = DATA_SIZES[id];
    if (signature !== SIGNATURE) {
      problems.push(`setor ${i}: assinatura inválida`);
      continue;
    }
    if (size === undefined) {
      problems.push(`setor ${i}: id de seção ${id} inválido`);
      continue;
    }
    if (sections.has(id)) {
      problems.push(`setor ${i}: seção ${id} duplicada`);
      continue;
    }
    if (sectionChecksum(view, off, size) !== checksum) {
      problems.push(`seção ${id}: checksum incorreto`);
      continue;
    }
    sections.set(id, bytes.subarray(off, off + SECTION_SIZE));
    counters.add(counter);
  }
  if (counters.size > 1) problems.push('contadores de save divergentes entre seções');
  const valid = sections.size === 14 && counters.size === 1;
  return { valid, counter: counters.size ? Math.max(...counters) : null, problems, sections };
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function statusText(st: number): string | null {
  if (st & 7) return 'sleep';
  if (st & (1 << 3)) return 'poison';
  if (st & (1 << 4)) return 'burn';
  if (st & (1 << 5)) return 'freeze';
  if (st & (1 << 6)) return 'paralysis';
  if (st & (1 << 7)) return 'toxic';
  return null;
}

function decodePokemon(raw: Uint8Array): SavedPokemon | null {
  const v = dv(raw);
  const personality = v.getUint32(0, true);
  const otId = v.getUint32(4, true);
  if (personality === 0 && otId === 0) return null;
  const key = (personality ^ otId) >>> 0;
  const dec = new Uint8Array(48);
  const dview = dv(dec);
  for (let i = 0; i < 48; i += 4) dview.setUint32(i, (v.getUint32(32 + i, true) ^ key) >>> 0, true);
  let sum = 0;
  for (let i = 0; i < 48; i += 2) sum = (sum + dview.getUint16(i, true)) & 0xffff;
  const order = SUB_ORDERS[personality % 24]!;
  const sub = (c: string) => dv(dec.subarray(order.indexOf(c) * 12, order.indexOf(c) * 12 + 12));
  const g = sub('G');
  const a = sub('A');
  const e = sub('E');
  const m = sub('M');
  const ivWord = m.getUint32(4, true);
  const iv = (i: number) => (ivWord >>> (5 * i)) & 31;
  const moves: Array<{ moveId: number; pp: number }> = [];
  for (let i = 0; i < 4; i++) {
    const moveId = a.getUint16(i * 2, true);
    if (moveId) moves.push({ moveId, pp: a.getUint8(8 + i) });
  }
  const heldItem = g.getUint16(2, true);
  return {
    personality,
    otId,
    nickname: decodeText(raw.subarray(8, 18)),
    speciesId: g.getUint16(0, true),
    level: v.getUint8(84),
    hp: { current: v.getUint16(86, true), max: v.getUint16(88, true) },
    stats: {
      atk: v.getUint16(90, true),
      def: v.getUint16(92, true),
      spe: v.getUint16(94, true),
      spa: v.getUint16(96, true),
      spd: v.getUint16(98, true),
    },
    moves,
    heldItemId: heldItem || null,
    nature: NATURES[personality % 25]!,
    abilitySlot: ((ivWord >>> 31) & 1) as 0 | 1,
    ivs: { hp: iv(0), atk: iv(1), def: iv(2), spe: iv(3), spa: iv(4), spd: iv(5) },
    evs: {
      hp: e.getUint8(0), atk: e.getUint8(1), def: e.getUint8(2),
      spe: e.getUint8(3), spa: e.getUint8(4), spd: e.getUint8(5),
    },
    status: statusText(v.getUint32(80, true)),
    friendship: g.getUint8(9),
    isEgg: ((ivWord >>> 30) & 1) === 1,
    checksumValid: sum === v.getUint16(28, true),
  };
}

export function parseSave(input: ArrayBuffer | Uint8Array, opts: ParseOptions = {}): SaveImportPreview {
  // Cópia defensiva: o parser nunca toca no buffer original.
  const bytes = new Uint8Array(input instanceof Uint8Array ? input.slice() : input.slice(0));
  if (!VALID_SIZES.has(bytes.byteLength)) {
    throw new SaveParseError('invalid-size', `tamanho inesperado: ${bytes.byteLength} bytes`);
  }
  const slotA = readSlot(bytes, 0);
  const slotB = readSlot(bytes, SLOT_SIZE);
  const valid = [slotA, slotB].filter((s) => s.valid);
  if (!valid.length) throw new SaveParseError('no-valid-slot', 'nenhum slot de save íntegro');
  const cur = valid.reduce((a, b) => ((b.counter ?? -1) > (a.counter ?? -1) ? b : a));
  const s0 = cur.sections.get(0)!;
  const v0 = dv(s0);
  if (v0.getUint32(0xac, true) !== 1) {
    throw new SaveParseError('unsupported-game', 'o save não é de FireRed/LeafGreen');
  }
  const sb1 = new Uint8Array([1, 2, 3, 4].reduce((n, i) => n + DATA_SIZES[i]!, 0));
  let o = 0;
  for (const i of [1, 2, 3, 4]) {
    sb1.set(cur.sections.get(i)!.subarray(0, DATA_SIZES[i]), o);
    o += DATA_SIZES[i]!;
  }
  const v1 = dv(sb1);
  const key = v0.getUint32(0xf20, true);
  const key16 = key & 0xffff;
  const warnings: string[] = [];

  const pocket = (offset: number, count: number, encrypted: boolean): ItemStack[] => {
    const out: ItemStack[] = [];
    for (let i = 0; i < count; i++) {
      const itemId = v1.getUint16(offset + 4 * i, true);
      const qty = v1.getUint16(offset + 4 * i + 2, true);
      if (!itemId) continue;
      if (opts.isKnownItem && !opts.isKnownItem(itemId)) {
        warnings.push(`item ignorado em 0x${(offset + 4 * i).toString(16)}: id ${itemId} inexistente`);
        continue;
      }
      out.push({ itemId, quantity: encrypted ? qty ^ key16 : qty });
    }
    return out;
  };

  const countBits = (from: number, len: number) => {
    let n = 0;
    for (let i = from; i < from + len; i++) for (let b = s0[i]!; b; b >>= 1) n += b & 1;
    return n;
  };

  const partyCount = Math.min(sb1[0x34]!, 6);
  if (sb1[0x34]! > 6) warnings.push(`contagem de party inválida: ${sb1[0x34]}`);
  const party: SavedPokemon[] = [];
  for (let i = 0; i < partyCount; i++) {
    const mon = decodePokemon(sb1.subarray(0x38 + 100 * i, 0x38 + 100 * (i + 1)));
    if (!mon) continue;
    if (!mon.checksumValid) warnings.push(`party[${i}]: checksum do Pokémon incorreto`);
    party.push(mon);
  }

  const FLAGS = 0xee0;
  const flag = (n: number) => ((sb1[FLAGS + (n >> 3)]! >> (n & 7)) & 1) === 1;
  const badgeByte = sb1[FLAGS + 0x820 / 8]!;
  // TRAINER_FLAGS_START = 0x500 .. TRAINER_FLAGS_END = 0x7FF (include/constants/flags.h).
  const defeatedTrainerIds: number[] = [];
  for (let id = 1; id <= 0x7ff - 0x500; id++) if (flag(0x500 + id)) defeatedTrainerIds.push(id);
  const publicId = v0.getUint16(0x0a, true);
  const secretId = v0.getUint16(0x0c, true);
  return {
    parserVersion: SAVE_PARSER_VERSION,
    slots: [
      { valid: slotA.valid, counter: slotA.counter, problems: slotA.problems },
      { valid: slotB.valid, counter: slotB.counter, problems: slotB.problems },
    ],
    saveCounter: cur.counter!,
    trainer: { name: decodeText(s0.subarray(0, 8)), gender: s0[8] ? 'F' : 'M', publicId, secretId },
    gameFingerprint: `${publicId.toString(16).padStart(4, '0')}${secretId.toString(16).padStart(4, '0')}`.toUpperCase(),
    playTime: { hours: v0.getUint16(0x0e, true), minutes: s0[0x10]!, seconds: s0[0x11]! },
    location: { mapGroup: v1.getInt8(4), mapNum: v1.getInt8(5), x: v1.getInt16(0, true), y: v1.getInt16(2, true) },
    money: (v1.getUint32(0x290, true) ^ key) >>> 0,
    badges: BADGES.filter((_, i) => (badgeByte >> i) & 1),
    pokedex: { owned: countBits(0x28, 52), seen: countBits(0x5c, 52) },
    defeatedTrainerIds,
    party,
    bag: {
      items: pocket(0x310, 42, true),
      keyItems: pocket(0x3b8, 30, true),
      pokeBalls: pocket(0x430, 13, true),
      tmhm: pocket(0x464, 58, true),
      berries: pocket(0x54c, 43, true),
      pc: pocket(0x298, 30, false),
    },
    warnings,
  };
}
export * from './pick.ts';
export * from './delta.ts';
