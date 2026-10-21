// The pure part of the player: player/effects.js has no DOM dependency, so node can test the state it
// gives an element at a moment of a step (the vocabulary of checkpoint 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementState, itemState, offsetOf, stepDuration, EASE_IN_OUT } from '../../player/effects.js';

const text = { id: 'T', kind: 'text', hidden: true, words: [{ text: 'ab', chars: [{ text: 'a' }, { text: 'b' }] }, { text: 'c', chars: [{ text: 'c' }] }] };
const shape = { id: 'S', kind: 'shape', hidden: true };

test('keyboard: each target appears at its own offset and stays', () => {
  const b = { step: 1, effect: 'keyboard', unit: 'character', direction: null, duration: 3, begin: 0, targets: ['A', 'B'], offsets: [0.5, 1.2] };
  const a = { id: 'A', kind: 'text', hidden: true, words: [{ text: 'a', chars: [{ text: 'a' }] }] };
  const bEl = { id: 'B', kind: 'text', hidden: true, words: [{ text: 'b', chars: [{ text: 'b' }] }] };
  assert.equal(offsetOf(b, a), 0.5);
  assert.equal(offsetOf(b, bEl), 1.2);
  assert.equal(elementState(a, [b], 0, 0.4).visible, false);
  assert.equal(elementState(a, [b], 0, 0.6).visible, true);
  assert.equal(elementState(bEl, [b], 0, 0.6).visible, false);
  assert.equal(elementState(bEl, [b], 0, 1.3).visible, true);
  assert.equal(elementState(bEl, [b], 1, null).visible, true, 'done steps keep the element visible');
  assert.equal(elementState(bEl, [b], 0, null).visible, false, 'idle before the step: hidden');
  assert.equal(stepDuration([b], 1), 3);
});

test('wipe: a decoded direction clips along it; a null direction fades', () => {
  const right = itemState('wipe', 'right', undefined, 0.5);
  assert.equal(right.alpha, 1);
  assert.deepEqual(right.clip, { direction: 'right', p: EASE_IN_OUT(0.5) });
  const none = itemState('wipe', null, undefined, 0.5);
  assert.equal(none.clip, undefined);
  assert.ok(Math.abs(none.alpha - EASE_IN_OUT(0.5)) < 1e-9);
  const st = elementState(shape, [{ step: 1, effect: 'wipe', unit: 'object', direction: 'up', duration: 0.5, begin: 0, targets: ['S'] }], 0, 0.25);
  assert.equal(st.visible, true);
  assert.equal(st.clip.direction, 'up');
});

test('line-draw: the stroked fraction is the progress and the opacity ramps with it', () => {
  const st = elementState(shape, [{ step: 1, effect: 'line-draw', unit: 'object', direction: null, duration: 2, begin: 1, targets: ['S'] }], 0, 2);
  assert.equal(st.draw, 0.5);
  assert.ok(Math.abs(st.alpha - EASE_IN_OUT(0.5)) < 1e-9);
  assert.equal(elementState(shape, [{ step: 1, effect: 'line-draw', unit: 'object', duration: 2, begin: 1, targets: ['S'] }], 0, 0.5).visible, false);
  assert.equal(elementState(shape, [{ step: 1, effect: 'line-draw', unit: 'object', duration: 2, begin: 1, targets: ['S'] }], 1, null).draw, null);
});

test('move-in by character with stagger 0 moves every character together; a stagger spreads them', () => {
  const b = { step: 1, effect: 'move-in', unit: 'character', direction: 'up', distance: 100, duration: 1, begin: 0, targets: ['T'], stagger: 0 };
  const st = elementState(text, [b], 0, 0.5);
  assert.equal(st.unit, 'character');
  assert.equal(st.items.length, 3);
  assert.ok(st.items.every((i) => i.visible && i.dy === st.items[0].dy && i.dy > 0));
  const spread = elementState(text, [{ ...b, stagger: 0.4 }], 0, 0.5);
  assert.equal(spread.items[0].visible, true);
  assert.equal(spread.items[1].visible, true);
  assert.equal(spread.items[2].visible, false, 'the third character begins at 0.8 s');
  assert.ok(spread.items[1].dy > spread.items[0].dy);
});

test('fade-and-move: alpha rises from 0 and the offset shrinks to 0', () => {
  const s0 = itemState('fade-and-move', 'right', 960, 0);
  const s1 = itemState('fade-and-move', 'right', 960, 1);
  const sm = itemState('fade-and-move', 'right', 960, 0.5);
  assert.equal(s0.alpha, 0);
  assert.equal(s0.dx, -960);
  assert.equal(s1.alpha, 1);
  assert.equal(Math.abs(s1.dx), 0);
  assert.ok(sm.alpha > 0 && sm.alpha < 1 && sm.dx < 0 && sm.dx > -960);
});

test('appear and dissolve on a character unit of a shape play as an object', () => {
  assert.deepEqual(itemState('appear', null, undefined, 0), { visible: true, alpha: 1, dx: 0, dy: 0 });
  const st = elementState(shape, [{ step: 1, effect: 'dissolve', unit: 'character', direction: null, duration: 0.5, begin: 0, targets: ['S'] }], 0, 0.25);
  assert.equal(st.items, null);
  assert.ok(st.alpha > 0 && st.alpha < 1);
});
