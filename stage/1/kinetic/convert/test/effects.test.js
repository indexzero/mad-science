import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DIRECTION, collectBuilds, transitionOf, buildFromEffect, positionDelta, effectLeaves } from '../effects.js';

const here = dirname(fileURLToPath(import.meta.url));
const SLIDE_4 = '88910011-5393-44BA-A490-715036B75B22';
const SLIDE_1 = 'C1F6FE7C-13D3-4213-B5B2-00EBC914A8EB';
const load = (uuid) => JSON.parse(readFileSync(join(here, 'fixtures', 'kpf', 'assets', uuid, `${uuid}.json`), 'utf8'));
const targetsOf = (effect, leaves) => leaves.map((l) => l.texture).filter(Boolean);

test('slide 4: ten automatic move-ins in step 1 chained by nesting, then a dissolve and two move-ins in step 2', () => {
  const r = collectBuilds(load(SLIDE_4), targetsOf);
  assert.equal(r.steps, 2);
  assert.deepEqual(r.unknown, {});
  assert.deepEqual(r.skipped, []);
  const s1 = r.builds.filter((b) => b.step === 1);
  const s2 = r.builds.filter((b) => b.step === 2);
  assert.equal(s1.length, 10);
  assert.equal(s2.length, 3);
  assert.ok(s1.every((b) => b.effect === 'move-in' && b.unit === 'object' && b.automatic === true && b.duration === 0.25));
  assert.deepEqual(s1.map((b) => b.begin), [0, 0, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.75, 0.75]);
  assert.deepEqual(s1.map((b) => b.direction), ['down', 'down', 'left', 'left', 'left', 'up', 'up', 'up', 'right', 'right']);
  assert.ok(s2.every((b) => b.automatic === false && b.begin === 0 && b.duration === 0.5));
  assert.deepEqual(s2.map((b) => [b.effect, b.unit, b.direction]), [['dissolve', 'character', null], ['move-in', 'object', 'up'], ['move-in', 'object', 'down']]);
  // every move-in's direction code agrees with its keyframes
  assert.equal(r.directionChecks.length, 12);
  assert.ok(r.directionChecks.every((c) => c.check === 'agree'), JSON.stringify(r.directionChecks));
  // the F2BC9C96 picture (223x270) travels exactly its height
  const f2 = s1.find((b) => b.targets[0].startsWith('F2BC9C96'));
  assert.equal(f2.distance, 270);
  assert.equal(f2.direction, 'up');
  // one target per build, the texture asset id
  assert.ok(r.builds.every((b) => b.targets.length === 1 && /^[0-9A-F]{32}$/.test(b.targets[0])));
  assert.deepEqual(r.builds[0].kpf, { name: 'apple:move in', attributes: { direction: 13 }, objectID: '0A05104B-3FA3-41B4-AD96-C9CCB2B87C62' });
});

test('slide 4 transition is a push to the left for 0.5 s; slide 1 too', () => {
  assert.deepEqual(transitionOf(load(SLIDE_4)), { kind: 'push', direction: 'left', duration: 0.5 });
  assert.deepEqual(transitionOf(load(SLIDE_1)), { kind: 'push', direction: 'left', duration: 0.5 });
  assert.deepEqual(DIRECTION, { 11: 'right', 12: 'left', 13: 'down', 14: 'up' });
});

test('slide 1 has no builds', () => {
  const r = collectBuilds(load(SLIDE_1), targetsOf);
  assert.equal(r.steps, 0);
  assert.deepEqual(r.builds, []);
});

test('an unknown name maps to appear and is counted; a unit override applies', () => {
  const effect = { type: 'buildIn', name: 'apple:wipe', attributes: { direction: 11 }, duration: 1, baseLayer: { layers: [] } };
  const { build, unknown, directionCheck } = buildFromEffect(effect, { step: 3, begin: 1.5, automatic: false, targets: ['X'] });
  assert.equal(unknown, 'apple:wipe');
  assert.equal(directionCheck, null);
  assert.deepEqual(build, { step: 3, effect: 'appear', unit: 'object', direction: null, duration: 1, begin: 1.5, automatic: false, targets: ['X'], kpf: { name: 'apple:wipe', attributes: { direction: 11 }, objectID: null } });
  const slide = { events: [{ automaticPlay: false, effects: [effect] }] };
  const r = collectBuilds(slide, () => ['X'], { unitOf: () => 'word' });
  assert.equal(r.builds[0].unit, 'word');
  assert.deepEqual(r.unknown, { 'apple:wipe': 1 });
});

test('a move-in whose code disagrees with its keyframes is reported', () => {
  const leaf = { texturedRectangle: {}, texture: 'T', animations: [{ animations: [{ property: 'position', from: { pointX: 100, pointY: 0 }, to: { pointX: 0, pointY: 0 } }] }] };
  const effect = { type: 'buildIn', name: 'apple:move in', attributes: { direction: 11 }, duration: 0.5, baseLayer: { layers: [leaf] } };
  assert.deepEqual(positionDelta(leaf), { dx: 100, dy: 0 });
  assert.equal(effectLeaves(effect).length, 1);
  const { build, directionCheck } = buildFromEffect(effect, { step: 1, begin: 0, automatic: true, targets: ['T'] });
  assert.equal(directionCheck, 'disagree');
  assert.equal(build.direction, 'right');
  assert.equal(build.distance, 100);
});
