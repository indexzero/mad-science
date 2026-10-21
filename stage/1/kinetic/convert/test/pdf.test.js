import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSvg, glyphDefs, withAdvances, wordsFromUses, parseMatrix, pathBox, mixedLayers } from '../pdf.js';

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
import { transformPath, pageToElements, classifyPage, contentClass } from '../pdf.js';
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
  assert.equal(el.paths.length, 12);
  assert.equal(el.paths[0].fill, '#000000');
  assert.ok(el.paths.some((s) => s.fill === '#fefc41'));
  assert.ok(el.paths.some((s) => s.stroke === '#ecedee' && s.strokeWidth === 6 && s.fill === null));
  assert.deepEqual(el.images, []);
});

test('a page with images and no placements is a picture; body paths only is a shape with paths', () => {
  const img = { id: 'image_1', width: 10, height: 5, matrix: [1, 0, 0, 1, 2, 3] };
  const pic = pageToElements({ width: 10, height: 10, uses: [], imageUses: [], images: [img], bodyPaths: [], defs: new Map() }, fullSlideLeaf);
  assert.equal(pic.kind, 'picture');
  assert.equal(pic.images.length, 1);
  assert.deepEqual(pic.images[0].box, { x: 384, y: 324, w: 1920, h: 540 });
  const shape = pageToElements({ width: 10, height: 10, uses: [], imageUses: [], images: [], bodyPaths: [{ d: 'M0 0H10V10Z', fill: '#1b1b1b', matrix: null }], defs: new Map() }, fullSlideLeaf);
  assert.deepEqual(shape, { kind: 'shape', paths: [{ order: 0, d: 'M0 0L1920 0L1920 1080Z', fill: '#1b1b1b' }] });
  assert.equal(pic.images[0].order, 0, 'a synthetic image without an order sorts first');
});

test('page order: body paths, glyph placements, and images carry their document order', () => {
  const p = parseSvg(svg);
  const orders = [...p.bodyPaths.map((b) => b.order), ...p.uses.map((u) => u.order)];
  assert.equal(new Set(orders).size, orders.length, 'orders are distinct');
  assert.ok(p.bodyPaths.some((b) => b.order > p.uses[0].order), 'slide 1 draws rules after its first glyph');
  const el = pageToElements(p, fullSlideLeaf);
  assert.ok(el.paths.every((s) => typeof s.order === 'number'));
});

test('slide 12 texture C4BF6FDE page 6: a <use href="#image_7"> is an image placement, never a word (D-008 F-01)', () => {
  const p = parseSvg(readFileSync(join(here, 'fixtures', 'slide12-p6.svg'), 'utf8'));
  assert.equal(p.width, 1373);
  assert.equal(p.height, 343);
  assert.equal(p.uses.length, 0, 'zero glyph placements');
  assert.equal(p.imageUses.length, 1, 'one image use');
  assert.equal(p.imageUses[0].href, 'image_7');
  assert.deepEqual(p.imageUses[0].matrix, [1, 0, 0, 1, 290.6953, 25.19226], 'the group transform places the use');
  assert.equal(p.images.length, 2, 'two body images; the mask source in defs is not one');
  assert.equal(p.imageDefs.size, 1);
  assert.equal(p.images[0].id, 'image_4');
  assert.deepEqual(p.images[0].matrix, [1.4270834, 0, 0, -1.4285715, 1.843018, 341.8078]);
  assert.equal(p.images[1].id, 'image_7');
  withAdvances(p);
  assert.deepEqual(wordsFromUses(p.uses), [], 'zero words');
  assert.equal(contentClass(p), 'picture');
  assert.equal(classifyPage(p, { textureType: 5, isBackgroundTexture: true, width: 1373, height: 343 }), 'picture');
  const leaf = { matrix: [1, 0, 0, 1, 100, 200], width: 1373, height: 343, contentsRect: { x: 0, y: 0, width: 1, height: 1 }, box: { x: 100, y: 200, w: 1373, h: 343 } };
  const el = pageToElements(p, leaf);
  assert.equal(el.kind, 'picture');
  assert.equal(el.images.length, 3);
  assert.deepEqual(el.images[2].box, { x: 390.695, y: 225.192, w: 767, h: 286 });
  assert.equal(el.images[0].box.w.toFixed(0), '1370');
});

test('classifyPage orders poster, background, composite ahead of the content classes', () => {
  const blank = { uses: [], imageUses: [], images: [], bodyPaths: [{ d: 'M0 0Z' }] };
  assert.equal(classifyPage(blank, { isPoster: true }), 'poster');
  assert.equal(classifyPage(blank, { textureType: 1, isBackgroundTexture: true }), 'background');
  assert.equal(classifyPage(blank, { textureType: 0, isBackgroundTexture: false, width: 1920, height: 1080 }), 'composite');
  assert.equal(classifyPage(blank, { textureType: 5 }), 'shape');
  assert.equal(classifyPage({ ...blank, uses: [{}], images: [{}] }, { textureType: 5 }), 'mixed');
  assert.equal(classifyPage({ ...blank, uses: [{}] }, { textureType: 6 }), 'text');
  assert.equal(classifyPage({ uses: [], imageUses: [], images: [], bodyPaths: [] }, { textureType: 5 }), 'empty');
});

// ---------- checkpoint 3 ----------
test('a <g opacity> multiplies into the fill opacity of body paths and the opacity of images; a <use> in <defs> is no placement', () => {
  const svgText = `<svg width="100" height="50"><defs><mask id="m"><g transform="matrix(1,0,0,1,0,0)"><image id="image_1" width="10" height="10" xlink:href="data:x"/><use xlink:href="#image_1" x="0" y="0" width="10" height="10"/></g></mask></defs>
<g><g opacity=".1"><path d="M0 0L10 0L10 10Z" fill="#1fffa5"/><path d="M0 0L10 0L10 10Z" fill="#1fffa5" fill-opacity=".5"/></g>
<g opacity=".5"><g opacity=".4"><image id="image_2" width="10" height="10" xlink:href="data:x"/></g></g>
<path d="M0 0L10 0L10 10Z" fill="#ffffff"/><use xlink:href="#image_2" x="0" y="0" width="10" height="10"/></g></svg>`;
  const p = parseSvg(svgText);
  assert.deepEqual(p.bodyPaths.map((b) => b.fillOpacity), [0.1, 0.05, null]);
  assert.equal(p.images.length, 1);
  assert.ok(Math.abs(p.images[0].opacity - 0.2) < 1e-9);
  assert.equal(p.imageUses.length, 1, 'the mask use is skipped, the body use counts');
  assert.equal(p.imageUses[0].opacity, 1);
  assert.deepEqual([...p.bodyPaths, ...p.images, ...p.imageUses].map((x) => x.order).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  const el = pageToElements(p, fullSlideLeaf);
  assert.equal(el.kind, 'picture');
  assert.deepEqual(el.images.map((i) => [i.order, i.opacity]), [[2, 0.2], [4, 1]]);
  assert.deepEqual(el.paths.map((s) => [s.order, s.opacity]), [[0, 0.1], [1, 0.05], [3, undefined]]);
});

test('a mixed page painted path, image, path keeps that order: the first path under the image, the second over it (D-019 F-01)', () => {
  const svgText = `<svg width="1920" height="1080"><defs><path id="font_1_1" d="M0 0L1 0L1 1Z"/></defs>
<path d="M0 0L100 0L100 100Z" fill="#ff0000"/>
<image id="image_1" width="10" height="10" transform="matrix(10,0,0,10,0,0)" xlink:href="data:x"/>
<path d="M0 0L50 0L50 50Z" fill="#00ff00"/>
<use data-text="A" xlink:href="#font_1_1" transform="matrix(20,0,0,-20,10,40)" fill="#ffffff"/></svg>`;
  const p = parseSvg(svgText);
  const el = pageToElements(p, fullSlideLeaf);
  assert.equal(el.kind, 'mixed');
  const layers = mixedLayers(el.paths, el.images);
  assert.deepEqual(layers.map((x) => x.kind), ['paths', 'image', 'text']);
  assert.deepEqual(layers[0].paths.map((s) => s.fill), ['#ff0000'], 'the red path stays under the image');
  assert.deepEqual(layers[2].paths.map((s) => s.fill), ['#00ff00'], 'the green path stays over the image, on the text element');
  // two images with a path between them, and no path after the last image
  const two = mixedLayers([{ order: 0, d: 'a' }, { order: 2, d: 'b' }], [{ order: 1 }, { order: 3 }]);
  assert.deepEqual(two.map((x) => x.kind + (x.index ?? '')), ['paths', 'image0', 'paths', 'image1', 'text']);
  assert.deepEqual(two[4].paths, []);
});
