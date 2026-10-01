// Write a PNG of every diagram in out/index.html, at 2x for legibility.
// Uses Playwright's Chromium if installed (`pnpm browsers`), else system Chrome.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { OUT } from './lib.mjs';

async function launch() {
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  if (channel) return chromium.launch({ channel });
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: 'chrome' });
  }
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(OUT, 'index.html')).href);

  const shoot = async (locator, file) => {
    await locator.screenshot({ path: join(OUT, file) });
    console.log(`wrote out/${file}`);
  };
  await shoot(page.locator('body > svg').first(), 'parallel-sets.png');
  // Same order as index-page.mjs, so the nth figure is the nth file.
  const names = readdirSync(OUT).filter((f) => f.startsWith('heatmap.') && f.endsWith('.html')).sort();
  const heatmaps = page.locator('.multiples > figure');
  for (const [i, name] of names.entries()) {
    await shoot(heatmaps.nth(i), name.replace(/\.html$/, '.png'));
  }
  await shoot(page.locator('body > img'), 'sovereignty.png');
} finally {
  await browser.close();
}
