// Slide transitions. A push moves the outgoing slide off one edge while the incoming slide enters from the
// other, both along `direction` (the direction the content moves): left means the outgoing slide exits
// through the left edge. The curve is the one every KPF push carries: cubic-bezier(0.497, 0, 0.498, 0.996).
import { cubicBezier } from './effects.js';

export const EASE_PUSH = cubicBezier(0.4970587193965912, 0, 0.4981173276901245, 0.9959721565246582);

const AXIS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** Offsets of the outgoing and incoming slides at `progress` 0..1 for a push over a `width` x `height` stage. */
export function pushOffsets(direction, progress, width, height) {
  const [ax, ay] = AXIS[direction] || AXIS.left;
  const p = EASE_PUSH(progress);
  const out = { dx: ax * width * p, dy: ay * height * p };
  const inn = { dx: -ax * width * (1 - p), dy: -ay * height * (1 - p) };
  return { out, in: inn };
}

/** Seconds a transition takes; a cut takes none. */
export function transitionDuration(transition) {
  if (!transition || transition.kind === 'none') return 0;
  return transition.duration ?? 0;
}
