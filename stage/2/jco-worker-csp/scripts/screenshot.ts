// Exploratory: screenshots of all 4 pages, and of page 4 with both panels
// open, in light and dark, at 1280x800 and 390x844. Also prints the
// document scroll height per shot, which must not exceed the viewport.
//   node scripts/screenshot.ts [chromium|firefox|webkit] [outdir]
import { chromium, firefox, webkit } from '@playwright/test';
import { start } from '../src/server.ts';

const name = process.argv[2] ?? 'chromium';
const outdir = process.argv[3] ?? 'screenshots'; // not test-results/: Playwright clears that on every run
const type = { chromium, firefox, webkit }[name]!;
const options =
  name === 'firefox' && process.env.PW_FIREFOX_CHANNEL !== 'bundled' ? { channel: 'moz-firefox' } : {};
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 }
];

const { server, url } = await start(0);
const browser = await type.launch(options);
try {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of SIZES) {
      const page = await browser.newPage({ colorScheme, viewport });
      await page.goto(url);
      await page.waitForFunction(() => (window as any).__pocDone === true);
      const shot = async (label: string) => {
        await page.waitForTimeout(900); // let the flash fade
        const file = `${outdir}/${name}-${colorScheme}-${viewport.width}x${viewport.height}-${label}.png`;
        await page.screenshot({ path: file });
        const sh = await page.evaluate(() => document.scrollingElement!.scrollHeight);
        console.log(`${file}  scrollHeight=${sh} innerHeight=${viewport.height}${sh > viewport.height ? '  OVERFLOW' : ''}`);
      };
      for (let p = 1; p <= 4; p++) {
        await shot(`page${p}`);
        if (p < 4) await page.click('#next');
      }
      await page.click('#toggle-devtools');
      await page.click('#ping-btn');
      await page.click('#toggle-citations');
      await shot('panels');
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
