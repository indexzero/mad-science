// Exploratory run: load the page in each browser and dump window.__poc.
// This is how the probes were first looked at, before tests/ asserted them.
//   node scripts/explore.ts [chromium|firefox|webkit ...]
// Firefox runs as the system Firefox over WebDriver BiDi (channel
// moz-firefox) unless PW_FIREFOX_CHANNEL=bundled. See README "Open issues".
import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { start } from '../src/server.ts';

const all: Record<string, [BrowserType, object]> = {
  chromium: [chromium, {}],
  firefox: [
    firefox,
    process.env.PW_FIREFOX_CHANNEL === 'bundled' ? {} : { channel: 'moz-firefox' }
  ],
  webkit: [webkit, {}]
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(all);

const { server, url } = await start(0);
try {
  for (const name of names) {
    const [type, options] = all[name];
    const browser = await type.launch(options);
    const page = await browser.newPage();
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
    await page.goto(url);
    await page
      .waitForFunction(() => (window as any).__pocDone === true, null, { timeout: 60_000 })
      .catch(() => consoleLines.push('TIMEOUT waiting for __pocDone'));
    const report = await page.evaluate(() => (window as any).__poc);
    console.log(`===== ${name} ${browser.version()}`);
    console.log(JSON.stringify(report, null, 2));
    console.log('console:', consoleLines);
    await browser.close();
  }
} finally {
  server.close();
}
