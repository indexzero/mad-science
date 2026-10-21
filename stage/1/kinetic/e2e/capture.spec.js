// Side-by-side captures: the live export and the new player at 960x540.
//   spike-4   slide 4 at its final build state (live: one ArrowRight per manual step)
//   spike-2   slide 2 after settle, video boxes masked on both sides (vacuous: the GIF layer covers the frame),
//             then its final state unmasked as spike-2-final, asserted; the video position must grow
//   spike-1-2 200 ms into the push from slide 1 to slide 2
//   1 .. 71   every slide at its final build state, video boxes masked; where the mask covers the frame the
//             final state is compared with the moving pixels of either side masked instead, and the
//             unmasked ratio is recorded beside it (the rule is recorded); ratios in ratios.json under CAPTURES,
//             each beside the committed ratio of e2e/captures/ratios.json as a reference
//   word-build slide 21, `apple:keyboard` (unit character, eight units with their own offsets): the final
//             state and a mid-build frame per side where some but not all units show, asserted (Q-007)
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gotoLive, advanceLive, settle, indicatorHidden, LIVE_BASE, SETTLE_MS } from './live.js';
import { compareCaptures, compareCapturesMasked, animatedMask, recordExtra, toleranceFor, videoMasks, slideByIndex, TOLERANCE, THRESHOLD, decode, pushBoundary, rawProgress, CAPTURES, COMMITTED_CAPTURES, DECK, FRAME_GAP_MS, animatedFrameCount, masksCoverFrame, masksCoverText, boxMask, textCoverage, dilateMask } from './compare.js';
import { stepDuration, stepIsAutomatic, lastStep } from '../player/effects.js';

const PLAYER = (n) => `player/index.html?deck=../decks/_all_docs/deck.json#${n}`;
const RATIOS = join(CAPTURES, 'ratios.json');
// the committed ratios, a reference only: a run records each slide's committed ratio beside its own
const COMMITTED_RATIOS = join(COMMITTED_CAPTURES, 'ratios.json');
const REFERENCE = RATIOS !== COMMITTED_RATIOS && existsSync(COMMITTED_RATIOS) ? JSON.parse(readFileSync(COMMITTED_RATIOS, 'utf8')).slides || {} : {};
// A live screenshot that hangs (slide 64 once hung 16.8 minutes in page.screenshot) fails after this bound,
// and the live side is then taken once more on a fresh page.
const SHOT_TIMEOUT_MS = 30000;
const SLIDE_COUNT = DECK.slides.length;

/** Open the new player on slide n and wait for its first frame and its automatic steps. */
async function openNew(page, n) {
  await page.goto(PLAYER(n));
  await page.waitForFunction((k) => window.kinetic && window.kinetic.current() === k, n, { timeout: 60000 });
  await waitIdle(page);
}

async function waitIdle(page) {
  await page.waitForFunction(() => !window.kinetic.state().animating && !window.kinetic.state().transition, null, { timeout: 60000 });
}

function manualSteps(n) {
  return stepPlan(n).filter((s) => s.manual).length;
}

/** The steps of slide n in order: { step, manual, ms } with `ms` the step's duration from deck.json. */
function stepPlan(n) {
  const s = slideByIndex(n);
  const plan = [];
  for (let k = 1; k <= lastStep(s.builds); k++) plan.push({ step: k, manual: !stepIsAutomatic(s.builds, k), ms: Math.round(stepDuration(s.builds, k) * 1000) });
  return plan;
}

/**
 * Drive the live export to the final build state of slide n: automatic steps are waited out by their
 * duration from deck.json (plus a margin), manual steps take one ArrowRight each. Returns the press count.
 */
async function liveFinalState(page, n) {
  const plan = stepPlan(n);
  await gotoLive(page, n);
  let i = 0;
  let presses = 0;
  const waitAutomatic = async () => {
    let ms = 0;
    while (i < plan.length && !plan[i].manual) ms += plan[i++].ms;
    if (ms > 0) await page.waitForTimeout(ms + 250);
  };
  await waitAutomatic();
  while (i < plan.length) {
    const own = plan[i++].ms;
    await page.keyboard.press('ArrowRight');
    presses += 1;
    await settle(page);
    if (own > SETTLE_MS) await page.waitForTimeout(own - SETTLE_MS + 250);
    await waitAutomatic();
  }
  await page.waitForTimeout(SETTLE_MS);
  return presses;
}

/** Drive the new player to the final build state of slide n and check its state. */
async function newFinalState(page, n) {
  const plan = stepPlan(n);
  await openNew(page, n);
  for (const s of plan) {
    if (!s.manual) continue;
    await page.keyboard.press('ArrowRight');
    await waitIdle(page);
  }
  await page.waitForTimeout(SETTLE_MS);
  expect(await page.evaluate(() => window.kinetic.state())).toMatchObject({ slide: n, done: plan.length, animating: false });
}

/** Frames of a page at one build state, `gapMs` apart: the first is the capture, the rest find the moving pixels. */
async function frames(page, gapMs = FRAME_GAP_MS, count = 3) {
  const out = [await page.screenshot({ timeout: SHOT_TIMEOUT_MS })];
  for (let i = 1; i < count; i++) {
    await page.waitForTimeout(gapMs);
    out.push(await page.screenshot({ timeout: SHOT_TIMEOUT_MS }));
  }
  return out;
}

/**
 * The rule of slide n: `animated-pixels-masked` where the video boxes cover the frame (the box mask is
 * vacuous) or overlap a text box (the box mask would hide text, D-019 F-02); else `masked`.
 */
function ruleFor(n) {
  return masksCoverFrame(n) || masksCoverText(n) ? 'animated-pixels-masked' : 'masked';
}

/**
 * The frame count per side for slide n: 3, or where the moving pixels are masked one frame every
 * FRAME_GAP_MS over the slide's longest video loop.
 */
function frameCount(n) {
  return ruleFor(n) === 'animated-pixels-masked' ? animatedFrameCount(n) : 3;
}

/**
 * The live side of slide n at its final build state: the press count and `count` frames. A timeout (a hung
 * live fetch or screenshot) gets one retry on a fresh page. Returns { presses, frames, retried }.
 */
async function liveSide(page, browser, n, count) {
  try {
    const presses = await liveFinalState(page, n);
    return { presses, frames: await frames(page, FRAME_GAP_MS, count), retried: false };
  } catch (e) {
    if (e?.name !== 'TimeoutError') throw e;
    console.log(`slide ${n}: live side timed out (${String(e.message).split('\n')[0]}); one retry on a fresh page`);
    const again = await browser.newPage({ viewport: { width: 960, height: 540 } });
    try {
      const presses = await liveFinalState(again, n);
      return { presses, frames: await frames(again, FRAME_GAP_MS, count), retried: true };
    } finally {
      await again.close();
    }
  }
}

/** Merge one slide's result into ratios.json under CAPTURES. */
function recordRatio(key, entry) {
  const cur = existsSync(RATIOS) ? JSON.parse(readFileSync(RATIOS, 'utf8')) : {};
  const slides = { ...(cur.slides || {}), [key]: entry };
  const ordered = Object.fromEntries(Object.keys(slides).sort((a, b) => Number(a) - Number(b)).map((k) => [k, slides[k]]));
  const out = {
    platform: 'this Mac, chromium through Playwright 1.64.1 at 960x540, pixelmatch 8.0.0 threshold 0.1',
    default: TOLERANCE.default,
    rules: {
      masked: 'video boxes masked on both sides, the rest compared',
      'animated-pixels-masked': 'the video boxes cover the frame (vacuous mask) or overlap a text box (the box mask would hide text), so the final state is compared with the pixels that move on either side (frames 400 ms apart per side over the longest video loop of the slide, 3 to 32 frames, dilated 2 px; on the glyph pixels of deck.json only the motion of the live side) masked out; unmaskedRatio is the first frames compared with no mask, recorded',
    },
    slides: ordered,
  };
  writeFileSync(RATIOS, JSON.stringify(out, null, 2) + '\n');
}

/**
 * Compare a live and a new final-state capture of slide n under the design's rule: the video boxes masked.
 * When the boxes cover the frame (the vacuous case) or overlap a text box (D-019 F-02), the final state is
 * compared with the pixels that move on either side masked out (the GIF phase cannot be aligned between
 * the two players; on the glyph pixels only the live side's motion counts), and the unmasked ratio of
 * the first frames is recorded beside it. `glyphs` is the glyph region of `glyphRegion()`. `liveFrames` and `newFrames` are the frame lists of `frames()`;
 * the first frame of each is the capture. Returns the result with `rule` set, `text` (the compared and
 * mismatched pixels of each text box), and `textUnion` (the same over the union of the text boxes).
 */
function compareFinal(name, n, liveFrames, newFrames, glyphs) {
  const live = liveFrames[0];
  const mine = newFrames[0];
  const masks = videoMasks(n, 960, 540);
  const rule = ruleFor(n);
  let r;
  let pixelMask;
  let unmaskedRatio = null;
  if (rule === 'masked') {
    r = compareCaptures(name, live, mine, masks);
    pixelMask = boxMask(masks, 960, 540);
  } else {
    const u = compareCaptures(name, live, mine, []);
    unmaskedRatio = u.ratio;
    pixelMask = animatedMask(liveFrames, newFrames, 960, 540, 2, glyphs);
    r = compareCapturesMasked(name, live, mine, pixelMask);
  }
  const text = textCoverage(n, pixelMask, r.diff);
  const union = textCoverage(n, pixelMask, r.diff, 960, 540, true)[0] ?? { compared: 0, mismatched: 0 };
  return { ...r, rule, unmaskedRatio, maskedFraction: r.masked / (960 * 540), text, textUnion: union };
}

/**
 * The pixels the glyphs of slide n cover at 960x540, dilated 2 px: every word outline of deck.json filled
 * on a canvas of `page`, without the player's code (a player that fails to draw a glyph does not shrink
 * the region). On these pixels only the motion of the live side masks a pixel (D-019 F-02).
 */
async function glyphRegion(page, n) {
  const paths = [];
  for (const e of slideByIndex(n).elements) {
    if (e.kind !== 'text') continue;
    for (const w of e.words) paths.push(w.d ?? (w.chars || []).map((c) => c.d).join(''));
  }
  const on = await page.evaluate(({ paths, w, h, sw, sh }) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.scale(w / sw, h / sh);
    ctx.fillStyle = '#ffffff';
    for (const d of paths) ctx.fill(new Path2D(d));
    const a = ctx.getImageData(0, 0, w, h).data;
    const out = [];
    for (let i = 0; i < w * h; i++) if (a[i * 4 + 3] > 0) out.push(i);
    return out;
  }, { paths, w: 960, h: 540, sw: DECK.width, sh: DECK.height });
  const mask = new Uint8Array(960 * 540);
  for (const i of on) mask[i] = 1;
  return dilateMask(mask, 960, 540, 2);
}

/** Text coverage summary: text boxes with at least one compared pixel; compared and mismatched pixels over the union of the text boxes. */
function textSummary(r) {
  const { compared, mismatched } = r.textUnion;
  return { boxes: r.text.length, boxesCompared: r.text.filter((t) => t.compared > 0).length, compared, mismatched, ratio: compared ? Math.round((mismatched / compared) * 1e6) / 1e6 : null };
}

test.describe('spike captures', () => {
  test('spike-4: slide 4 at its final build state', async ({ page, browser }) => {
    const presses = manualSteps(4);
    await gotoLive(page, 4);
    await advanceLive(page, presses);
    const liveHash = await page.evaluate(() => location.hash);
    const live = await page.screenshot();

    const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await openNew(fresh, 4);
    for (let i = 0; i < presses; i++) {
      await fresh.keyboard.press('ArrowRight');
      await waitIdle(fresh);
    }
    await fresh.waitForTimeout(SETTLE_MS);
    expect(await fresh.evaluate(() => window.kinetic.state())).toMatchObject({ slide: 4, done: 2, animating: false });
    const mine = await fresh.screenshot();
    await fresh.close();

    const r = compareCaptures('spike-4', live, mine, videoMasks(4, 960, 540));
    console.log(`spike-4 live hash after ${presses} ArrowRight: ${liveHash}; mismatch ratio ${r.ratio.toFixed(5)} (${r.mismatched} of ${r.unmasked} unmasked pixels), tolerance ${toleranceFor('spike-4')}`);
    expect(r.unmasked).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(toleranceFor('spike-4'));
  });

  test('spike-2: slide 2 after settle with the video box masked on both sides', async ({ page, browser }) => {
    await gotoLive(page, 2);
    const live = await page.screenshot();

    const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await fresh.goto(PLAYER(2));
    await fresh.waitForFunction(() => window.kinetic && window.kinetic.current() === 2, null, { timeout: 60000 });
    await fresh.waitForTimeout(SETTLE_MS);
    const mine = await fresh.screenshot();

    const masks = videoMasks(2, 960, 540);
    const r = compareCaptures('spike-2', live, mine, masks);
    const masked = r.masked / (960 * 540);
    console.log(`spike-2 mismatch ratio ${r.ratio.toFixed(5)} over ${r.unmasked} unmasked pixels (video mask covers ${(masked * 100).toFixed(1)} percent of the frame${r.vacuous ? ', vacuous' : ''}); video region live vs new ${r.regions.map((x) => x.ratio.toFixed(3)).join(',')} against videoRegion ${TOLERANCE.videoRegion} (recorded, not asserted)`);

    // the video plays: its position grows between two reads 500 ms apart (CP2-F1)
    const t1 = await fresh.evaluate(() => window.kinetic.videoTimes());
    await fresh.waitForTimeout(500);
    const t2 = await fresh.evaluate(() => window.kinetic.videoTimes());
    const videoIds = Object.keys(t1);
    expect(videoIds.length).toBeGreaterThan(0);
    for (const id of videoIds) expect(t2[id]).toBeGreaterThan(t1[id]);

    // the mask is vacuous on this slide (the GIF layer covers the frame), so the asserted comparison is the
    // final state (the warning text dissolves in at 3.51 s) without any mask; the GIF phase difference is
    // inside the number and the capture set is committed as spike-2-final.* (CP2-F1)
    await page.waitForTimeout(4000);
    await fresh.waitForFunction(() => window.kinetic.state().done === 1 && !window.kinetic.state().animating, null, { timeout: 30000 });
    await fresh.waitForTimeout(SETTLE_MS);
    const liveFinal = await page.screenshot();
    const mineFinal = await fresh.screenshot();
    await fresh.close();
    const f = compareCaptures('spike-2-final', liveFinal, mineFinal, []);
    recordExtra('spike-2', { finalStateUnmaskedRatio: f.ratio, finalStateMismatched: f.mismatched, videoTimes: [t1, t2] });
    console.log(`spike-2 final state, unmasked, live vs new: mismatch ratio ${f.ratio.toFixed(5)} (${f.mismatched} of ${f.unmasked} pixels), tolerance ${toleranceFor('spike-2')}; video ${videoIds[0]} advanced ${(t2[videoIds[0]] - t1[videoIds[0]]).toFixed(3)} s in 500 ms`);
    expect(r.ratio).toBeLessThan(toleranceFor('spike-2'));
    expect(f.unmasked).toBeGreaterThan(0);
    expect(f.ratio).toBeLessThan(toleranceFor('spike-2'));
  });

  test('spike-1-2: 200 ms into the push from slide 1 to slide 2', async ({ page, browser }) => {
    // The live side is captured 200 ms after ArrowRight. Its actual progress is read from the frame (the
    // column where slide 1's black top band ends), because key and screenshot latency differ per player.
    // The new side is frozen at that same progress, so the comparison tests the push rendering and the
    // direction, not the two players' input latency.
    await gotoLive(page, 1);
    const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await openNew(fresh, 1);
    await fresh.waitForFunction(() => window.kinetic.isReady(2), null, { timeout: 60000 });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const live = await page.screenshot();
    const boundary = pushBoundary(decode(live));
    expect(boundary).not.toBeNull();
    const eased = 1 - boundary / 960;
    const raw = rawProgress(eased);
    expect(eased).toBeGreaterThan(0.05);
    expect(eased).toBeLessThan(0.95);

    await fresh.evaluate((p) => { window.kinetic.goto(2); window.kinetic.freezeTransition(p); }, raw);
    await fresh.waitForTimeout(100);
    const st = await fresh.evaluate(() => window.kinetic.state());
    expect(st.transition).toEqual({ from: 1, to: 2 });
    const mine = await fresh.screenshot();
    const mineBoundary = pushBoundary(decode(mine));
    await fresh.close();

    const r = compareCaptures('spike-1-2', live, mine, []);
    console.log(`spike-1-2 live boundary column ${boundary} of 960 (content moved left ${((eased) * 1920).toFixed(0)} slide px, eased progress ${eased.toFixed(3)}, raw ${raw.toFixed(3)}, about ${(raw * 500).toFixed(0)} ms of 500); new frozen boundary ${mineBoundary}; mismatch ratio ${r.ratio.toFixed(5)} (${r.mismatched} of ${r.unmasked} pixels), tolerance ${toleranceFor('spike-1-2')}`);
    expect(Math.abs(mineBoundary - boundary)).toBeLessThanOrEqual(2);
    expect(r.ratio).toBeLessThan(toleranceFor('spike-1-2'));
  });
});

test.describe('all slides at their final build state', () => {
  for (let n = 1; n <= SLIDE_COUNT; n++) {
    test(`slide ${n}`, async ({ page, browser }) => {
      // room for one retry of the live side
      test.setTimeout(360000);
      const count = frameCount(n);
      const { presses, frames: liveFrames, retried } = await liveSide(page, browser, n, count);
      const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
      await newFinalState(fresh, n);
      const newFrames = await frames(fresh, FRAME_GAP_MS, count);
      const glyphs = await glyphRegion(fresh, n);
      await fresh.close();

      const r = compareFinal(String(n), n, liveFrames, newFrames, glyphs);
      const tolerance = toleranceFor(String(n));
      const entry = {
        ratio: Math.round(r.ratio * 1e6) / 1e6,
        mismatched: r.mismatched,
        unmasked: r.unmasked,
        rule: r.rule,
        ...(r.unmaskedRatio !== null ? { unmaskedRatio: Math.round(r.unmaskedRatio * 1e6) / 1e6 } : {}),
        maskedFraction: Math.round(r.maskedFraction * 1000) / 1000,
        videoRegions: r.regions.map((x) => Math.round(x.ratio * 1000) / 1000),
        text: textSummary(r),
        presses,
        frames: count,
        tolerance,
        pass: r.ratio < tolerance,
        ...(retried ? { liveRetried: true } : {}),
        ...(REFERENCE[String(n)] ? { reference: REFERENCE[String(n)].ratio } : {}),
      };
      recordRatio(String(n), entry);
      console.log(`slide ${n}: ${r.rule}, mismatch ratio ${r.ratio.toFixed(5)} (${r.mismatched} of ${r.unmasked} pixels, mask ${(r.maskedFraction * 100).toFixed(1)} percent${r.unmaskedRatio !== null ? `, unmasked ${r.unmaskedRatio.toFixed(5)}` : ''}), ${presses} ArrowRight, tolerance ${tolerance}; text boxes compared ${entry.text.boxesCompared} of ${entry.text.boxes}, text pixels ${entry.text.mismatched} of ${entry.text.compared} mismatched (${entry.text.ratio})`);
      // a ratio over zero compared pixels passes vacuously: a wholly masked final state must fall to the
      // animated-pixels-masked rule, and that rule must leave pixels to compare
      expect(r.unmasked).toBeGreaterThan(0);
      // every text element with a visible box has at least one compared pixel (D-019 F-02, D-020 CP3-F2)
      for (const t of r.text) expect(t.compared, `text ${t.id} of slide ${n} is compared`).toBeGreaterThan(0);
      expect(r.ratio).toBeLessThan(tolerance);
    });
  }
});

test.describe('word build (Q-007)', () => {
  // Slide 21, `apple:keyboard` (unit character): eight one-character text elements (P U T U M E N T), each
  // revealed at its own offset (Build.offsets) inside one automatic step. The capture is the final state,
  // asserted under the default, and a mid-build frame on both sides where some but not all units show
  // (D-020 CP3-F3, D-019 F-05). A unit counts as shown when its box holds at least half the fill-coloured
  // pixels it holds in the final state; only the target boxes are read, never the video or other text.
  const N = 21;
  const MID = 1.43; // seconds after the build begins: between the third offset (1.309) and the fourth (1.556)

  /** The target units of the keyboard build: { id, box (960x540), fill }. */
  function units(build) {
    const s = slideByIndex(N);
    return build.targets.map((id) => {
      const e = s.elements.find((x) => x.id === id);
      const sx = 960 / DECK.width;
      const sy = 540 / DECK.height;
      const x0 = Math.max(0, Math.floor(e.box.x * sx));
      const y0 = Math.max(0, Math.floor(e.box.y * sy));
      const x1 = Math.min(960, Math.ceil((e.box.x + e.box.w) * sx));
      const y1 = Math.min(540, Math.ceil((e.box.y + e.box.h) * sy));
      return { id, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, fill: e.fill };
    });
  }

  /** Pixels within 48 of `hex` on each channel inside `box` of a decoded frame. */
  function fillPixels(png, box, hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    let n = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const i = (y * png.width + x) * 4;
        if (Math.abs(png.data[i] - r) <= 48 && Math.abs(png.data[i + 1] - g) <= 48 && Math.abs(png.data[i + 2] - b) <= 48) n += 1;
      }
    }
    return n;
  }

  /** How many units a frame shows, against the final frame of the same side. */
  function shown(frame, finalFrame, us) {
    const f = decode(finalFrame);
    const m = decode(frame);
    return us.map((u) => {
      const full = fillPixels(f, u.box, u.fill);
      const now = fillPixels(m, u.box, u.fill);
      return full > 0 && now >= full / 2;
    });
  }

  test('word-build: slide 21 types its characters one by one; final state and a partial mid-build frame on both sides asserted', async ({ page, browser }) => {
    const build = slideByIndex(N).builds.find((b) => b.kpf.name === 'apple:keyboard');
    expect(build).toMatchObject({ effect: 'keyboard', unit: 'character', automatic: true });
    expect(build.targets.length).toBe(8);
    const offsets = [...build.offsets].sort((a, b) => a - b);
    expect(offsets[2]).toBeLessThan(MID);
    expect(offsets[3]).toBeGreaterThan(MID);
    const us = units(build);

    // final state, both sides
    const presses = await liveFinalState(page, N);
    const count = frameCount(N);
    const liveFrames = await frames(page, FRAME_GAP_MS, count);
    const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await newFinalState(fresh, N);
    const newFrames = await frames(fresh, FRAME_GAP_MS, count);
    const r = compareFinal('word-build', N, liveFrames, newFrames, await glyphRegion(fresh, N));
    console.log(`word-build slide ${N} ${build.kpf.name} unit ${build.unit} (${build.targets.length} targets, ${build.duration} s, offsets ${build.offsets.join(',')}): ${r.rule}, mismatch ratio ${r.ratio.toFixed(5)} (${r.mismatched} of ${r.unmasked} pixels), ${presses} ArrowRight, tolerance ${toleranceFor('word-build')}`);

    // mid-build, new side: the automatic step frozen MID seconds after the keyboard build begins
    await fresh.goto('about:blank');
    await fresh.goto(PLAYER(N));
    await fresh.waitForFunction((k) => window.kinetic && window.kinetic.current() === k, N, { timeout: 60000 });
    const at = build.begin + MID;
    expect(await fresh.evaluate((t) => window.kinetic.freezeStep(t), at)).toBe(true);
    await fresh.waitForTimeout(300);
    expect(await fresh.evaluate(() => window.kinetic.state())).toMatchObject({ slide: N, done: 0, animating: true, frozen: at });
    const mineMid = await fresh.screenshot();
    await fresh.close();
    const newShown = shown(mineMid, newFrames[0], us);
    const newCount = newShown.filter(Boolean).length;
    console.log(`word-build mid-build: new side frozen at ${at.toFixed(2)} s shows ${newCount} of ${us.length} units (${newShown.map((x) => (x ? 1 : 0)).join('')})`);
    // some but not all units: a player that reveals every unit at once fails here (D-020 CP3-F3)
    expect(newCount).toBeGreaterThan(0);
    expect(newCount).toBeLessThan(us.length);

    // mid-build, live side: its build start is not observable, so a burst of frames spans the build window
    // (from the build begin to its last offset, plus a margin) and the counts are recorded per frame
    await page.goto(`${LIVE_BASE}?currentSlide=${N}`, { waitUntil: 'load' });
    await page.waitForFunction(indicatorHidden, null, { timeout: 120000 });
    const t0 = Date.now();
    await page.waitForTimeout(Math.max(0, (build.begin + offsets[0]) * 1000 - 500));
    const burst = [];
    do {
      const shot = await page.screenshot();
      burst.push({ ms: Date.now() - t0, shot });
      await page.waitForTimeout(100);
    } while (Date.now() - t0 < (build.begin + offsets[offsets.length - 1]) * 1000 + 1000);
    const liveCounts = burst.map((b) => ({ ms: b.ms, shown: shown(b.shot, liveFrames[0], us).filter(Boolean).length }));
    const partial = liveCounts.filter((c) => c.shown > 0 && c.shown < us.length);
    // the live mid frame is the partial frame whose count is nearest the new side's
    const pick = partial.length ? partial.reduce((best, c) => (Math.abs(c.shown - newShown.filter(Boolean).length) < Math.abs(best.shown - newShown.filter(Boolean).length) ? c : best)) : null;
    const liveMid = pick ? burst.find((b) => b.ms === pick.ms).shot : burst[Math.floor(burst.length / 2)].shot;
    // live against new inside the target boxes only (the video phase behind the letters is in the number)
    const outside = new Uint8Array(960 * 540).fill(1);
    for (const u of us) for (let y = u.box.y; y < u.box.y + u.box.h; y++) for (let x = u.box.x; x < u.box.x + u.box.w; x++) outside[y * 960 + x] = 0;
    const m = compareCapturesMasked('word-build-mid', liveMid, mineMid, outside);
    recordExtra('word-build', {
      slide: N, unit: build.unit, effect: build.effect, kpfName: build.kpf.name, targets: build.targets, offsets: build.offsets, rule: r.rule,
      midBuild: { frozenAt: at, newShown: newCount, newUnits: newShown, liveBurst: liveCounts, livePick: pick, liveVsNewRatio: m.ratio, asserted: 'some but not all units shown on each side' },
    });
    console.log(`word-build mid-build: live burst counts ${liveCounts.map((c) => `${c.ms}:${c.shown}`).join(' ')}; live pick ${pick ? `${pick.ms} ms, ${pick.shown} units` : 'none'}; live vs new mid inside the target boxes ${m.ratio.toFixed(5)} (recorded)`);
    expect(partial.length).toBeGreaterThan(0);
    expect(r.unmasked).toBeGreaterThan(0);
    for (const t of r.text) expect(t.compared, `text ${t.id} is compared`).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(toleranceFor('word-build'));
  });
});
