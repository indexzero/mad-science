import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSlide } from '../kpf.js';
import { censusSlide, censusDeck, renderMarkdown } from '../census.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, 'fixtures', 'kpf');
const SLIDE_1 = 'C1F6FE7C-13D3-4213-B5B2-00EBC914A8EB';
const SLIDE_4 = '88910011-5393-44BA-A490-715036B75B22';

test('slide 1: two textures, one scene, push direction 12, no builds', async () => {
  const c = censusSlide(1, SLIDE_1, await loadSlide(base, SLIDE_1));
  assert.equal(c.scenes, 1);
  assert.equal(c.textures, 2);
  assert.equal(c.videos, 0);
  assert.deepEqual(c.transition, { name: 'apple:push', direction: 12, duration: 0.5 });
  assert.deepEqual(c.topLevelBuildNames, []);
  assert.deepEqual(c.assets.map((a) => `${a.width}x${a.height}`), ['1920x1080', '1920x1080']);
  assert.deepEqual(c.assets.map((a) => a.index).sort(), [0, 1]);
});

test('slide 4: 17 textures, four move-in builds and one dissolve character (design Background)', async () => {
  const c = censusSlide(4, SLIDE_4, await loadSlide(base, SLIDE_4));
  assert.equal(c.scenes, 3);
  assert.equal(c.textures, 17);
  assert.equal(c.videos, 0);
  assert.equal(c.transition.name, 'apple:push');
  assert.equal(c.transition.direction, 12);
  const names = c.topLevelBuildNames.slice().sort();
  assert.deepEqual(names, ['apple:dissolve character', 'apple:move in', 'apple:move in', 'apple:move in', 'apple:move in']);
  assert.equal(c.topLevel.buildIn['apple:move in'], 4);
  assert.equal(c.topLevel.buildIn['apple:dissolve character'], 1);
  // the recursive population counts the per-word detail too
  assert.ok(c.recursive['apple:move in'] > 4, JSON.stringify(c.recursive));
  assert.equal(c.recursive['apple:push'], 1);
});

test('censusDeck sums the two slides and renders every section', async () => {
  const per = [censusSlide(1, SLIDE_1, await loadSlide(base, SLIDE_1)), censusSlide(4, SLIDE_4, await loadSlide(base, SLIDE_4))];
  const deck = censusDeck(per);
  assert.equal(deck.slides, 2);
  assert.equal(deck.scenes, 4);
  assert.equal(deck.assets.textures, 19);
  assert.equal(deck.assets.videos, 0);
  assert.equal(deck.assets.extensions.pdf, 19);
  assert.equal(deck.effects.topLevel.transition['apple:push'], 2);
  assert.equal(deck.effects.pushDirections['12'], 2);
  assert.equal(deck.video.placements, 0);
  const md = renderMarkdown(deck);
  for (const h of ['### Per-slide layout', '### Asset census', '### Effect census, top-level', '### Effect census, recursive', '### Push `attributes.direction`', '### `textureType`', '### Layer state', '### Video census']) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.ok(md.includes('| 4 | `88910011` | 3 | 17 | 0 | `apple:push` | 12 |'));
});
