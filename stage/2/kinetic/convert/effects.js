// KPF effects to the build vocabulary. Checkpoint 2 mapped the names the spike needs; checkpoint 3 maps
// every name of the census (TECHNICAL.DESIGN.md, Appendix: effect mapping). A name absent from the table
// still becomes `appear` and is counted, which must be 0 for this deck (REPORT-1.md, Checkpoint 3).
//
// Direction codes: the push decode of checkpoint 1 (11 right, 12 left, 13 down, 14 up, as the direction
// the content moves) also holds for `apple:move in`: on slide 4 code 12 animates `position.pointX` from
// +466 to the rest position (content moves left), 13 from -y (moves down), 14 from +y (moves up), 11 from
// -x (moves right). `buildFromEffect` checks every move-in against its keyframes and reports agreement.
// `apple:wipe` carries 11, 12, and 21; 21 is outside the decoded space and maps to a null direction, which
// the player plays as the opacity ramp the KPF keyframes carry (the live export plays every wipe that way:
// sslop/D-014/live-ref/s28). LineDraw carries 31 (forward along the path, measured on slide 24).
//
// Timing: effects nested under an effect start when the parent ends (`parent.begin + parent.duration`),
// siblings together. Measured on the live player: slide 4's four nesting levels at 0.25 s each arrive
// over one second (sslop/D-010/probe/live/timing2).
//
// Stagger: a per-word or per-character build gets its timing from the keyframes, never from a constant.
// `apple:keyboard` carries one leaf per character, each with a `hidden` true-to-false keyframe at its own
// `beginTime` (slide 21: 0.71, 0.97, 1.31, ... s), recorded per target in `Build.offsets`. `apple:move in
// character` carries one leaf with one `position` keyframe for the whole text, so every character moves
// together and `Build.stagger` is 0 (the live export moves the block as one: sslop/D-014/live-ref/s71).

export const DIRECTION = { 11: 'right', 12: 'left', 13: 'down', 14: 'up' };

/** KPF name to [effect, unit]. Names absent here map to appear/object and are counted. */
export const EFFECT_MAP = {
  'apple:move in': ['move-in', 'object'],
  'apple:move in character': ['move-in', 'character'],
  'apple:dissolve': ['dissolve', 'object'],
  'apple:dissolve character': ['dissolve', 'character'],
  'apple:wipe': ['wipe', 'object'],
  'apple:keyboard': ['keyboard', 'character'],
  'apple:appear': ['appear', 'object'],
  'apple:bc-appear': ['appear', 'object'],
  'apple:fade and move': ['fade-and-move', 'object'],
  'com.apple.iWork.Keynote.LineDraw': ['line-draw', 'object'],
  'apple:movie-start': ['movie-start', 'object'],
  renderMovie: ['movie-start', 'object'],
};

/** Effects whose direction comes from `attributes.direction` (and the keyframes, for the moving ones). */
const DIRECTED = new Set(['move-in', 'fade-and-move', 'wipe']);
const MOVING = new Set(['move-in', 'fade-and-move']);

export const TRANSITION_MAP = { 'apple:push': 'push', none: 'none' };

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Every texturedRectangle leaf under an effect's baseLayer with its own animations. */
export function effectLeaves(effect) {
  const out = [];
  const walk = (l) => {
    if (!l) return;
    if (l.texturedRectangle) out.push(l);
    for (const c of l.layers || []) walk(c);
  };
  walk(effect.baseLayer);
  return out;
}

/** Flatten `animations` (groups hold `animations`) into [{ property, from, to, duration, beginTime }]. */
export function leafAnimations(leaf) {
  const out = [];
  for (const a of leaf.animations || []) {
    for (const x of a.animations || [a]) out.push(x);
  }
  return out;
}

/** The position delta (from minus to) of the first position animation of a leaf, or null. */
export function positionDelta(leaf) {
  const a = leafAnimations(leaf).find((x) => x.property === 'position' && x.from && x.to);
  if (!a) return null;
  return { dx: a.from.pointX - a.to.pointX, dy: a.from.pointY - a.to.pointY };
}

/**
 * Seconds after the effect begins at which a leaf is revealed: the `beginTime` of its first `hidden`
 * keyframe that goes from true to false. 0 when the leaf has none (it is shown as the effect begins).
 */
export function revealOffset(leaf) {
  const a = leafAnimations(leaf).find((x) => x.property === 'hidden' && x.from?.scalar === true && x.to?.scalar === false);
  return a ? r3(a.beginTime ?? 0) : 0;
}

/** The screen direction the content moves for a from-to delta: the opposite of the offset it starts at. */
export function directionFromDelta(d) {
  if (!d) return null;
  if (Math.abs(d.dx) >= Math.abs(d.dy)) return d.dx > 0 ? 'left' : d.dx < 0 ? 'right' : null;
  return d.dy > 0 ? 'up' : 'down';
}

/**
 * Map one KPF effect to a Build. `targets` are element ids (the caller resolves textures to elements) and
 * `offsets`, when given, is one reveal offset per target. Returns { build, unknown, directionCheck } where
 * `unknown` is the KPF name when it fell back to appear and `directionCheck` is 'agree', 'disagree', or
 * null for effects without a measurable direction.
 */
export function buildFromEffect(effect, { step, begin, automatic, targets, unit: unitOverride = null, offsets = null }) {
  const name = effect.name;
  const mapped = EFFECT_MAP[name];
  const [kind, defaultUnit] = mapped || ['appear', 'object'];
  const attributes = effect.attributes || {};
  const code = attributes.direction;
  const leaves = effectLeaves(effect);
  const delta = leaves.map(positionDelta).find(Boolean) || null;
  let direction = null;
  let directionCheck = null;
  if (DIRECTED.has(kind)) {
    direction = DIRECTION[code] ?? null;
    if (MOVING.has(kind)) {
      const measured = directionFromDelta(delta);
      if (direction && measured) directionCheck = direction === measured ? 'agree' : 'disagree';
      if (!direction) direction = measured;
    }
  }
  const unit = unitOverride || defaultUnit;
  const build = {
    step,
    effect: kind,
    unit,
    direction,
    duration: r3(effect.duration ?? 0),
    begin: r3(begin),
    automatic,
    targets,
    kpf: { name, attributes, objectID: effect.objectID ?? null },
  };
  if (MOVING.has(kind) && delta) {
    build.distance = r3(direction === 'left' || direction === 'right' ? Math.abs(delta.dx) : Math.abs(delta.dy));
  }
  if (offsets && offsets.some((o) => o > 0)) build.offsets = offsets;
  // a per-word or per-character build on one text element: the keyframes carry one animation for the
  // whole leaf, so the units move together (stagger 0). Per-leaf timing lives in `offsets` instead.
  if ((unit === 'word' || unit === 'character') && leaves.length <= 1) build.stagger = 0;
  return { build, unknown: mapped ? null : name, directionCheck };
}

/** Normalise one targetsOf entry to a list of ids. */
function idsOf(entry) {
  if (!entry) return [];
  return Array.isArray(entry) ? entry.filter(Boolean) : [entry];
}

/**
 * Collect the builds of a slide. Each event with `buildIn` effects is one step, numbered from 1, in
 * event order. `targetsOf(effect, leaves)` returns, aligned with `leaves`, the element id (or id list)
 * each leaf maps to; a null entry means no element. Ids are deduplicated in leaf order and each keeps the
 * reveal offset of its first leaf (`Build.offsets`).
 * Returns { builds, steps, mapped: { name: count }, unknown: { name: count }, directionChecks: [{ name,
 * code, check }], skipped }. `mapped` counts every buildIn effect visited by KPF name, before the
 * deduplication and the skips, so it matches the recursive census.
 */
export function collectBuilds(slide, targetsOf, { unitOf = null } = {}) {
  const builds = [];
  const mapped = {};
  const unknown = {};
  const directionChecks = [];
  const skipped = [];
  let step = 0;
  for (const ev of slide.events) {
    const top = (ev.effects || []).filter((e) => e.type === 'buildIn');
    if (!top.length) continue;
    step += 1;
    const automatic = ev.automaticPlay === true;
    const seen = new Set();
    const walk = (effects, parentBegin) => {
      for (const e of effects || []) {
        if (e.type !== 'buildIn') continue;
        mapped[e.name] = (mapped[e.name] || 0) + 1;
        const begin = parentBegin + (e.beginTime ?? 0);
        const leaves = effectLeaves(e);
        const entries = targetsOf(e, leaves);
        const targets = [];
        const offsets = [];
        entries.forEach((entry, i) => {
          const off = leaves[i] ? revealOffset(leaves[i]) : 0;
          for (const id of idsOf(entry)) {
            if (targets.includes(id)) continue;
            targets.push(id);
            offsets.push(off);
          }
        });
        if (targets.length) {
          // one build per (effect kind, targets) per step: apple:movie-start and its nested renderMovie
          // both start the same video
          const key = `${(EFFECT_MAP[e.name] || ['appear'])[0]}|${targets.join(',')}`;
          if (!seen.has(key)) {
            seen.add(key);
            const unit = unitOf ? unitOf(e, targets) : null;
            const { build, unknown: u, directionCheck } = buildFromEffect(e, { step, begin, automatic, targets, unit, offsets });
            builds.push(build);
            if (u) unknown[u] = (unknown[u] || 0) + 1;
            if (directionCheck) directionChecks.push({ name: e.name, code: e.attributes?.direction ?? null, check: directionCheck, objectID: e.objectID ?? null });
          }
        } else {
          skipped.push({ name: e.name, objectID: e.objectID ?? null, reason: 'no element target' });
        }
        walk(e.effects, begin + (e.duration ?? 0));
      }
    };
    walk(top, 0);
  }
  return { builds, steps: step, mapped, unknown, directionChecks, skipped };
}

/** The slide transition from its last event: { kind, direction?, duration }. */
export function transitionOf(slide) {
  for (let i = slide.events.length - 1; i >= 0; i--) {
    const t = (slide.events[i].effects || []).find((e) => e.type === 'transition');
    if (!t) continue;
    const kind = TRANSITION_MAP[t.name] || 'none';
    if (kind === 'push') return { kind, direction: DIRECTION[t.attributes?.direction] ?? 'left', duration: r3(t.duration ?? 0) };
    return { kind, duration: kind === 'none' ? 0 : r3(t.duration ?? 0) };
  }
  return { kind: 'none', duration: 0 };
}
