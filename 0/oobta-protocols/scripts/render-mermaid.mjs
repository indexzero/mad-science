// Render out/sovereignty.mmd to SVG in a headless browser with Playwright.
// Uses Playwright's Chromium if installed (`pnpm browsers`), else system Chrome.
// PLAYWRIGHT_CHANNEL forces a channel, e.g. "chrome" or "msedge".
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { INK, OUT, write } from './lib.mjs';

const require = createRequire(import.meta.url);
const mermaidJs = readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
const source = readFileSync(join(OUT, 'sovereignty.mmd'), 'utf8');

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
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><body style="background:${INK.surface}"></body>`);
  await page.addScriptTag({ content: mermaidJs });
  const svg = await page.evaluate(async ({ text, inkSurface, inkPrimary }) => {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: 'basis' },
      themeCSS: `.edgeLabel rect, .labelBkg { fill: ${inkSurface} !important; opacity: 1 !important; }`,
      themeVariables: {
        background: inkSurface,
        edgeLabelBackground: inkSurface,
        lineColor: inkPrimary,
        textColor: inkPrimary,
      },
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    });
    const { svg } = await window.mermaid.render('sovereignty', text);
    return svg;
  }, { text: source, inkSurface: INK.surface, inkPrimary: INK.primary });
  write('sovereignty.svg', svg);
} finally {
  await browser.close();
}
