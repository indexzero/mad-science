// Benchmark for REPORT-1.md (design, Performance analysis): slide 2 with the 7.8 MB GIF.
//   live: ms from the ?currentSlide=2 navigation to the first video frame (the GIF <img> decoded) and to
//         the waiting indicator hiding
//   new:  ms from goto(2) to the first drawn frame of slide 2 with slide 2 preloaded (a jump from slide 3,
//         whose preload holds 4, 5, and 2; no transition), and the same through the push from slide 1
// Writes e2e/captures/spike-bench.json.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_BASE } from './live.js';
import { CAPTURES } from './compare.js';

const PLAYER = (n) => `player/index.html?deck=../decks/_all_docs/deck.json#${n}`;

test('spike benchmark: slide 2 first video frame, live and new', async ({ page, browser }) => {
  await page.goto(`${LIVE_BASE}?currentSlide=2`, { waitUntil: 'commit' });
  const live = await page.evaluate(async () => {
    const t0 = performance.timeOrigin;
    const until = (fn) => new Promise((resolve) => { const tick = () => (fn() ? resolve(performance.now()) : requestAnimationFrame(tick)); tick(); });
    const img = await until(() => [...document.images].some((i) => /\.gif/i.test(i.src) && i.complete && i.naturalWidth > 0));
    const hid = await until(() => { const e = document.getElementById('waitingIndicator'); return e && getComputedStyle(e).display === 'none'; });
    return { navigationToGifDecoded: Math.round(img), navigationToIndicatorHidden: Math.round(hid), timeOrigin: t0 };
  });

  const fresh = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await fresh.goto(PLAYER(3));
  await fresh.waitForFunction(() => window.kinetic && window.kinetic.current() === 3 && window.kinetic.isReady(2), null, { timeout: 60000 });
  const jump = await fresh.evaluate(async () => {
    const t0 = performance.now();
    await window.kinetic.goto(2);
    return performance.now() - t0;
  });
  // a hash-only change is a same-document navigation; leave the page first so the player reloads
  await fresh.goto('about:blank');
  await fresh.goto(PLAYER(1));
  await fresh.waitForFunction(() => window.kinetic && window.kinetic.current() === 1 && window.kinetic.isReady(2), null, { timeout: 60000 });
  const push = await fresh.evaluate(async () => {
    const t0 = performance.now();
    await window.kinetic.goto(2);
    const first = performance.now() - t0;
    await new Promise((r) => { const tick = () => (window.kinetic.state().transition ? requestAnimationFrame(tick) : r()); tick(); });
    return { firstFrame: first, landed: performance.now() - t0 };
  });
  const frames = await fresh.evaluate(() => window.kinetic.frameTimes());
  await fresh.close();

  const result = {
    live: { navigationToGifDecodedMs: live.navigationToGifDecoded, navigationToIndicatorHiddenMs: live.navigationToIndicatorHidden },
    new: { gotoToFirstFrameMs: Math.round(jump * 100) / 100, pushFirstFrameMs: Math.round(push.firstFrame * 100) / 100, pushLandedMs: Math.round(push.landed), maxFrameDeltaMs: Math.round(Math.max(...frames) * 10) / 10 },
  };
  mkdirSync(CAPTURES, { recursive: true });
  writeFileSync(join(CAPTURES, 'spike-bench.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('spike benchmark ' + JSON.stringify(result));
  expect(result.new.gotoToFirstFrameMs).toBeLessThan(200);
});
