// Exploratory check: Playwright's bundled Firefox (firefox-1555, Firefox 157)
// exits at once on this host with "Could not find profile folder", even
// outside the tool sandbox. The system Firefox over WebDriver BiDi works.
//   node scripts/firefox-bidi-check.ts            # system Firefox (BiDi)
//   node scripts/firefox-bidi-check.ts bundled    # Playwright's Firefox
import { firefox } from '@playwright/test';

const bundled = process.argv[2] === 'bundled';
const browser = await firefox.launch(bundled ? {} : { channel: 'moz-firefox', timeout: 60_000 });
const page = await browser.newPage();
await page.goto('data:text/html,<h1>hi</h1>');
console.log(bundled ? 'bundled' : 'moz-firefox', browser.version(), await page.textContent('h1'));
await browser.close();
