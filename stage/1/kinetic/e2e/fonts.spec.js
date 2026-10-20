// No request whose path ends in a font extension while the new player plays the three spike slides.
import { test, expect } from '@playwright/test';

const FONT_RE = /\.(ttf|otf|woff|woff2)(\?.*)?$/i;

test('spike fonts: the new player requests no font file on slides 1, 2, 4', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto('player/index.html?deck=../decks/_all_docs/deck.json#1');
  await page.waitForFunction(() => window.kinetic && window.kinetic.current() === 1, null, { timeout: 60000 });
  for (const n of [2, 4]) {
    await page.evaluate((k) => window.kinetic.goto(k), n);
    await page.waitForFunction((k) => window.kinetic.current() === k && !window.kinetic.state().transition, n, { timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  const fonts = requests.filter((p) => FONT_RE.test(p));
  console.log(`spike fonts: ${requests.length} requests, ${fonts.length} font requests`);
  expect(fonts).toEqual([]);
  expect(requests.length).toBeGreaterThan(5);
});
