// The three spike captures: live export and new player side by side at 960x540.
//   spike-4   slide 4 at its final build state (live: one ArrowRight per manual step)
//   spike-2   slide 2 after settle, video boxes masked on both sides (vacuous: the GIF layer covers the frame),
//             then its final state unmasked as spike-2-final, asserted; the video position must grow
//   spike-1-2 200 ms into the push from slide 1 to slide 2
import { test, expect } from '@playwright/test';
import { gotoLive, advanceLive, SETTLE_MS } from './live.js';
import { compareCaptures, recordExtra, toleranceFor, videoMasks, slideByIndex, TOLERANCE, decode, pushBoundary, rawProgress, EASE_PUSH } from './compare.js';

const PLAYER = (n) => `player/index.html?deck=../decks/_all_docs/deck.json#${n}`;

/** Open the new player on slide n and wait for its first frame and its automatic steps. */
async function openNew(page, n) {
  await page.goto(PLAYER(n));
  await page.waitForFunction((k) => window.kinetic && window.kinetic.current() === k, n, { timeout: 60000 });
  await waitIdle(page);
}

async function waitIdle(page) {
  await page.waitForFunction(() => !window.kinetic.state().animating && !window.kinetic.state().transition, null, { timeout: 30000 });
}

function manualSteps(n) {
  const s = slideByIndex(n);
  const steps = new Set(s.builds.filter((b) => !b.automatic).map((b) => b.step));
  return steps.size;
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
