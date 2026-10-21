// Validate a deck.json against schema/deck.schema.json (JSON Schema draft 2020-12).
// CLI: node convert/validate.js <deck.json> [--slides <n>]. Exits 1 with the first 20 errors on failure.
// `--slides n` adds the Done checks of check.sh: the deck has n slides and every element has `source.path`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(here, '..', 'schema', 'deck.schema.json');
export const MAX_ERRORS = 20;

let compiled = null;

/** Compile the deck schema once. Returns the ajv validate function. */
export function loadValidator() {
  if (compiled) return compiled;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  // `date-time` is the one format the schema uses. A plain RFC 3339 check keeps ajv-formats out of the tree.
  ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  compiled = ajv.compile(schema);
  return compiled;
}

/** Validate a parsed deck. Returns { ok, errors } with at most MAX_ERRORS errors. */
export function validateDeck(deck) {
  const validate = loadValidator();
  const ok = validate(deck);
  const errors = ok ? [] : validate.errors.slice(0, MAX_ERRORS);
  return { ok, errors };
}

/** Render one ajv error as a single line. */
export function formatError(e) {
  const where = e.instancePath || '/';
  const extra = e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : '';
  return `${where}: ${e.message}${extra}`;
}

/**
 * The Done checks beyond the schema: `slides` entries when `slides` is a number, and `source.path` on every
 * element. Returns a list of problems, empty when the deck passes.
 */
export function doneChecks(deck, { slides } = {}) {
  const problems = [];
  const list = Array.isArray(deck.slides) ? deck.slides : [];
  if (typeof slides === 'number' && list.length !== slides) problems.push(`expected ${slides} slides, found ${list.length}`);
  for (const s of list) {
    for (const e of s.elements || []) {
      if (!e.source || typeof e.source.path !== 'string') problems.push(`slide ${s.index} element ${e.id}: no source.path`);
    }
  }
  return problems;
}

export function main(argv) {
  const args = [...argv];
  let slides;
  const at = args.indexOf('--slides');
  if (at >= 0) {
    slides = Number(args[at + 1]);
    args.splice(at, 2);
    if (!Number.isInteger(slides)) {
      console.error('--slides needs an integer');
      return 2;
    }
  }
  const file = args[0];
  if (!file) {
    console.error('usage: node convert/validate.js <deck.json>');
    return 2;
  }
  const deck = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const { ok, errors } = validateDeck(deck);
  if (ok) {
    const problems = doneChecks(deck, { slides });
    if (problems.length) {
      console.error(`invalid: ${file}, ${problems.length} Done check(s) failed:`);
      for (const p of problems.slice(0, MAX_ERRORS)) console.error('  ' + p);
      return 1;
    }
    const elements = deck.slides.reduce((n, s) => n + s.elements.length, 0);
    console.log(`valid: ${file} (${deck.slides.length} slides${slides !== undefined ? `, ${slides} expected` : ''}; ${elements} elements, each with source.path)`);
    return 0;
  }
  console.error(`invalid: ${file}, first ${errors.length} error(s):`);
  for (const e of errors) console.error('  ' + formatError(e));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
