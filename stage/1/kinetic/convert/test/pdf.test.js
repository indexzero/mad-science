import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSvg, glyphDefs, withAdvances, wordsFromUses, parseMatrix, pathBox } from '../pdf.js';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'fixtures', 'slide1-p1.svg'), 'utf8');

test('slide 1 page 1: 88 placements, 62 glyph defs, 12 body paths, no images (design fact 7)', () => {
  const p = parseSvg(svg);
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  assert.equal(p.uses.length, 88);
  assert.equal(glyphDefs(p).length, 62);
  assert.equal(p.defs.size, 62);
  assert.equal(p.bodyPaths.length, 12);
  assert.equal(p.images.length, 0);
  assert.equal(p.clipPaths, 16);
  assert.equal(p.groups, 16);
});

test('the first placement is the O of OCTOBER at 60 px on baseline 904.787', () => {
  const p = parseSvg(svg);
  const u = p.uses[0];
  assert.equal(u.text, 'O');
  assert.equal(u.href, 'font_4_12');
  assert.equal(u.s, 60);
  assert.equal(u.tx, 1195.484);
  assert.equal(u.ty, 904.787);
  assert.equal(u.fill, '#2f302c');
  assert.deepEqual(u.matrix, [60, 0, 0, -60, 1195.484, 904.787]);
});

test('words: the first word is OCTOBER and the run reads as the title slide', () => {
  const p = parseSvg(svg);
  withAdvances(p);
  const words = wordsFromUses(p.uses).map((w) => w.text);
  assert.equal(words[0], 'OCTOBER');
  assert.deepEqual(words.slice(0, 5), ['OCTOBER', '16TH,', '2025', 'JSCONF', 'NA']);
  assert.ok(words.includes('_all_docs'));
  assert.ok(words.includes('ROBBINS'));
});

test('parseMatrix and pathBox read mutool output', () => {
  assert.deepEqual(parseMatrix('matrix(60,0,0,-60,1195.484,904.787)'), [60, 0, 0, -60, 1195.484, 904.787]);
  assert.equal(parseMatrix('translate(1,2)'), null);
  assert.deepEqual(pathBox('M0 0L10 0L10 5L0 5Z'), { minX: 0, maxX: 10, minY: 0, maxY: 5 });
  assert.deepEqual(pathBox('M1 1H9V3Z'), { minX: 1, maxX: 9, minY: 1, maxY: 3 });
});

test('a space placement splits words and a baseline change splits words', () => {
  const uses = [
    { text: 'a', s: 10, tx: 0, ty: 100, advance: 0.5 },
    { text: 'b', s: 10, tx: 5, ty: 100, advance: 0.5 },
    { text: ' ', s: 10, tx: 10, ty: 100, advance: 0.3 },
    { text: 'c', s: 10, tx: 13, ty: 100, advance: 0.5 },
    { text: 'd', s: 10, tx: 18, ty: 120, advance: 0.5 },
    { text: 'e', s: 10, tx: 40, ty: 120, advance: 0.5 },
  ];
  assert.deepEqual(wordsFromUses(uses).map((w) => w.text), ['ab', 'c', 'd', 'e']);
});
