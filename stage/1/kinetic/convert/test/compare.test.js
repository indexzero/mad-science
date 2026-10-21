// The capture comparison's mask arithmetic (e2e/compare.js): overlapping video boxes count once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskedPixels, videoMasks } from '../../e2e/compare.js';

test('maskedPixels counts the union of the boxes, not the sum of their areas', () => {
  assert.equal(maskedPixels([], 10, 10), 0);
  assert.equal(maskedPixels([{ x: 0, y: 0, w: 4, h: 4 }], 10, 10), 16);
  // two 4x4 boxes overlapping in a 2x2 square: 16 + 16 - 4
  assert.equal(maskedPixels([{ x: 0, y: 0, w: 4, h: 4 }, { x: 2, y: 2, w: 4, h: 4 }], 10, 10), 28);
  // a box inside another adds nothing; the same box twice counts once
  assert.equal(maskedPixels([{ x: 0, y: 0, w: 6, h: 6 }, { x: 1, y: 1, w: 2, h: 2 }, { x: 0, y: 0, w: 6, h: 6 }], 10, 10), 36);
  // boxes are clamped to the frame
  assert.equal(maskedPixels([{ x: -5, y: -5, w: 20, h: 20 }], 10, 10), 100);
});

test('slide 64: its five video boxes overlap; the masked count never exceeds the frame', () => {
  const masks = videoMasks(64, 960, 540);
  const sum = masks.reduce((n, m) => n + m.w * m.h, 0);
  const union = maskedPixels(masks, 960, 540);
  assert.ok(masks.length >= 2);
  assert.ok(sum > 960 * 540, `the sum of the box areas (${sum}) exceeds the frame, which is the defect`);
  assert.ok(union <= 960 * 540);
  assert.ok(union < sum);
});
