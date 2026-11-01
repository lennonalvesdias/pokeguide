// Gera um save FRLG sintético e válido (sem dados pessoais) para testes.
const SECTION = 0x1000;
const SIZES: Record<number, number> = { 0: 0xf2c, 1: 0xf80, 2: 0xf80, 3: 0xf80, 4: 0xf08, 13: 0x7d0 };
for (let i = 5; i <= 12; i++) SIZES[i] = 0xf80;

export function finalizeSection(save: Uint8Array, offset: number): void {
  const v = new DataView(save.buffer, save.byteOffset);
  const id = v.getUint16(offset + 0xff4, true);
  let sum = 0;
  for (let i = 0; i < SIZES[id]!; i += 4) sum = (sum + v.getUint32(offset + i, true)) >>> 0;
  v.setUint16(offset + 0xff6, ((sum >>> 16) + (sum & 0xffff)) & 0xffff, true);
}

export function syntheticSave(opts: { counterA?: number; counterB?: number; badges?: number } = {}): Uint8Array {
  const save = new Uint8Array(0x20000);
  const v = new DataView(save.buffer);
  const slots: Array<[number, number]> = [
    [0, opts.counterA ?? 1],
    [14 * SECTION, opts.counterB ?? 2],
  ];
  for (const [base, counter] of slots) {
    for (let i = 0; i < 14; i++) {
      // Seções rotacionadas, como o jogo faz.
      const id = (i + counter) % 14;
      const off = base + i * SECTION;
      v.setUint16(off + 0xff4, id, true);
      v.setUint32(off + 0xff8, 0x08012025, true);
      v.setUint32(off + 0xffc, counter, true);
      if (id === 0) {
        save.set([0xce, 0xbf, 0xcd, 0xce, 0xff], off); // "TEST"
        v.setUint16(off + 0x0a, 12345, true);
        v.setUint16(off + 0x0c, 54321, true);
        v.setUint16(off + 0x0e, 7, true);
        v.setUint32(off + 0xac, 1, true); // game code FRLG
        v.setUint32(off + 0xf20, 0, true); // chave de criptografia nula
      }
      if (id === 2 && opts.badges !== undefined) {
        // flags começam em 0xEE0 do SaveBlock1; insígnias em 0x820/8 = 0x104 → seção 2, offset 0x64.
        save[off + 0xee0 + 0x104 - 0xf80] = opts.badges;
      }
      finalizeSection(save, off);
    }
  }
  return save;
}
