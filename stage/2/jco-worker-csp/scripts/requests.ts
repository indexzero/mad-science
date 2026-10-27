// Exploratory: every network request Playwright sees (page and worker),
// to check that nothing leaves the origin.
//   node scripts/requests.ts [chromium|firefox|webkit]
import { chromium, firefox, webkit } from '@playwright/test';
import { start } from '../src/server.ts';

const name = process.argv[2] ?? 'chromium';
const type = { chromium, firefox, webkit }[name]!;
const options = name === 'firefox' ? { channel: 'moz-firefox' } : {};
const { server, url } = await start(0);
const browser = await type.launch(options);
const context = await browser.newContext();
const seen: string[] = [];
context.on('request', (r) => seen.push(`request  ${r.method()} ${r.url().slice(0, 90)}`));
context.on('requestfailed', (r) => seen.push(`failed   ${r.url().slice(0, 90)} ${r.failure()?.errorText}`));
const page = await context.newPage();
await page.goto(url);
await page.waitForFunction(() => (window as any).__pocDone === true);
for (const s of seen) if (!s.includes(url) || s.startsWith('failed')) console.log(s);
console.log(`${seen.length} events, ${seen.filter((s) => !s.includes(url)).length} not same-origin`);
await browser.close();
server.close();
