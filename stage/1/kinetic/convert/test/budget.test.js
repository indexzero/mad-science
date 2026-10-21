// The committed media tree against the design's budget: 200 MB in total, 20 MB per file (decimal MB, as the
// design's Media section counts). Every file under media/ is referenced by deck.json and every referenced
// file exists, so a stale output cannot hide in the budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { referencedMedia } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const deckDir = join(here, '..', '..', 'decks', '_all_docs');
export const TOTAL_BUDGET = 200_000_000;
export const FILE_BUDGET = 20_000_000;

function files(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

test('media/ is under 200 MB in total and 20 MB per file', () => {
  const list = files(join(deckDir, 'media')).map((f) => ({ file: relative(deckDir, f), bytes: statSync(f).size }));
  const total = list.reduce((n, f) => n + f.bytes, 0);
  const largest = list.reduce((m, f) => (f.bytes > m.bytes ? f : m), { file: null, bytes: 0 });
  assert.ok(list.length > 0);
  assert.ok(total <= TOTAL_BUDGET, `media/ is ${total} bytes, over ${TOTAL_BUDGET}`);
  assert.ok(largest.bytes <= FILE_BUDGET, `${largest.file} is ${largest.bytes} bytes, over ${FILE_BUDGET}`);
});

test('every media file is referenced by deck.json and every referenced file exists', () => {
  const deck = JSON.parse(readFileSync(join(deckDir, 'deck.json'), 'utf8'));
  const referenced = referencedMedia(deck);
  const onDisk = new Set(files(join(deckDir, 'media')).map((f) => relative(deckDir, f).split('\\').join('/')));
  const stale = [...onDisk].filter((f) => !referenced.has(f));
  const missing = [...referenced].filter((f) => !onDisk.has(f));
  assert.deepEqual(stale, [], 'files under media/ that no element references');
  assert.deepEqual(missing, [], 'referenced files absent from media/');
  for (const f of referenced) assert.ok(!/\.(ttf|otf|woff2?|cff|gif)$/i.test(f), f);
});
