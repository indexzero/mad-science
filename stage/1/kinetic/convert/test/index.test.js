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
