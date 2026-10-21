// Exploratory: check the README / page-1 paragraph against the bytes.
// Prints the preamble, the custom sections of the embedded core module,
// the WIT recovered from the component, and its canon lines.
//   node scripts/inspect-component.mjs
import { readFile } from 'node:fs/promises';
import { parse, componentEmbed, componentWit, print } from '@bytecodealliance/jco-transpile/wasm-tools';

const root = new URL('../', import.meta.url);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** Names of custom sections (id 0) in a core module or component. */
function customSections(bytes) {
  const names = [];
  let i = 8;
  const leb = () => { let r = 0, s = 0, b; do { b = bytes[i++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  while (i < bytes.length) {
    const id = bytes[i++];
    const size = leb();
    const end = i + size;
    if (id === 0) { const n = leb(); names.push(new TextDecoder().decode(bytes.subarray(i, i + n))); }
    i = end;
  }
  return names;
}

const wat = await readFile(new URL('guest/guest.wat', root), 'utf8');
const wit = await readFile(new URL('guest/guest.wit', root), 'utf8');
const core = await parse(wat);
const embedded = await componentEmbed({ binary: core, witSource: wit, world: 'guest', stringEncoding: 'utf8' });
const component = new Uint8Array(await readFile(new URL('components/guest.wasm', root)));

console.log('core preamble      ', hex(core.subarray(0, 8)));
console.log('embedded preamble  ', hex(embedded.subarray(0, 8)));
console.log('embedded customs   ', customSections(embedded));
console.log('component preamble ', hex(component.subarray(0, 8)));
console.log('component top-level customs', customSections(component));
console.log('--- componentWit ---');
console.log(await componentWit(component));
console.log('--- print: canon / custom lines ---');
const text = await print(component);
for (const line of text.split('\n')) if (/canon|@custom|component-type|core module|core instance/.test(line)) console.log(line.slice(0, 160));
