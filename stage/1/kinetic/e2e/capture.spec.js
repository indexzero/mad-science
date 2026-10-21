// Side-by-side captures: the live export and the new player at 960x540.
//   spike-4   slide 4 at its final build state (live: one ArrowRight per manual step)
//   spike-2   slide 2 after settle, video boxes masked on both sides (vacuous: the GIF layer covers the frame),
//             then its final state unmasked as spike-2-final, asserted; the video position must grow
//   spike-1-2 200 ms into the push from slide 1 to slide 2
//   1 .. 71   every slide at its final build state, video boxes masked; where the mask covers the frame the
//             final state is compared with the moving pixels of either side masked instead, and the
//             unmasked ratio is recorded beside it (the rule is recorded); ratios in captures/ratios.json
//   word-build slide 71, `apple:move in character` (unit character): the final state, asserted, and a
//             mid-build frame pair, recorded (Q-007)
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { gotoLive, advanceLive, settle, indicatorHidden, LIVE_BASE, SETTLE_MS } from './live.js';
import { compareCaptures, compareCapturesMasked, animatedMask, recordExtra, toleranceFor, videoMasks, slideByIndex, TOLERANCE, THRESHOLD, decode, pushBoundary, rawProgress, CAPTURES, DECK, FRAME_GAP_MS, animatedFrameCount, masksCoverFrame } from './compare.js';
import { stepDuration, stepIsAutomatic, lastStep } from '../player/effects.js';

const PLAYER = (n) => `player/index.html?deck=../decks/_all_docs/deck.json#${n}`;
const RATIOS = join(CAPTURES, 'ratios.json');
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
  const out = [await page.screenshot()];
  for (let i = 1; i < count; i++) {
    await page.waitForTimeout(gapMs);
    out.push(await page.screenshot());
  }
  return out;
}

/**
 * The frame count per side for slide n: 3, or where the video boxes cover the frame (the moving pixels are
 * masked instead) one frame every FRAME_GAP_MS over the slide's longest video loop.
 */
function frameCount(n) {
  return masksCoverFrame(n) ? animatedFrameCount(n) : 3;
}

/** Merge one slide's result into captures/ratios.json. */
function recordRatio(key, entry) {
  const cur = existsSync(RATIOS) ? JSON.parse(readFileSync(RATIOS, 'utf8')) : {};
  const slides = { ...(cur.slides || {}), [key]: entry };
  const ordered = Object.fromEntries(Object.keys(slides).sort((a, b) => Number(a) - Number(b)).map((k) => [k, slides[k]]));
  const out = {
    platform: 'this Mac, chromium through Playwright 1.64.1 at 960x540, pixelmatch 8.0.0 threshold 0.1',
    default: TOLERANCE.default,
    rules: {
      masked: 'video boxes masked on both sides, the rest compared',
      'animated-pixels-masked': 'the video boxes cover the frame (vacuous mask), so the final state is compared with the pixels that move on either side (frames 400 ms apart per side over the longest video loop of the slide, 3 to 32 frames, dilated 2 px) masked out; unmaskedRatio is the design rule number, the first frames compared with no mask, recorded',
    },
    slides: ordered,
  };
  writeFileSync(RATIOS, JSON.stringify(out, null, 2) + '\n');
}

/**
 * Compare a live and a new final-state capture of slide n under the design's rule: the video boxes masked.
 * When the boxes cover the frame (the vacuous case) the final state is compared with the pixels that move
 * on either side masked out (the GIF phase cannot be aligned between the two players), and the unmasked
 * ratio of the first frames is recorded beside it. `liveFrames` and `newFrames` are the frame lists of
 * `frames()`; the first frame of each is the capture. Returns the result with `rule` set.
 */
function compareFinal(name, n, liveFrames, newFrames) {
  const live = liveFrames[0];
  const mine = newFrames[0];
  const masks = videoMasks(n, 960, 540);
  let r = compareCaptures(name, live, mine, masks);
  let rule = 'masked';
  let unmaskedRatio = null;
  if (r.vacuous) {
    const u = compareCaptures(name, live, mine, []);
    unmaskedRatio = u.ratio;
    r = compareCapturesMasked(name, live, mine, animatedMask(liveFrames, newFrames, 960, 540));
    rule = 'animated-pixels-masked';
  }
  return { ...r, rule, unmaskedRatio, maskedFraction: r.masked / (960 * 540) };
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
      const presses = await liveFinalState(page, n);
      const count = frameCount(n);
      const liveFrames = await frames(page, FRAME_GAP_MS, count);
      const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
      await newFinalState(fresh, n);
      const newFrames = await frames(fresh, FRAME_GAP_MS, count);
      await fresh.close();

      const r = compareFinal(String(n), n, liveFrames, newFrames);
      const tolerance = toleranceFor(String(n));
      const entry = {
        ratio: Math.round(r.ratio * 1e6) / 1e6,
        mismatched: r.mismatched,
        unmasked: r.unmasked,
        rule: r.rule,
        ...(r.unmaskedRatio !== null ? { unmaskedRatio: Math.round(r.unmaskedRatio * 1e6) / 1e6 } : {}),
        maskedFraction: Math.round(r.maskedFraction * 1000) / 1000,
        videoRegions: r.regions.map((x) => Math.round(x.ratio * 1000) / 1000),
        presses,
        frames: count,
        tolerance,
        pass: r.ratio < tolerance,
      };
      recordRatio(String(n), entry);
      console.log(`slide ${n}: ${r.rule}, mismatch ratio ${r.ratio.toFixed(5)} (${r.mismatched} of ${r.unmasked} pixels, mask ${(r.maskedFraction * 100).toFixed(1)} percent${r.unmaskedRatio !== null ? `, unmasked ${r.unmaskedRatio.toFixed(5)}` : ''}), ${presses} ArrowRight, tolerance ${tolerance}`);
      // a ratio over zero compared pixels passes vacuously: a wholly masked final state must fall to the
      // animated-pixels-masked rule, and that rule must leave pixels to compare
      expect(r.unmasked).toBeGreaterThan(0);
      expect(r.ratio).toBeLessThan(tolerance);
    });
  }
});

test.describe('word build (Q-007)', () => {
  const N = 71;
  test('word-build: slide 71 moves its text in by character; final state asserted, a mid-build frame recorded', async ({ page, browser }) => {
    const build = slideByIndex(N).builds.find((b) => b.kpf.name === 'apple:move in character');
    expect(build).toMatchObject({ effect: 'move-in', unit: 'character', automatic: true });

    // final state, both sides
    const presses = await liveFinalState(page, N);
    const count = frameCount(N);
    const liveFrames = await frames(page, FRAME_GAP_MS, count);
    const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await newFinalState(fresh, N);
    const newFrames = await frames(fresh, FRAME_GAP_MS, count);
    const mine = newFrames[0];
    const r = compareFinal('word-build', N, liveFrames, newFrames);
    console.log(`word-build slide ${N} unit ${build.unit} (${build.targets.length} target, ${build.duration} s, direction ${build.direction}, stagger ${build.stagger}): ${r.rule}, mismatch ratio ${r.ratio.toFixed(5)} (${r.mismatched} of ${r.unmasked} pixels), ${presses} ArrowRight, tolerance ${toleranceFor('word-build')}`);

    // mid-build, new side: the automatic step frozen at 0.4 s of the 1 s character move-in; the frame must
    // differ from the final state (the characters are still in flight)
    await fresh.goto('about:blank');
    await fresh.goto(PLAYER(N));
    await fresh.waitForFunction((k) => window.kinetic && window.kinetic.current() === k, N, { timeout: 60000 });
    const frozen = await fresh.evaluate(() => window.kinetic.freezeStep(0.4));
    expect(frozen).toBe(true);
    await fresh.waitForTimeout(300);
    expect(await fresh.evaluate(() => window.kinetic.state())).toMatchObject({ slide: N, done: 0, animating: true, frozen: 0.4 });
    const mineMid = await fresh.screenshot();
    await fresh.close();
    const finalPng = decode(mine);
    const midPng = decode(mineMid);
    const moved = pixelmatch(finalPng.data, midPng.data, null, 960, 540, { threshold: THRESHOLD });
    expect(moved).toBeGreaterThan(1000);

    // mid-build, live side: the frame about 400 ms after the slide shows (best effort; the live player's
    // start of an automatic build is not observable), recorded against the new frozen frame
    await page.goto(`${LIVE_BASE}?currentSlide=${N}`, { waitUntil: 'load' });
    await page.waitForFunction(indicatorHidden, null, { timeout: 120000 });
    await page.waitForTimeout(400);
    const liveMid = await page.screenshot();
    const m = compareCaptures('word-build-mid', liveMid, mineMid, videoMasks(N, 960, 540));
    recordExtra('word-build', { slide: N, unit: build.unit, effect: build.effect, kpfName: build.kpf.name, targets: build.targets, stagger: build.stagger ?? null, rule: r.rule, midBuild: { frozenAt: 0.4, pixelsMovedVsFinal: moved, liveVsNewRatio: m.ratio, asserted: false } });
    console.log(`word-build mid-build frame at 0.4 s: ${moved} pixels differ from the final state on the new side; live vs new ${m.ratio.toFixed(5)} (recorded, not asserted)`);
    expect(r.unmasked).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(toleranceFor('word-build'));
  });
});
