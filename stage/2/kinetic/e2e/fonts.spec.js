// No request whose path ends in a font extension while the new player plays every slide.
import { test, expect } from '@playwright/test';
import { DECK } from './compare.js';

const FONT_RE = /\.(ttf|otf|woff|woff2)(\?.*)?$/i;
const SLIDE_COUNT = DECK.slides.length;

test('fonts: the new player requests no font file while it plays all 71 slides', async ({ page }) => {
  test.setTimeout(10 * 60000);
  const requests = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto('player/index.html?deck=../decks/_all_docs/deck.json#1');
  await page.waitForFunction(() => window.kinetic && window.kinetic.current() === 1, null, { timeout: 60000 });
  for (let n = 2; n <= SLIDE_COUNT; n++) {
    await page.evaluate((k) => window.kinetic.goto(k), n);
    await page.waitForFunction((k) => window.kinetic.current() === k && !window.kinetic.state().transition, n, { timeout: 60000 });
    // let the automatic steps of the slide play, with a ceiling so the long typewriter slides do not dominate
    await page.waitForFunction(() => !window.kinetic.state().animating, null, { timeout: 4000 }).catch(() => {});
  }
  expect(await page.evaluate(() => window.kinetic.current())).toBe(SLIDE_COUNT);
  const fonts = requests.filter((p) => FONT_RE.test(p));
  console.log(`fonts: ${requests.length} requests over ${SLIDE_COUNT} slides, ${fonts.length} font requests`);
  expect(fonts).toEqual([]);
  expect(requests.length).toBeGreaterThan(100);
});
