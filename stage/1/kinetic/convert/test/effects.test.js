import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DIRECTION, EFFECT_MAP, collectBuilds, transitionOf, buildFromEffect, positionDelta, effectLeaves, revealOffset } from '../effects.js';

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
  const effect = { type: 'buildIn', name: 'apple:not-in-this-deck', attributes: { direction: 11 }, duration: 1, baseLayer: { layers: [] } };
  const { build, unknown, directionCheck } = buildFromEffect(effect, { step: 3, begin: 1.5, automatic: false, targets: ['X'] });
  assert.equal(unknown, 'apple:not-in-this-deck');
  assert.equal(directionCheck, null);
  assert.deepEqual(build, { step: 3, effect: 'appear', unit: 'object', direction: null, duration: 1, begin: 1.5, automatic: false, targets: ['X'], kpf: { name: 'apple:not-in-this-deck', attributes: { direction: 11 }, objectID: null } });
  const slide = { events: [{ automaticPlay: false, effects: [effect] }] };
  const r = collectBuilds(slide, () => ['X'], { unitOf: () => 'word' });
  assert.equal(r.builds[0].unit, 'word');
  assert.equal(r.builds[0].stagger, 0);
  assert.deepEqual(r.unknown, { 'apple:not-in-this-deck': 1 });
});

// ---------- checkpoint 3: the full vocabulary on committed slide fixtures ----------
const SLIDE_24 = '94827105-7B4E-46BF-A875-756485D396D5';
const SLIDE_28 = '8934AF3E-93FF-41E5-9F2B-7B6436CEDF9B';
const SLIDE_32 = 'C6765084-F3DB-4B8F-A53E-783108A671EF';
const SLIDE_71 = '3496F91D-4579-4358-846E-2329494AF7DC';
// element ids as the converter makes them: the texture, with a position suffix when a texture repeats
const positionedTargets = (effect, leaves) => leaves.map((l) => `${l.texture}@${Math.round(l.initialState.position.pointX)}`);

test('every census name is in EFFECT_MAP, so this deck has zero appear fallbacks', () => {
  const census = ['apple:move in', 'renderMovie', 'apple:movie-start', 'apple:dissolve', 'apple:move in character', 'apple:wipe', 'apple:keyboard', 'apple:dissolve character', 'com.apple.iWork.Keynote.LineDraw', 'apple:fade and move', 'apple:bc-appear', 'apple:appear'];
  for (const name of census) assert.ok(EFFECT_MAP[name], name);
  assert.deepEqual(EFFECT_MAP['apple:move in character'], ['move-in', 'character']);
  assert.deepEqual(EFFECT_MAP['apple:keyboard'], ['keyboard', 'character']);
  assert.deepEqual(EFFECT_MAP['apple:bc-appear'], ['appear', 'object']);
  assert.deepEqual(EFFECT_MAP['com.apple.iWork.Keynote.LineDraw'], ['line-draw', 'object']);
});

test('slide 24: line-draw, then keyboard with one reveal offset per character from the hidden keyframes', () => {
  const r = collectBuilds(load(SLIDE_24), positionedTargets);
  assert.deepEqual(r.unknown, {});
  assert.equal(r.steps, 1);
  const kinds = r.builds.map((b) => b.effect);
  assert.deepEqual(kinds, ['line-draw', 'keyboard', 'line-draw', 'keyboard']);
  const [line, keys] = r.builds;
  assert.equal(line.unit, 'object');
  assert.equal(line.direction, null);
  assert.equal(line.duration, 2);
  assert.equal(line.begin, 1);
  assert.equal(line.automatic, true);
  assert.deepEqual(line.kpf.attributes, { 'sfx-action-acceleration': 3, direction: 31 });
  assert.equal(keys.unit, 'character');
  assert.equal(keys.duration, 3);
  assert.equal(keys.begin, 3, 'nested under the 2 s line-draw that begins at 1 s');
  assert.equal(keys.targets.length, 30);
  assert.equal(keys.offsets.length, 30);
  assert.ok(keys.offsets.every((o, i) => i === 0 || o >= keys.offsets[i - 1]), 'offsets rise in character order');
  assert.ok(keys.offsets[0] > 0 && keys.offsets[29] < 3, JSON.stringify(keys.offsets));
  assert.equal(keys.stagger, undefined, 'per-leaf offsets, not a constant stagger');
});

test('slide 28: a manual wipe to the right with no fallback and no measured direction check', () => {
  const r = collectBuilds(load(SLIDE_28), positionedTargets);
  assert.deepEqual(r.unknown, {});
  assert.equal(r.builds.length, 1);
  const [w] = r.builds;
  assert.equal(w.effect, 'wipe');
  assert.equal(w.unit, 'object');
  assert.equal(w.direction, 'right');
  assert.equal(w.duration, 0.5);
  assert.equal(w.automatic, false);
  assert.equal(w.distance, undefined);
  assert.deepEqual(r.directionChecks, []);
  // a wipe code outside 11 to 14 gets a null direction (the player plays the opacity ramp)
  const e21 = { type: 'buildIn', name: 'apple:wipe', attributes: { direction: 21 }, duration: 0.5, baseLayer: { layers: [] } };
  assert.equal(buildFromEffect(e21, { step: 1, begin: 0, automatic: true, targets: ['X'] }).build.direction, null);
});

test('slide 71: move in character on one text leaf moves every character together (stagger 0)', () => {
  const r = collectBuilds(load(SLIDE_71), positionedTargets);
  assert.deepEqual(r.unknown, {});
  const m = r.builds.find((b) => b.kpf.name === 'apple:move in character');
  assert.ok(m);
  assert.equal(m.effect, 'move-in');
  assert.equal(m.unit, 'character');
  assert.equal(m.direction, 'up');
  assert.equal(m.duration, 1);
  assert.equal(m.stagger, 0);
  assert.equal(m.offsets, undefined);
  assert.equal(m.distance, 268);
  assert.ok(r.directionChecks.length >= 1 && r.directionChecks.every((c) => c.check === 'agree'), JSON.stringify(r.directionChecks));
  assert.equal(transitionOf(load(SLIDE_71)).kind, 'push');
});

test('slide 32: dissolve, move in character to the left, then fade and move to the right, chained by nesting', () => {
  const r = collectBuilds(load(SLIDE_32), positionedTargets);
  assert.deepEqual(r.unknown, {});
  const chain = r.builds.filter((b) => b.effect !== 'movie-start');
  assert.deepEqual(chain.map((b) => [b.effect, b.unit, b.direction, b.begin, b.duration]), [
    ['dissolve', 'object', null, 1.01, 0.5],
    ['move-in', 'character', 'left', 2.01, 0.5],
    ['fade-and-move', 'object', 'right', 2.76, 0.5],
  ], 'the chain hangs under the 0.01 s movie-start');
  const fm = chain[2];
  assert.equal(fm.distance, 960);
  assert.ok(r.directionChecks.every((c) => c.check === 'agree'), JSON.stringify(r.directionChecks));
});

test('revealOffset reads the first hidden true-to-false keyframe', () => {
  assert.equal(revealOffset({ animations: [] }), 0);
  assert.equal(revealOffset({ animations: [{ animations: [{ property: 'hidden', beginTime: 0.7125, from: { scalar: true }, to: { scalar: false } }] }] }), 0.713);
  assert.equal(revealOffset({ animations: [{ property: 'opacity', beginTime: 2, from: { scalar: 0 }, to: { scalar: 1 } }] }), 0);
});

test('targetsOf may return id lists per leaf; ids are deduplicated in leaf order with the first offset', () => {
  const leaf = (t, begin) => ({ texturedRectangle: {}, texture: t, animations: [{ animations: [{ property: 'hidden', beginTime: begin, from: { scalar: true }, to: { scalar: false } }] }] });
  const effect = { type: 'buildIn', name: 'apple:keyboard', attributes: {}, duration: 1, baseLayer: { layers: [leaf('A', 0.1), leaf('B', 0.2), leaf('A', 0.3)] } };
  const slide = { events: [{ automaticPlay: true, effects: [effect] }] };
  const r = collectBuilds(slide, (e, leaves) => leaves.map((l) => (l.texture === 'A' ? ['A', 'A-0'] : null)));
  assert.deepEqual(r.builds[0].targets, ['A', 'A-0']);
  assert.deepEqual(r.builds[0].offsets, [0.1, 0.1]);
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
