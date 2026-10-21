import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiply, apply, translate, scale, rotate, layerMatrix, composeLeaves, pageMatrix, boxOf, IDENTITY } from '../layout.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

function layer(objectID, pointX, pointY, width, height, extra = {}, layers = []) {
  return {
    objectID,
    initialState: {
      position: { pointX, pointY },
      width,
      height,
      anchorPoint: { pointX: 0.5, pointY: 0.5 },
      affineTransform: [1, 0, 0, 1, 0, 0],
      scale: 1,
      rotation: 0,
      contentsRect: { x: 0, y: 0, width: 1, height: 1 },
      hidden: false,
      opacity: 1,
      ...extra,
    },
    layers,
  };
}

test('matrix algebra: multiply applies the right-hand matrix first', () => {
  const m = multiply(translate(10, 20), scale(2));
  assert.deepEqual(apply(m, 1, 1), [12, 22]);
  const r = multiply(IDENTITY, rotate(Math.PI / 2));
  const [x, y] = apply(r, 1, 0);
  near(x, 0);
  near(y, 1);
});

test('a root at (960,540) 1920x1080 with anchor 0.5 lands at the slide origin', () => {
  const m = layerMatrix(layer('root', 960, 540, 1920, 1080).initialState);
  assert.deepEqual(apply(m, 0, 0), [0, 0]);
  assert.deepEqual(boxOf(m, 1920, 1080), { x: 0, y: 0, w: 1920, h: 1080 });
});

test('slide 2: texture 1A0E3C95 at (994.8, -73.97) under a parent at (969.2, 1166.97), both 1993x1126', () => {
  // The design's test case (Deck format). Exact values from the slide JSON.
  const leaf = layer('leaf', 994.8125152587891, -73.97039794921875, 1993, 1126, { hidden: true });
  leaf.texturedRectangle = { textureType: 5, isBackgroundTexture: true };
  leaf.texture = '1A0E3C95';
  const parent = layer('98E29A47', 969.1874847412109, 1166.9703979492188, 1993, 1126, {}, [leaf]);
  const mid = layer('mid', 960, 540, 1920, 1080, {}, [parent]);
  const root = layer('root', 960, 540, 1920, 1080, {}, [mid]);
  const leaves = composeLeaves(root);
  assert.equal(leaves.length, 1);
  const l = leaves[0];
  assert.equal(l.texture, '1A0E3C95');
  assert.equal(l.hidden, true);
  near(l.box.x, -29.0);
  near(l.box.y, -33.0);
  assert.equal(l.box.w, 1993);
  assert.equal(l.box.h, 1126);
  // page coordinates map 1:1 because the page is 1993x1126 like the layer
  const pm = pageMatrix(l, 1993, 1126);
  const [sx, sy] = apply(pm, 422.9655, 710.615);
  near(sx, -29.0 + 422.9655);
  near(sy, -33.0 + 710.615);
});

test('slide 2: the GIF layer BCA9EC75 (2118x1111) is full bleed at (-99, -26)', () => {
  const leaf = layer('leaf', 1059.155, 555.724, 2118, 1111);
  leaf.texturedRectangle = { textureType: 5, isBackgroundTexture: true };
  leaf.texture = '4D000C59';
  const parent = layer('BCA9EC75', 959.845, 529.276, 2118, 1111, {}, [leaf]);
  const root = layer('root', 960, 540, 1920, 1080, {}, [layer('mid', 960, 540, 1920, 1080, {}, [parent])]);
  const [l] = composeLeaves(root);
  near(l.box.x, -99.0);
  near(l.box.y, -26.0);
  // a 450x236 page scales by 2118/450 into the box
  const pm = pageMatrix(l, 450, 236);
  near(apply(pm, 450, 236)[0], -99 + 2118);
});

test('synthetic nested case: a scaled, rotated parent and a cropped leaf with inherited hidden and opacity', () => {
  const leaf = layer('leaf', 50, 25, 100, 50, { opacity: 0.5, contentsRect: { x: 0.25, y: 0, width: 0.5, height: 1 } });
  leaf.texturedRectangle = { textureType: 5, isBackgroundTexture: false };
  leaf.texture = 'T';
  // parent: 100x50 bounds, scaled by 2, rotated a quarter turn, anchored at its center at (500, 300), hidden
  const parent = layer('p', 500, 300, 100, 50, { scale: 2, rotation: Math.PI / 2, hidden: true }, [leaf]);
  const root = layer('root', 960, 540, 1920, 1080, {}, [parent]);
  const [l] = composeLeaves(root);
  assert.equal(l.hidden, true);
  assert.equal(l.ownHidden, false);
  near(l.opacity, 0.5);
  // the leaf fills the parent's bounds; the parent's rotated, scaled bounds are 100 wide and 200 tall around (500,300)
  near(l.box.x, 450);
  near(l.box.y, 200);
  near(l.box.w, 100);
  near(l.box.h, 200);
  // contentsRect crops the middle half of a 400x100 page onto the leaf
  const pm = pageMatrix(l, 400, 100);
  const left = apply(pm, 100, 0); // page x=100 is the crop's left edge -> the leaf's (0,0)
  const leafOrigin = apply(l.matrix, 0, 0);
  near(left[0], leafOrigin[0]);
  near(left[1], leafOrigin[1]);
});
