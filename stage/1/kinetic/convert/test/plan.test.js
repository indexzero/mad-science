import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { composeLeaves } from '../layout.js';
import { classifyPage } from '../pdf.js';
import { planLeaves } from '../plan.js';

const here = dirname(fileURLToPath(import.meta.url));
const SLIDE_1 = 'C1F6FE7C-13D3-4213-B5B2-00EBC914A8EB';
const SLIDE_4 = '88910011-5393-44BA-A490-715036B75B22';
const load = (uuid) => JSON.parse(readFileSync(join(here, 'fixtures', 'kpf', 'assets', uuid, `${uuid}.json`), 'utf8'));

// The measured placements of the spike pages (REPORT-1.md, textureType decode), as a parsed-page stub.
const PAGES = {
  // slide 1: page 0 has 88 glyphs; page 1 has one image
  DD0E5007: { uses: 88, images: 0 },
  '4A5B9259': { uses: 0, images: 1 },
  // slide 4: background, ten single-image pictures, one two-image picture, one shape, two text pages, two composites
  '5BA6FFBB': { uses: 0, images: 0, paths: 2 },
  F2BC9C96: { uses: 0, images: 1 }, DF17F393: { uses: 0, images: 1 }, '561B1BE3': { uses: 0, images: 1 }, C7F42900: { uses: 0, images: 1 },
  F92AD770: { uses: 0, images: 1 }, '6DADC276': { uses: 0, images: 1 }, '69FB267C': { uses: 0, images: 1 }, E870708A: { uses: 0, images: 1 },
  '07D462D3': { uses: 0, images: 1 }, C9856CF9: { uses: 0, images: 2 }, F3F1815A: { uses: 0, images: 1 },
  '073A0716': { uses: 0, images: 0, paths: 1 },
  DCEA9E7D: { uses: 11, images: 0, paths: 3 }, EAA9333C: { uses: 15, images: 0, paths: 5 },
  '55E6C056': { uses: 26, images: 12, paths: 11 }, '84DE19BE': { uses: 0, images: 1, paths: 3 },
};

function classify(slide, leaf) {
  const asset = slide.assets[leaf.texture];
  const p = PAGES[leaf.texture.slice(0, 8)];
  const parsed = { uses: new Array(p.uses).fill({}), imageUses: [], images: new Array(p.images).fill({}), bodyPaths: new Array(p.paths || 0).fill({}) };
  const tr = leaf.layer.texturedRectangle;
  return classifyPage(parsed, { textureType: tr.textureType, isBackgroundTexture: tr.isBackgroundTexture, isPoster: leaf.isVideoLayer, width: asset.width, height: asset.height });
}

function plan(uuid) {
  const slide = load(uuid);
  const leaves = composeLeaves(slide.events[0].baseLayer).map((l) => ({ ...l, cls: classify(slide, l) }));
  return { leaves, plan: planLeaves(leaves) };
}

test('slide 1: the textureType 0 page is the only content leaf, so the composite is the content (D-009 F1)', () => {
  const { leaves, plan: p } = plan(SLIDE_1);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].cls, 'composite');
  assert.equal(p.compositeAsContent, true);
  assert.equal(p.content.length, 1);
  assert.equal(p.content[0].texture.slice(0, 8), 'DD0E5007');
  assert.deepEqual(p.snapshots, []);
  assert.equal(p.background, null);
});

test('slide 4: the composite is not in the first event; pages 13 and 14 are text, so composites are snapshots', () => {
  const { leaves, plan: p } = plan(SLIDE_4);
  assert.equal(leaves.length, 15);
  assert.equal(p.compositeAsContent, false);
  assert.equal(p.background.texture.slice(0, 8), '5BA6FFBB');
  assert.equal(p.content.length, 14);
  assert.deepEqual(p.content.map((l) => l.cls).filter((c) => c === 'text'), ['text', 'text']);
  assert.equal(p.content.filter((l) => l.cls === 'picture').length, 11);
  assert.equal(p.content.filter((l) => l.cls === 'shape').length, 1);
  // a composite added to the same event stays a snapshot because text leaves exist
  const withComposite = [...leaves, { texture: '55E6C05616B57532339E5BE8AFA551EF', cls: 'composite' }];
  const p2 = planLeaves(withComposite);
  assert.equal(p2.compositeAsContent, false);
  assert.equal(p2.snapshots.length, 1);
  assert.equal(p2.content.length, 14);
});

test('a poster leaf is never content and an empty page is listed', () => {
  const p = planLeaves([{ texture: 'A', cls: 'poster' }, { texture: 'B', cls: 'empty' }, { texture: 'C', cls: 'composite' }]);
  assert.equal(p.posters.length, 1);
  assert.equal(p.empty.length, 1);
  assert.equal(p.compositeAsContent, true);
  assert.equal(p.content[0].texture, 'C');
});
