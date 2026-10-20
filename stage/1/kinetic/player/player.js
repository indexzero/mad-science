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
  transition: null, // { from, to, start, duration, kind, direction, firstFrame }
  playing: new Map(), // element id -> HTMLVideoElement started on this slide
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

function preloadAround(n) {
  const pos = positionOf(n);
  const order = [indexAt(pos + 1), indexAt(pos + 2), indexAt(pos - 1)].filter((k) => k !== null);
  (async () => {
    for (const k of order) await preloader.load(k);
    preloader.evict(new Set([n, ...order]));
  })();
}

function land(n, now, done = 0) {
  stopVideos();
  state.slide = n;
  state.done = done;
  state.stepStart = null;
  state.transition = null;
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
    const from = slideOf(tr.from);
    const to = slideOf(tr.to);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, deck.width, deck.height);
    if (tr.kind === 'push') {
      const o = pushOffsets(tr.direction, p, deck.width, deck.height);
      ctx.save();
      ctx.translate(o.out.dx, o.out.dy);
      drawSlide(ctx, deck, from, preloader, lastStep(from.builds), null, (el, play) => videoControl(el, play));
      ctx.restore();
      ctx.save();
      ctx.translate(o.in.dx, o.in.dy);
      drawSlide(ctx, deck, to, preloader, 0, null, () => null);
      ctx.restore();
    } else {
      drawSlide(ctx, deck, to, preloader, 0, null, () => null);
    }
    if (!tr.firstFrame) {
      tr.firstFrame = true;
      resolveFirstFrame(tr.to);
    }
    if (p >= 1 && tr.frozen === undefined) {
      land(tr.to, now);
      preloadAround(tr.to);
    }
    requestAnimationFrame(frame);
    return;
  }

  const slide = slideOf(state.slide);
  if (slide) {
    let t = null;
    if (state.stepStart !== null) {
      t = (now - state.stepStart) / 1000;
      if (t >= stepDuration(slide.builds, state.done + 1)) {
        finishStep();
        t = null;
        maybeAutoAdvance(now);
        if (state.stepStart !== null) t = 0;
      }
    }
    drawSlide(ctx, deck, slide, preloader, state.done, t, videoControl);
    resolveFirstFrame(state.slide);
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
    state.transition = { from: state.slide, to: n, start: now, duration: transitionDuration(current.transition), kind: current.transition.kind, direction: current.transition.direction, firstFrame: false };
  } else {
    land(n, now);
    preloadAround(n);
  }
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
  // the playback position of every video started on the current slide, by element id (the suite asserts it grows)
  videoTimes: () => Object.fromEntries([...state.playing].map(([id, v]) => [id, v.currentTime])),
  // extras for the suite: the step state and a next/prev without a key press
  state: () => ({ slide: state.slide, done: state.done, animating: state.stepStart !== null, transition: state.transition ? { from: state.transition.from, to: state.transition.to } : null }),
  next,
  prev,
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
