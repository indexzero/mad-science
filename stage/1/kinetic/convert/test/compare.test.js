// The capture comparison's mask arithmetic (e2e/compare.js): overlapping video boxes count once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskedPixels, videoMasks, longestLoopMs, animatedFrameCount, masksCoverFrame } from '../../e2e/compare.js';

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

test('the moving-pixel mask samples the longest video loop of the slide (slide 64, D-021)', () => {
  // slide 64: five GIFs, the longest the Earth GIF at 0.0000-5.7200 s; its boxes cover the frame
  assert.equal(longestLoopMs(64), 5720);
  assert.equal(masksCoverFrame(64), true);
  assert.equal(animatedFrameCount(64), 16); // ceil(5720 / 400) + 1
  // no video: no loop, the three-frame minimum; a slide whose boxes leave pixels uncovered
  assert.equal(longestLoopMs(1), 0);
  assert.equal(animatedFrameCount(1), 3);
  assert.equal(masksCoverFrame(1), false);
  // slide 26 has a 12 s GIF: 31 frames, under the 32-frame ceiling
  assert.equal(longestLoopMs(26), 12000);
  assert.equal(animatedFrameCount(26), 31);
  assert.equal(animatedFrameCount(26, 100), 32);
});
