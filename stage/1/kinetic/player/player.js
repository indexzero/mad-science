// The kinetic player. One 1920x1080 canvas scaled to fit the window, requestAnimationFrame driven.
// URL: player/index.html?deck=../decks/_all_docs/deck.json#<n> with n the 1-based slide.
// Keys: ArrowRight and space advance a build step, then the slide; ArrowLeft goes back.
// window.kinetic = { isReady(n), current(), goto(n), preloaded(), frameTimes() }, n 1-based everywhere.
import { Preloader } from './preload.js';
import { drawSlide } from './draw.js';
import { stepDuration, stepIsAutomatic, lastStep } from './effects.js';
import { pushOffsets, transitionDuration } from './transitions.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const deckUrl = new URL(params.get('deck') || '../decks/_all_docs/deck.json', location.href).href;
const deck = await (await fetch(deckUrl)).json();
canvas.width = deck.width;
canvas.height = deck.height;
const preloader = new Preloader(deck, deckUrl);

function fit() {
  const s = Math.min(window.innerWidth / deck.width, window.innerHeight / deck.height);
  canvas.style.width = `${Math.round(deck.width * s)}px`;
  canvas.style.height = `${Math.round(deck.height * s)}px`;
}
window.addEventListener('resize', fit);
fit();

// ---- state ----
const state = {
  slide: 0, // 1-based, 0 before the first goto
  done: 0, // completed steps of the current slide
  stepStart: null, // performance.now() when step done+1 began, else null
  transition: null, // { from, to, start, duration, kind, direction, firstFrame, snapshots }
  playing: new Map(), // element id -> HTMLVideoElement started on this slide
  drawn: null, // { slide, done } of the still frame the canvas holds, when the slide is idle
};
const frameDeltas = [];
let lastFrame = null;
const firstFrameWaiters = new Map(); // slide -> [resolve]

// slides are addressed by their 1-based deck index (`slide.index`), which a partial deck keeps sparse
function slideOf(n) {
  return deck.slides.find((s) => s.index === n) || null;
}
function positionOf(n) {
  return deck.slides.findIndex((s) => s.index === n);
}
function indexAt(pos) {
  return deck.slides[pos] ? deck.slides[pos].index : null;
}
const FIRST_INDEX = deck.slides[0].index;

function videoControl(el, play) {
  const v = preloader.get(`video:${el.src[preloader.videoType]}`);
  if (!v) return null;
  if (play) {
    if (!state.playing.has(el.id)) {
      state.playing.set(el.id, v);
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    return v;
  }
  return null;
}

function stopVideos() {
  for (const v of state.playing.values()) v.pause();
  state.playing.clear();
}

function resolveFirstFrame(n) {
  const list = firstFrameWaiters.get(n);
  if (!list) return;
  firstFrameWaiters.delete(n);
  for (const r of list) r();
}

function maybeAutoAdvance(now) {
  const slide = slideOf(state.slide);
  if (!slide || state.stepStart !== null) return;
  if (state.done < lastStep(slide.builds) && stepIsAutomatic(slide.builds, state.done + 1)) state.stepStart = now;
}

function finishStep() {
  state.done += 1;
  state.stepStart = null;
}

/** A still frame of slide `n` at step `done`, drawn in one go. */
function snapshot(n, done) {
  const c = document.createElement('canvas');
  c.width = deck.width;
  c.height = deck.height;
  drawSlide(c.getContext('2d'), deck, slideOf(n), preloader, done, null, () => null);
  return c;
}

/** A copy of what the stage shows now. */
function copyStage() {
  const c = document.createElement('canvas');
  c.width = deck.width;
  c.height = deck.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c;
}

// Still frames of the preloaded slides at step 0, rendered a few elements per animation frame once the
// slide's assets are decoded, so a push can start without drawing the incoming slide in one frame (slide
// 50's six 1600x1420 images take 200 ms to draw in the headless canvas). slide -> { canvas, next, total }.
const stills = new Map();
const STILL_BUDGET_MS = 8;

function queueStill(n) {
  const slide = slideOf(n);
  if (!slide || stills.has(n)) return;
  const c = document.createElement('canvas');
  c.width = deck.width;
  c.height = deck.height;
  drawSlide(c.getContext('2d'), deck, slide, preloader, 0, null, () => null, { from: 0, to: 0 });
  stills.set(n, { canvas: c, next: 0, total: slide.elements.length });
}

/** Render pending still frames for up to `budgetMs`, one slide at a time, element by element. */
function renderStills(budgetMs) {
  const deadline = performance.now() + budgetMs;
  for (const [n, st] of stills) {
    if (st.next >= st.total || !preloader.isReady(n)) continue;
    const c = st.canvas.getContext('2d');
    const slide = slideOf(n);
    while (st.next < st.total && performance.now() < deadline) {
      drawSlide(c, deck, slide, preloader, 0, null, () => null, { from: st.next, to: st.next + 1 });
      st.next += 1;
    }
    return;
  }
}

/** The finished still of slide `n` at step 0, or null. */
function stillOf(n) {
  const st = stills.get(n);
  return st && st.next >= st.total ? st.canvas : null;
}

// Each preloadAround call is one generation. Only the newest may evict: an older call whose loads end late
// (a slow n-1) would otherwise evict the window of a later goto, slides it never knew about (D-021).
let preloadGeneration = 0;

function preloadAround(n) {
  const pos = positionOf(n);
  const order = [indexAt(pos + 1), indexAt(pos + 2), indexAt(pos - 1)].filter((k) => k !== null);
  const generation = ++preloadGeneration;
  (async () => {
    for (const k of order) {
      if (generation !== preloadGeneration) return;
      await preloader.load(k);
      if (k !== indexAt(pos - 1)) queueStill(k);
    }
    if (generation !== preloadGeneration) return;
    const keep = new Set([n, ...order]);
    preloader.evict(keep);
    for (const k of stills.keys()) if (!keep.has(k)) stills.delete(k);
  })();
}

function land(n, now, done = 0) {
  stopVideos();
  state.slide = n;
  state.done = done;
  state.stepStart = null;
  delete state.frozenStep;
  state.transition = null;
  state.drawn = null;
  location.hash = `#${n}`;
  maybeAutoAdvance(now);
}

// ---- frame loop ----
function frame(now) {
  if (lastFrame !== null) {
    frameDeltas.push(now - lastFrame);
    if (frameDeltas.length > 120) frameDeltas.shift();
  }
  lastFrame = now;

  if (state.transition) {
    const tr = state.transition;
    const p = tr.frozen !== undefined ? tr.frozen : tr.duration > 0 ? Math.min(1, (now - tr.start) / (tr.duration * 1000)) : 1;
    const to = slideOf(tr.to);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, deck.width, deck.height);
    if (tr.kind === 'push') {
      // a push moves two still frames, as the KPF player moves its two snapshot textures: both slides are
      // rendered once when the transition starts and blitted at their offsets on every frame (drawing every
      // element of two slides per frame cost up to 200 ms a frame in the headless canvas)
      const o = pushOffsets(tr.direction, p, deck.width, deck.height);
      ctx.drawImage(tr.snapshots.from, o.out.dx, o.out.dy);
      ctx.drawImage(tr.snapshots.to, o.in.dx, o.in.dy);
    } else {
      drawSlide(ctx, deck, to, preloader, 0, null, () => null);
    }
    if (!tr.firstFrame) {
      tr.firstFrame = true;
      resolveFirstFrame(tr.to);
    }
    if (p >= 1 && tr.frozen === undefined) {
      land(tr.to, now);
      // the last push frame drew the incoming still at its rest position: the stage holds slide `to` at step 0
      if (tr.kind === 'push') state.drawn = { slide: tr.to, done: 0 };
    }
    requestAnimationFrame(frame);
    return;
  }

  const slide = slideOf(state.slide);
  if (slide) {
    let t = null;
    if (state.stepStart !== null) {
      t = state.frozenStep !== undefined ? state.frozenStep : (now - state.stepStart) / 1000;
      if (state.frozenStep === undefined && t >= stepDuration(slide.builds, state.done + 1)) {
        finishStep();
        t = null;
        maybeAutoAdvance(now);
        if (state.stepStart !== null) t = 0;
      }
    }
    // an idle slide (no step running, no video playing) is drawn once; the canvas keeps the frame. A video
    // slide redraws every frame for the video. In the headless canvas a slide of six 1600x1420 images costs
    // 200 ms to draw, so redrawing a still frame at 60 Hz would stall the frame loop.
    const idle = t === null && state.playing.size === 0;
    const same = idle && state.drawn && state.drawn.slide === state.slide && state.drawn.done === state.done;
    if (!same) {
      drawSlide(ctx, deck, slide, preloader, state.done, t, videoControl);
      state.drawn = idle ? { slide: state.slide, done: state.done } : null;
    }
    resolveFirstFrame(state.slide);
    renderStills(STILL_BUDGET_MS);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- navigation ----
async function goto(n) {
  n = Number(n);
  if (!slideOf(n)) throw new Error(`no slide ${n}`);
  if (!preloader.isReady(n)) await preloader.load(n);
  const done = new Promise((resolve) => {
    const list = firstFrameWaiters.get(n) || [];
    list.push(resolve);
    firstFrameWaiters.set(n, list);
  });
  const now = performance.now();
  const current = slideOf(state.slide);
  if (current && n === indexAt(positionOf(state.slide) + 1) && current.transition.kind !== 'none' && transitionDuration(current.transition) > 0) {
    state.stepStart = null;
    state.done = lastStep(current.builds);
    // the outgoing still is the stage itself when the slide is idle; the incoming still was rendered during
    // the preload when the frame loop had the time, else it is drawn now
    const idle = state.stepStart === null;
    const snapshots = current.transition.kind === 'push' ? { from: idle ? copyStage() : snapshot(state.slide, state.done), to: stillOf(n) || snapshot(n, 0) } : null;
    stopVideos();
    state.transition = { from: state.slide, to: n, start: now, duration: transitionDuration(current.transition), kind: current.transition.kind, direction: current.transition.direction, firstFrame: false, snapshots };
  } else {
    land(n, now);
  }
  // the preload of n+1 and n+2 starts as goto(n) resolves (design, Preload policy), not when a push lands
  preloadAround(n);
  await done;
  return n;
}

function next() {
  const slide = slideOf(state.slide);
  if (!slide) return;
  if (state.stepStart !== null) {
    finishStep();
    maybeAutoAdvance(performance.now());
    return;
  }
  if (state.done < lastStep(slide.builds)) {
    state.stepStart = performance.now();
    return;
  }
  const after = indexAt(positionOf(state.slide) + 1);
  if (after !== null) goto(after);
}

function prev() {
  const slide = slideOf(state.slide);
  if (!slide) return;
  if (state.stepStart !== null) {
    state.stepStart = null;
    return;
  }
  if (state.done > 0) {
    state.done -= 1;
    return;
  }
  const before = indexAt(positionOf(state.slide) - 1);
  if (before !== null) {
    const n = before;
    (async () => {
      if (!preloader.isReady(n)) await preloader.load(n);
      land(n, performance.now(), lastStep(slideOf(n).builds));
      preloadAround(n);
    })();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
});

window.kinetic = {
  isReady: (n) => preloader.isReady(Number(n)),
  current: () => state.slide,
  goto,
  preloaded: () => preloader.preloaded(),
  frameTimes: () => frameDeltas.slice(),
  videoType: () => preloader.videoType,
  // the playback position of every video started on the current slide, by element id (the suite asserts it grows)
  videoTimes: () => Object.fromEntries([...state.playing].map(([id, v]) => [id, v.currentTime])),
  // extras for the suite: the step state and a next/prev without a key press
  state: () => ({ slide: state.slide, done: state.done, animating: state.stepStart !== null, frozen: state.frozenStep ?? null, transition: state.transition ? { from: state.transition.from, to: state.transition.to } : null }),
  next,
  prev,
  // hold the running build step at `t` seconds (the suite captures a mid-build frame); null releases it
  freezeStep: (t) => {
    if (state.stepStart === null) return false;
    if (t === null) {
      delete state.frozenStep;
      state.stepStart = performance.now();
    } else state.frozenStep = Math.max(0, Number(t));
    return true;
  },
  // hold the running transition at a raw progress 0..1 (before easing); null releases it
  freezeTransition: (p) => {
    if (!state.transition) return false;
    if (p === null) {
      delete state.transition.frozen;
      state.transition.start = performance.now();
    } else state.transition.frozen = Math.min(1, Math.max(0, Number(p)));
    return true;
  },
};

const initial = Number((location.hash || '').slice(1));
goto(slideOf(initial) ? initial : FIRST_INDEX);
