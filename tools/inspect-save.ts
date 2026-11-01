// Inspeciona um save de FireRed e imprime um resumo legível.
// Uso: pnpm save:inspect <arquivo.sav> [--json]
import { readFileSync } from 'node:fs';
import { lookup } from '../packages/data-firered/src/index.ts';
import { parseSave } from '../packages/save-parser/src/index.ts';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('uso: pnpm save:inspect <arquivo.sav> [--json]');
  process.exit(1);
}

const r = parseSave(readFileSync(file), { isKnownItem: lookup.isKnownItem });
if (flag === '--json') {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

const item = (id: number) => lookup.item(id)?.name ?? `#${id}`;
const pt = r.playTime;
console.log(`${r.trainer.name} · ID ${r.trainer.publicId} · ${pt.hours}h${String(pt.minutes).padStart(2, '0')}`);
console.log(`Local: ${lookup.map(r.location.mapGroup, r.location.mapNum)?.key ?? '?'} (${r.location.x}, ${r.location.y})`);
console.log(`Insígnias (${r.badges.length}): ${r.badges.join(', ') || 'nenhuma'}`);
console.log(`Dinheiro: ${r.money} · Pokédex: ${r.pokedex.owned} capturados / ${r.pokedex.seen} vistos\n`);
for (const p of r.party) {
  const sp = lookup.species(p.speciesId);
  const moves = p.moves.map((m) => `${lookup.move(m.moveId).name} (${m.pp})`).join(' / ');
  const status = p.status ? ` [${p.status}]` : '';
  console.log(`${sp.name.padEnd(10)} Nv ${p.level}  HP ${p.hp.current}/${p.hp.max}${status}\n  ${moves}`);
}
console.log(`\nBolas: ${r.bag.pokeBalls.map((b) => `${item(b.itemId)} x${b.quantity}`).join(', ')}`);
console.log(`TM/HM: ${r.bag.tmhm.map((b) => item(b.itemId)).join(', ')}`);
if (r.warnings.length) console.log(`\nAvisos:\n- ${r.warnings.join('\n- ')}`);
