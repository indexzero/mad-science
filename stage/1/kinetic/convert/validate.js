// Validate a deck.json against schema/deck.schema.json (JSON Schema draft 2020-12).
// CLI: node convert/validate.js <deck.json>. Exits 1 with the first 20 errors on failure.
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

export function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error('usage: node convert/validate.js <deck.json>');
    return 2;
  }
  const deck = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const { ok, errors } = validateDeck(deck);
  if (ok) {
    console.log(`valid: ${file} (${deck.slides.length} slides)`);
    return 0;
  }
  console.error(`invalid: ${file}, first ${errors.length} error(s):`);
  for (const e of errors) console.error('  ' + formatError(e));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
