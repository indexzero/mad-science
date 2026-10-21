import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadHeader, loadSlide, slidePath, assetPath, isUrl, eachSlide, baseHash, cachePathFor } from '../kpf.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, 'fixtures', 'kpf');
const SLIDE_1 = 'C1F6FE7C-13D3-4213-B5B2-00EBC914A8EB';
const SLIDE_4 = '88910011-5393-44BA-A490-715036B75B22';

test('paths follow the KPF layout main.js uses', () => {
  assert.equal(slidePath(SLIDE_1), `assets/${SLIDE_1}/${SLIDE_1}.json`);
  assert.equal(assetPath(SLIDE_1, `assets/${SLIDE_1}.pdf`), `assets/${SLIDE_1}/assets/${SLIDE_1}.pdf`);
  assert.equal(assetPath(SLIDE_1, 'x.gif'), `assets/${SLIDE_1}/assets/x.gif`);
  assert.equal(isUrl('https://all-docs.talks.charlie.dev/'), true);
  assert.equal(isUrl(base), false);
});

test('loadHeader reads header.json from a directory base', async () => {
  const h = await loadHeader(base);
  assert.equal(h.slideCount, 71);
  assert.equal(h.slideList.length, 71);
  assert.equal(h.slideWidth, 1920);
  assert.equal(h.slideHeight, 1080);
  assert.equal(h.fonts.length, 43);
  assert.equal(h.slideList[0], SLIDE_1);
  assert.equal(h.slideList[3], SLIDE_4);
});

test('loadSlide reads a slide JSON with assets and events', async () => {
  const s1 = await loadSlide(base, SLIDE_1);
  assert.deepEqual(Object.keys(s1).sort(), ['assets', 'events']);
  assert.equal(Object.keys(s1.assets).length, 2);
  assert.equal(s1.events.length, 1);
  const s4 = await loadSlide(base, SLIDE_4);
  assert.equal(Object.values(s4.assets).filter((a) => a.type === 'texture').length, 17);
});

test('eachSlide yields in header order and stops at a missing fixture', async () => {
  const seen = [];
  try {
    for await (const [i, uuid] of eachSlide(base)) seen.push([i, uuid]);
  } catch (e) {
    assert.match(e.code || '', /ENOENT/);
  }
  assert.deepEqual(seen[0], [1, SLIDE_1]);
});

test('the cache key includes a sha256-12 of the base, so two exports never share an entry (D-009)', () => {
  const a = 'https://a.example/deck/';
  const b = 'https://b.example/deck/';
  assert.match(baseHash(a), /^[0-9a-f]{12}$/);
  assert.notEqual(baseHash(a), baseHash(b));
  assert.equal(baseHash('https://all-docs.talks.charlie.dev/'), 'f169a0095e53');
  const pa = cachePathFor(a, 'assets/header.json', '/cache');
  const pb = cachePathFor(b, 'assets/header.json', '/cache');
  assert.notEqual(pa, pb);
  assert.equal(pa, join('/cache', baseHash(a), 'assets', 'header.json'));
  assert.ok(pa.startsWith('/cache/'));
});
