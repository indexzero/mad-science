// Build components/guest.wasm from guest/guest.wat + guest/guest.wit.
// Uses the wasm-tools build that ships inside @bytecodealliance/jco-transpile,
// so no Rust toolchain, cargo-component or wasm-tools binary is needed.
// The output is byte-for-byte reproducible: run it twice and compare.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  parse,
  componentEmbed,
  componentNew,
  componentWit,
} from '@bytecodealliance/jco-transpile/wasm-tools';

const root = new URL('../', import.meta.url);
const wat = await readFile(new URL('guest/guest.wat', root), 'utf8');
const wit = await readFile(new URL('guest/guest.wit', root), 'utf8');

const core = await parse(wat);
const embedded = await componentEmbed({
  binary: core,
  witSource: wit,
  world: 'guest',
  stringEncoding: 'utf8',
});
const component = await componentNew(embedded);

const out = new URL('components/guest.wasm', root);
await writeFile(out, component);

const sha = createHash('sha256').update(component).digest('hex');
console.log(`components/guest.wasm  ${component.byteLength} bytes  sha256 ${sha}`);
console.log((await componentWit(component)).trim());
