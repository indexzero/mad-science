// Preload under network throttling (design, Playwright suite): CDP Network.emulateNetworkConditions at
// 1.5 Mbit/s down, 750 kbit/s up, 150 ms latency. For n in 1..69 `preloaded()` must hold n+1 and n+2 within
// 10 s of goto(n); for n = 70 it must hold 71. After each goto(n+1) no frame delta over 50 ms in the 30
// frames after the change. The throttle is on before the player loads, so the time to the first slide
// (deck.json plus slide 1) is measured too.
//
// The 10 s bar is a byte bar at this throttle: 1.5 Mbit/s moves 1,875,000 bytes in 10 s, and every round of
// six requests (chromium's connections per host) pays the 150 ms latency once. Where the media still to
// fetch when goto(n) resolves (n+1 is normally there already, as the n+2 of the previous slide) needs more
// than 10 s by that floor, the bar cannot be met by any player; the spec records the slide as a waiver and
// asserts the floor plus the design bar instead. REPORT-1.md lists every waiver; the supervisor decides.
import { test, expect } from '@playwright/test';
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURES, DECK, here } from './compare.js';

const PLAYER = (n) => `player/index.html?deck=../decks/_all_docs/deck.json#${n}`;
export const DOWNLOAD_BPS = 1.5e6 / 8;
export const UPLOAD_BPS = 750e3 / 8;
export const LATENCY_MS = 150;
export const PRELOAD_BAR_MS = 10000;
export const FRAME_BAR_MS = 50;
export const FRAMES_AFTER_CHANGE = 30;
const SLIDE_COUNT = DECK.slides.length;
const DECK_DIR = join(here, '..', 'decks', '_all_docs');

export const CONNECTIONS_PER_HOST = 6; // chromium serializes more requests than this to one host

/** The media the player fetches for slide n: { bytes, requests } over distinct image sources, the WebM of each video (chromium picks VP9), each poster. */
export function mediaOf(n) {
  const slide = DECK.slides.find((s) => s.index === n);
  const seen = new Set();
  let bytes = 0;
  const add = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    bytes += statSync(join(DECK_DIR, rel)).size;
  };
  for (const el of slide.elements) {
    if (el.kind === 'image') add(el.src);
    else if (el.kind === 'video') { add(el.src.webm); add(el.poster); }
  }
  return { bytes, requests: seen.size };
}

export function bytesOf(n) {
  return mediaOf(n).bytes;
}

/** The transfer floor in ms for a set of slides: their bytes at the throttle plus one latency per round of requests. */
export function floorOf(slides) {
  let bytes = 0;
  let requests = 0;
  for (const n of slides) { const m = mediaOf(n); bytes += m.bytes; requests += m.requests; }
  return { bytes, requests, floorMs: Math.round((bytes / DOWNLOAD_BPS) * 1000 + Math.ceil(requests / CONNECTIONS_PER_HOST) * LATENCY_MS) };
}

test('preload under throttling: n+1 and n+2 within the bar, no frame over 50 ms after a change', async ({ page }) => {
  test.setTimeout(45 * 60000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY_MS, downloadThroughput: DOWNLOAD_BPS, uploadThroughput: UPLOAD_BPS });

  const deckBytes = statSync(join(DECK_DIR, 'deck.json')).size;
  const tStart = Date.now();
  await page.goto(PLAYER(1));
  await page.waitForFunction(() => window.kinetic && window.kinetic.current() === 1, null, { timeout: 10 * 60000 });
  const firstSlideMs = Date.now() - tStart;
  const videoType = await page.evaluate(() => window.kinetic.videoType());
  console.log(`preload: first slide drawn ${firstSlideMs} ms after navigation under the throttle (deck.json ${deckBytes} bytes, floor ${Math.round((deckBytes / DOWNLOAD_BPS) * 1000)} ms); video type ${videoType}`);

  const rows = [];
  const failures = [];
  let gotoResolvedAt = Date.now();
  for (let n = 1; n <= SLIDE_COUNT; n++) {
    const need = [n + 1, n + 2].filter((k) => k <= SLIDE_COUNT);
    const already = await page.evaluate(() => window.kinetic.preloaded());
    const pending = need.filter((k) => !already.includes(k));
    const { bytes, requests, floorMs } = floorOf(pending);
    const waived = floorMs > PRELOAD_BAR_MS;
    const barMs = waived ? floorMs + PRELOAD_BAR_MS : PRELOAD_BAR_MS;
    const row = { n, need, pending, bytes, requests, floorMs, barMs, waived, preloadMs: null, maxFrameMs: null, frames: null };
    if (need.length) {
      const remaining = Math.max(1000, barMs - (Date.now() - gotoResolvedAt));
      try {
        await page.waitForFunction((k) => k.every((x) => window.kinetic.preloaded().includes(x)), need, { timeout: remaining, polling: 50 });
      } catch {
        failures.push(`slide ${n}: ${need.join(' and ')} not preloaded within ${barMs} ms (floor ${floorMs} ms for ${bytes} bytes)`);
      }
      row.preloadMs = Date.now() - gotoResolvedAt;
      if (row.preloadMs > barMs) failures.push(`slide ${n}: preload took ${row.preloadMs} ms, bar ${barMs} ms`);
    }
    if (n < SLIDE_COUNT) {
      const r = await page.evaluate(async ({ k, count }) => {
        await window.kinetic.goto(k);
        const t0 = performance.now();
        await new Promise((res) => { let c = 0; const tick = () => (++c >= count ? res() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
        return { deltas: window.kinetic.frameTimes().slice(-count), waitedMs: performance.now() - t0 };
      }, { k: n + 1, count: FRAMES_AFTER_CHANGE });
      gotoResolvedAt = Date.now() - Math.round(r.waitedMs);
      row.maxFrameMs = Math.round(Math.max(...r.deltas) * 10) / 10;
      row.frames = r.deltas.map((d) => Math.round(d * 10) / 10);
      if (row.maxFrameMs > FRAME_BAR_MS) failures.push(`slide ${n} to ${n + 1}: frame delta ${row.maxFrameMs} ms over ${FRAME_BAR_MS}`);
    }
    rows.push(row);
    console.log(`preload n=${n}: ${need.length ? `${need.join(',')} ready in ${row.preloadMs} ms (pending ${pending.join(',') || 'none'}, ${bytes} bytes in ${requests} requests, floor ${floorMs} ms, bar ${barMs} ms${waived ? ', WAIVER' : ''})` : 'nothing to preload'}${row.maxFrameMs !== null ? `; max frame delta after goto(${n + 1}) ${row.maxFrameMs} ms` : ''}`);
  }

  const measured = rows.filter((r) => r.preloadMs !== null);
  const slowest = measured.reduce((m, r) => (r.preloadMs > m.preloadMs ? r : m), measured[0]);
  const slowestInBar = measured.filter((r) => !r.waived).reduce((m, r) => (r.preloadMs > (m?.preloadMs ?? -1) ? r : m), null);
  const frameRows = rows.filter((r) => r.maxFrameMs !== null);
  const largestFrame = frameRows.reduce((m, r) => (r.maxFrameMs > m.maxFrameMs ? r : m), frameRows[0]);
  const result = {
    throttle: { downloadBps: DOWNLOAD_BPS, uploadBps: UPLOAD_BPS, latencyMs: LATENCY_MS },
    bars: { preloadMs: PRELOAD_BAR_MS, frameMs: FRAME_BAR_MS, framesAfterChange: FRAMES_AFTER_CHANGE },
    videoType,
    deckBytes,
    firstSlideMs,
    slowestPreload: { n: slowest.n, preloadMs: slowest.preloadMs, bytes: slowest.bytes, floorMs: slowest.floorMs, waived: slowest.waived },
    slowestPreloadWithinBar: slowestInBar ? { n: slowestInBar.n, preloadMs: slowestInBar.preloadMs, bytes: slowestInBar.bytes } : null,
    largestFrameDelta: { n: largestFrame.n, to: largestFrame.n + 1, maxFrameMs: largestFrame.maxFrameMs },
    waivers: rows.filter((r) => r.waived).map((r) => ({ n: r.n, pending: r.pending, bytes: r.bytes, requests: r.requests, floorMs: r.floorMs, barMs: r.barMs, preloadMs: r.preloadMs })),
    failures,
    rows: rows.map(({ frames, ...r }) => r),
  };
  mkdirSync(CAPTURES, { recursive: true });
  writeFileSync(join(CAPTURES, 'preload.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`preload summary: slowest ${slowest.n} at ${slowest.preloadMs} ms (${slowest.waived ? 'waived, ' : ''}${slowest.bytes} bytes); slowest within the 10 s bar ${slowestInBar ? `${slowestInBar.n} at ${slowestInBar.preloadMs} ms` : 'none'}; largest frame delta ${largestFrame.maxFrameMs} ms on ${largestFrame.n} to ${largestFrame.n + 1}; ${result.waivers.length} waiver(s); ${failures.length} failure(s)`);
  expect(failures).toEqual([]);
});

/** The media paths of slide n relative to deck.json: image sources, both video sources, posters. */
function mediaPaths(n) {
  const slide = DECK.slides.find((s) => s.index === n);
  const out = new Set();
  for (const el of slide.elements) {
    if (el.kind === 'image') out.add(el.src);
    else if (el.kind === 'video') { out.add(el.src.webm); out.add(el.src.mp4); out.add(el.poster); }
  }
  return out;
}

// D-021: goto(n) starts loads of n+1, n+2, n-1 and then evicts outside [n-1, n+2]. When n-1 is slow and the
// next goto(n+1) has already loaded n+3, the eviction of the older window must not drop n+3. The media of
// slide 37 that slides 38 to 41 do not share is held back 4 s, so the preload of goto(38) ends after the
// preload of goto(39) has loaded slide 41.
test('preload: a slow older preload never evicts the newer window', async ({ page }) => {
  const N = 38;
  const keep = new Set([N, N + 1, N + 2, N + 3].flatMap((k) => [...mediaPaths(k)]));
  const slow = [...mediaPaths(N - 1)].filter((p) => !keep.has(p));
  expect(slow.length).toBeGreaterThan(0);
  let held = 0;
  let released = 0;
  await page.route((url) => slow.some((p) => url.pathname.endsWith(`/decks/_all_docs/${p}`)), async (route) => {
    held += 1;
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
    released += 1;
  });
  await page.goto(PLAYER(N));
  await page.waitForFunction((k) => window.kinetic && window.kinetic.current() === k, N, { timeout: 60000 });
  await page.waitForFunction((k) => [k + 1, k + 2].every((x) => window.kinetic.preloaded().includes(x)), N, { timeout: 30000 });
  await page.evaluate((k) => window.kinetic.goto(k), N + 1);
  await page.waitForFunction((k) => [k + 1, k + 2].every((x) => window.kinetic.preloaded().includes(x)), N + 1, { timeout: 30000 });
  // the held media of slide N - 1 lands now and the preload of goto(N) finishes
  await expect.poll(() => held > 0 && released === held, { timeout: 30000 }).toBe(true);
  await page.waitForTimeout(1000);
  const preloaded = await page.evaluate(() => window.kinetic.preloaded());
  console.log(`preload race: ${held} held requests of slide ${N - 1}; preloaded after the older preload ended: ${preloaded.join(',')}`);
  expect(held).toBeGreaterThan(0);
  expect(preloaded).toEqual(expect.arrayContaining([N, N + 1, N + 2, N + 3]));
});
