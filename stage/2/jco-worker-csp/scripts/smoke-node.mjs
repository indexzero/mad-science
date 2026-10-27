// Exploratory check, no browser: transpile components/guest.wasm with jco in
// Node, import the glue, and call run(). This was the first sign that the
// hand-written canonical ABI in guest/guest.wat is right.
//   node scripts/smoke-node.mjs
import { readFile } from 'node:fs/promises';
import { $init, generate } from '@bytecodealliance/jco-transpile/component';

await $init;
const bytes = await readFile(new URL('../components/guest.wasm', import.meta.url));
const out = generate(bytes, {
  name: 'guest',
  noTypescript: true,
  noNodejsCompat: true,
  instantiation: { tag: 'async' },
  base64Cutoff: 0,
  map: []
});
for (const [name, b] of out.files) console.log(name, b.byteLength);
console.log('imports', out.imports, 'exports', out.exports);

const src = new TextDecoder().decode(out.files.find(([n]) => n === 'guest.js')[1]);
const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const cores = new Map(out.files.filter(([n]) => n.endsWith('.wasm')));
const inst = await mod.instantiate((n) => WebAssembly.compile(cores.get(n)), {
  'washe:poc/host': { log: (s) => console.log('log:', s) }
});
for (const input of ['a b c', '  hello   world\n', '']) {
  console.log(JSON.stringify(input), '->', JSON.stringify(inst.run(input)));
}
