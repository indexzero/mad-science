// Build effects: timing curves and the per-element state at a moment of a step.
// Curves come from the KPF keyframes (convert/effects.js header): move-in uses cubic-bezier
// (0.406, 0.500, 0.602, 1.0); dissolve, wipe, and line-draw use EaseInEaseOut, which is
// cubic-bezier(0.42, 0, 0.58, 1); fade-and-move moves on cubic-bezier(0.311, 0.208, 0.201, 1) and fades on
// cubic-bezier(0.703, 0, 0.301, 0.999) (slide 32, `apple:fade and move` keyframes).

export function cubicBezier(p1x, p1y, p2x, p2y) {
  const sampleX = (t) => 3 * (1 - t) * (1 - t) * t * p1x + 3 * (1 - t) * t * t * p2x + t * t * t;
  const sampleY = (t) => 3 * (1 - t) * (1 - t) * t * p1y + 3 * (1 - t) * t * t * p2y + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (sampleX(mid) < x) lo = mid;
      else hi = mid;
    }
    return sampleY((lo + hi) / 2);
  };
}

export const EASE_MOVE_IN = cubicBezier(0.40632209181785583, 0.4998149275779724, 0.6016100645065308, 1);
export const EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1);
export const EASE_FADE_MOVE_POSITION = cubicBezier(0.3109649121761322, 0.207951575, 0.20134320855140686, 1);
export const EASE_FADE_MOVE_OPACITY = cubicBezier(0.7027754783630371, 0, 0.300685316324234, 0.9992296695709229);

const DIR = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] };

/** Where a move-in starts: `distance` pixels against its direction of travel (off the far side). */
export function moveInOffset(direction, distance, progress, ease = EASE_MOVE_IN) {
  const [sx, sy] = DIR[direction] || [0, 0];
  const d = (distance ?? 2000) * (1 - ease(progress));
  return { dx: sx * d, dy: sy * d };
}

/** Progress of a build at `t` seconds into its step: null before it begins, else 0..1. */
export function buildProgress(build, t) {
  const begin = build.begin ?? 0;
  if (t < begin) return null;
  if (!build.duration) return 1;
  return Math.min(1, (t - begin) / build.duration);
}

/** The duration of a step: when its last build ends. */
export function stepDuration(builds, step) {
  let end = 0;
  for (const b of builds) if (b.step === step) end = Math.max(end, (b.begin ?? 0) + (b.duration ?? 0));
  return end;
}

/** True when every build of `step` is automatic (plays without a key press). */
export function stepIsAutomatic(builds, step) {
  const own = builds.filter((b) => b.step === step);
  return own.length > 0 && own.every((b) => b.automatic === true);
}

/** The highest step number of a slide (0 when it has no builds). */
export function lastStep(builds) {
  return builds.reduce((m, b) => Math.max(m, b.step), 0);
}

/**
 * The state of one unit (an object, a word, or a character) of an effect at `progress` (null before it
 * begins). Returns { visible, alpha, dx, dy, clip?, draw? } where `clip` is the revealed fraction and the
 * direction of a wipe and `draw` the stroked fraction of a line-draw.
 */
export function itemState(effect, direction, distance, progress) {
  if (progress === null) return { visible: false };
  if (effect === 'move-in') return { visible: true, alpha: 1, ...moveInOffset(direction, distance, progress) };
  if (effect === 'dissolve') return { visible: true, alpha: EASE_IN_OUT(progress), dx: 0, dy: 0 };
  if (effect === 'fade-and-move') return { visible: true, alpha: EASE_FADE_MOVE_OPACITY(progress), ...moveInOffset(direction, distance, progress, EASE_FADE_MOVE_POSITION) };
  if (effect === 'wipe') {
    // a decoded direction reveals through a clip rectangle that grows along it; without one the KPF
    // opacity ramp plays (the live export plays every wipe as that ramp)
    if (direction) return { visible: true, alpha: 1, dx: 0, dy: 0, clip: { direction, p: EASE_IN_OUT(progress) } };
    return { visible: true, alpha: EASE_IN_OUT(progress), dx: 0, dy: 0 };
  }
  if (effect === 'line-draw') return { visible: true, alpha: EASE_IN_OUT(progress), dx: 0, dy: 0, draw: progress };
  // appear, keyboard, movie-start: present once begun
  return { visible: true, alpha: 1, dx: 0, dy: 0 };
}

/** The reveal offset of `el` inside build `b` (Build.offsets, one per target), else 0. */
export function offsetOf(b, el) {
  if (!b.offsets) return 0;
  const i = b.targets.indexOf(el.id);
  return i >= 0 ? b.offsets[i] ?? 0 : 0;
}

/**
 * The drawing state of an element when steps up to `done` are complete and step `done + 1` has been running
 * for `t` seconds (`t` is null when no step is running). Returns
 * { visible, alpha, dx, dy, items, play, clip, draw } where `items` is a per-word (or per-character) state
 * list for a text element built by unit, and `play` is true once a movie-start has begun.
 */
export function elementState(el, builds, done, t) {
  const own = builds.filter((b) => b.targets.includes(el.id));
  const base = { visible: !el.hidden, alpha: el.opacity ?? 1, dx: 0, dy: 0, items: null, play: false, clip: null, draw: null };
  if (!own.length) return base;
  let state = { ...base, visible: !el.hidden };
  for (const b of own) {
    if (b.step <= done) {
      state.visible = true;
      if (b.effect === 'movie-start') state.play = true;
      continue;
    }
    if (b.step !== done + 1 || t === null) {
      if (el.hidden) state.visible = false;
      continue;
    }
    const begin = (b.begin ?? 0) + offsetOf(b, el);
    const p = buildProgress({ begin, duration: b.duration }, t);
    if (p === null) {
      if (el.hidden) state.visible = false;
      continue;
    }
    if (b.effect === 'movie-start') state.play = true;
    const perItem = el.kind === 'text' && (b.unit === 'word' || b.unit === 'character');
    if (!perItem) {
      const s = itemState(b.effect, b.direction, b.distance, p);
      state = { ...state, visible: s.visible, alpha: (el.opacity ?? 1) * (s.alpha ?? 1), dx: s.dx ?? 0, dy: s.dy ?? 0, clip: s.clip ?? null, draw: s.draw ?? null };
      continue;
    }
    const count = b.unit === 'word' ? el.words.length : el.words.reduce((n, w) => n + (w.chars?.length ?? 1), 0);
    const stagger = b.stagger ?? 0;
    const items = [];
    for (let i = 0; i < count; i++) {
      const local = t - begin - i * stagger;
      const pi = local < 0 ? null : Math.min(1, Math.max(0, local / (b.duration || 1e-6)));
      const s = itemState(b.effect, b.direction, b.distance, pi);
      items.push({ visible: s.visible, alpha: (el.opacity ?? 1) * (s.alpha ?? 1), dx: s.dx ?? 0, dy: s.dy ?? 0 });
    }
    state = { ...state, visible: true, alpha: el.opacity ?? 1, dx: 0, dy: 0, items, unit: b.unit };
  }
  return state;
}
