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

// ---------- checkpoint 2 ----------
import { transformPath, pageToElements } from '../pdf.js';
import { IDENTITY } from '../layout.js';

const fullSlideLeaf = { matrix: IDENTITY, width: 1920, height: 1080, contentsRect: { x: 0, y: 0, width: 1, height: 1 }, box: { x: 0, y: 0, w: 1920, h: 1080 } };

test('transformPath maps absolute commands, implicit repeats, H and V through a matrix', () => {
  assert.equal(transformPath('M0 0L10 0 10 5Z', [2, 0, 0, 2, 1, 1]), 'M1 1L21 1L21 11Z');
  assert.equal(transformPath('M1 1H9V3Z', [1, 0, 0, -1, 0, 10]), 'M1 9L9 9L9 7Z');
  assert.equal(transformPath('M0 0 1 1', IDENTITY), 'M0 0L1 1');
  assert.equal(transformPath('M.5 .25C.1 .2 .3 .4 .5 .6 .7 .8 .9 1 1 1', [10, 0, 0, 10, 0, 0]), 'M5 2.5C1 2 3 4 5 6C7 8 9 10 10 10');
  assert.throws(() => transformPath('m1 1', IDENTITY), /relative/);
});

test('slide 1 page 1 as a full-slide leaf: 88 placements become words whose boxes lie inside the slide', () => {
  const p = parseSvg(svg);
  assert.equal(p.uses.length, 88);
  const el = pageToElements(p, fullSlideLeaf);
  assert.equal(el.kind, 'text');
  assert.deepEqual(el.box, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(el.words[0].text, 'OCTOBER');
  assert.equal(el.words[0].chars.length, 7);
  assert.equal(el.words[0].chars[0].text, 'O');
  assert.equal(el.text.startsWith('OCTOBER 16TH, 2025 JSCONF NA'), true);
  const chars = el.words.reduce((n, w) => n + w.chars.length, 0);
  const spaces = p.uses.filter((u) => u.text === ' ').length;
  assert.equal(spaces, 8);
  assert.equal(chars, 88 - spaces, 'every non-space placement becomes a glyph');
  for (const w of el.words) {
    assert.ok(w.d.startsWith('M'), w.text);
    assert.ok(w.box.x >= 0 && w.box.y >= 0 && w.box.x + w.box.w <= 1920 && w.box.y + w.box.h <= 1080, `${w.text} ${JSON.stringify(w.box)}`);
  }
  // the O of OCTOBER sits at 60 px on baseline y=904.787: its ink box is just above the baseline
  const o = el.words[0].chars[0];
  assert.ok(o.box.y > 850 && o.box.y + o.box.h <= 906, JSON.stringify(o.box));
  assert.ok(o.box.x >= 1195 && o.box.x < 1260, JSON.stringify(o.box));
  // per-glyph fills survive: the title slide mixes yellow, magenta, white and dark text
  const fills = new Set([el.fill, ...el.words.map((w) => w.fill).filter(Boolean)]);
  assert.ok(fills.size >= 3, [...fills].join(','));
  // body paths become shapes with fills, strokes, and the SVG default black
  assert.equal(el.shapes.length, 12);
  assert.equal(el.shapes[0].fill, '#000000');
  assert.ok(el.shapes.some((s) => s.fill === '#fefc41'));
  assert.ok(el.shapes.some((s) => s.stroke === '#ecedee' && s.strokeWidth === 6 && s.fill === null));
  assert.equal(el.images, 0);
});

test('a page with images and no placements is a picture; body paths only is a shape', () => {
  const pic = pageToElements({ width: 10, height: 10, uses: [], images: [{}], bodyPaths: [], defs: new Map() }, fullSlideLeaf);
  assert.deepEqual(pic, { kind: 'picture', images: 1, singleStream: true });
  const two = pageToElements({ width: 10, height: 10, uses: [], images: [{}, {}], bodyPaths: [], defs: new Map() }, fullSlideLeaf);
  assert.equal(two.singleStream, false);
  const shape = pageToElements({ width: 10, height: 10, uses: [], images: [], bodyPaths: [{ d: 'M0 0H10V10Z' }], defs: new Map() }, fullSlideLeaf);
  assert.deepEqual(shape, { kind: 'shape', bodyPaths: 1 });
});
