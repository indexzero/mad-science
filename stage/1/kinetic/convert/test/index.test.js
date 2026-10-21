import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleImage, placementFields } from '../index.js';

test('visibleImage keeps a whole image and crops a masked one to the page clip', () => {
  const whole = visibleImage({ x: 10, y: 20, w: 100, h: 50 }, { x: 0, y: 0, w: 1920, h: 1080 }, 200, 100);
  assert.deepEqual(whole, { box: { x: 10, y: 20, w: 100, h: 50 }, crop: null });
  // slide 4 F2BC9C96: a 652x435 image at (97, 767) clipped by a 223x270 page at (461, 812)
  const r = visibleImage({ x: 96.973, y: 766.686, w: 651.9, h: 434.643 }, { x: 461, y: 812, w: 223, h: 270 }, 652, 435);
  assert.deepEqual(r.box, { x: 461, y: 812, w: 223, h: 270 });
  assert.ok(Math.abs(r.crop.x - 364.08) < 0.01 && Math.abs(r.crop.y - 45.35) < 0.01, JSON.stringify(r.crop));
  assert.ok(Math.abs(r.crop.w - 223.03) < 0.01 && Math.abs(r.crop.h - 270.22) < 0.01, JSON.stringify(r.crop));
});

test('placementFields mirrors the crop of a flipped image and marks it', () => {
  assert.deepEqual(placementFields({ flipY: false }, null, 100), {});
  assert.deepEqual(placementFields({ flipY: false }, { x: 1, y: 2, w: 3, h: 4 }, 100), { crop: { x: 1, y: 2, w: 3, h: 4 } });
  assert.deepEqual(placementFields({ flipY: true }, null, 100), { flip: 'vertical' });
  assert.deepEqual(placementFields({ flipY: true }, { x: 1, y: 10, w: 3, h: 20 }, 100), { flip: 'vertical', crop: { x: 1, y: 70, w: 3, h: 20 } });
});

// D-019 F-01 / D-020 CP3-F1: the committed deck keeps the paint order of its mixed pages
import { readFileSync } from 'node:fs';
const deck = JSON.parse(readFileSync(new URL('../../decks/_all_docs/deck.json', import.meta.url), 'utf8'));
const order = (n) => deck.slides.find((s) => s.index === n).elements.map((e) => e.id);

test('deck.json: the paths a mixed page paints before an image draw under it (slides 29, 44, 60)', () => {
  const before = (n, a, b) => {
    const ids = order(n);
    assert.ok(ids.indexOf(a) >= 0 && ids.indexOf(b) >= 0, `slide ${n}: ${a} and ${b} exist`);
    assert.ok(ids.indexOf(a) < ids.indexOf(b), `slide ${n}: ${a} draws before ${b}`);
  };
  // slide 60: the red label box, then the 75 percent black image over it
  before(60, '21F5A116BF12ECB30EDCEE9F704977C7-p0', '21F5A116BF12ECB30EDCEE9F704977C7-0');
  // slide 44: the full-page fill, then the emoji (seven; two more lie wholly outside their clip, D-019 F-03)
  for (let k = 0; k < 7; k++) before(44, '7884D393B610F57E5A5FD9CF5A6CECB3-p0', `7884D393B610F57E5A5FD9CF5A6CECB3-${k}`);
  // slide 29: the page fill, then the emoji
  before(29, 'D4FCEF10B3ABC5E7672071C6A63BC5C2-p0', 'D4FCEF10B3ABC5E7672071C6A63BC5C2-0');
  // the text element keeps only the paths after its last image: none on slide 60's label
  assert.equal(deck.slides.find((s) => s.index === 60).elements.find((e) => e.id === '21F5A116BF12ECB30EDCEE9F704977C7').paths, undefined);
});

test('deck.json: the text that the page clips away is gone (slides 44 and 62, D-019 F-03)', () => {
  const text = (n) => deck.slides.find((s) => s.index === n).elements.filter((e) => e.kind === 'text').flatMap((e) => e.words.map((w) => w.text)).join(' ');
  assert.ok(!/Result:/.test(text(62)), 'slide 62 draws no "Result: 3 packages depend on express"');
  assert.ok(!/blog-api\s+-/.test(text(62)), 'slide 62 draws none of the three result bullets');
  assert.equal((text(44).match(/Time-Space/g) || []).length, 1, 'slide 44 draws "4. Add Time-Space" once (the bottom left copy is clipped away)');
  assert.equal((text(44).match(/Create/g) || []).length, 3, 'slide 44 draws "3. Create PKV-KV" once (the top right copy is clipped away)');
  // the page paints a black box over the clipped edge of the Result block after its last glyph: it draws over the text
  const ids = order(62);
  assert.equal(ids.indexOf('2DFD34E8A1F8767F5E26FBB538188249-fg'), ids.indexOf('2DFD34E8A1F8767F5E26FBB538188249') + 1);
});
