import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateDeck, formatError, MAX_ERRORS } from '../validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

test('valid.deck.json passes the schema', () => {
  const { ok, errors } = validateDeck(load('valid.deck.json'));
  assert.equal(ok, true, errors.map(formatError).join('\n'));
});

test('invalid.deck.json fails on each rule the design lists', () => {
  const { ok, errors } = validateDeck(load('invalid.deck.json'));
  assert.equal(ok, false);
  assert.ok(errors.length >= 1 && errors.length <= MAX_ERRORS);
  const lines = errors.map(formatError);
  const has = (re) => lines.some((l) => re.test(l));
  // format is the constant kinetic/1
  assert.ok(has(/^\/format: must be equal to constant/), lines.join('\n'));
  // source.path is required on every element
  assert.ok(has(/elements\/0\/source: must have required property 'path'/), lines.join('\n'));
  // words is non-empty for a text element
  assert.ok(has(/elements\/0\/words: must NOT have fewer than 1 items/), lines.join('\n'));
  // src never ends in a font extension
  assert.ok(has(/elements\/1\/src: must match pattern/), lines.join('\n'));
  // src never ends in .gif, never holds a space
  assert.ok(has(/elements\/2\/src\/mp4: must match pattern/), lines.join('\n'));
  // a push transition names a direction
  assert.ok(has(/transition: must have required property 'direction'/), lines.join('\n'));
});

test('a text element with path texture is rejected', () => {
  const deck = load('valid.deck.json');
  deck.slides[0].elements[0].source.path = 'texture';
  const { ok } = validateDeck(deck);
  assert.equal(ok, false);
});

test('an unknown element property is rejected', () => {
  const deck = load('valid.deck.json');
  deck.slides[0].elements[1].extra = 1;
  const { ok } = validateDeck(deck);
  assert.equal(ok, false);
});

// ---------- checkpoint 2 (G3 CP1 fixes) ----------
test('a shape element with paths validates; a text element may carry paths', () => {
  const deck = load('valid.deck.json');
  const kpf = deck.slides[0].elements[0].source.kpf;
  deck.slides[0].elements.push({ id: 'S', kind: 'shape', box: { x: 0, y: 0, w: 10, h: 10 }, paths: [{ d: 'M0 0L10 0L10 10Z', fill: '#000000', opacity: 0.7 }], source: { path: 'pdf', kpf } });
  deck.slides[0].elements[0].paths = [{ d: 'M0 0L1 0', fill: null, stroke: '#ffffff', strokeWidth: 6 }];
  deck.slides[0].kpf = { snapshots: [], stills: [], compositeAsContent: true };
  const { ok, errors } = validateDeck(deck);
  assert.equal(ok, true, errors.map(formatError).join('\n'));
  deck.slides[0].elements[2].paths = [];
  assert.equal(validateDeck(deck).ok, false);
});
