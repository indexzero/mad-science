// Layout checks, in each browser: 4 pages, the diagram, the two panels,
// no document scroll at 1280x800 and 390x844, the words on the page, the
// citations, and no request that leaves the origin.
import { expect, test, type Page } from '@playwright/test';

const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 }
];

/** What the diagram must highlight (.hl) and mark refused (.refused), per page. */
const DIAGRAM: Record<number, { hl: string[]; refused: string[]; noteRefused: number }> = {
  1: { hl: ['glue', 'guest'], refused: [], noteRefused: 0 },
  2: { hl: [], refused: ['glue', 'page-in'], noteRefused: 1 },
  3: {
    hl: ['glue', 'glue-guest', 'guest', 'guest-log', 'loader', 'loader-worker', 'log', 'worker', 'worker-glue'],
    refused: [],
    noteRefused: 0
  },
  4: { hl: ['page-out', 'postMessage', 'postmessage-page'], refused: [], noteRefused: 4 }
};

async function load(page: Page) {
  await page.goto(process.env.POC_URL!);
  await page.waitForFunction(() => (window as any).__pocDone === true, null, { timeout: 45_000 });
}

async function diagramState(page: Page) {
  return page.evaluate(() => {
    const names = (sel: string) =>
      [...new Set([...document.querySelectorAll(sel)].map((n) => (n as HTMLElement).dataset.node ?? (n as HTMLElement).dataset.edge))].sort();
    return {
      hl: names('#diagram [data-node].hl, #diagram [data-edge].hl'),
      refused: names('#diagram [data-node].refused, #diagram [data-edge].refused'),
      noteRefused: document.querySelectorAll('#diagram-note .refused').length
    };
  });
}

async function visiblePage(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.page')].filter((s) => !(s as HTMLElement).hidden).map((s) => (s as HTMLElement).dataset.page)
  );
}

test('pages: buttons and arrow keys walk all 4; the diagram follows', async ({ page }) => {
  await load(page);
  const seen: string[] = [];
  for (let n = 1; n <= 4; n++) {
    expect(await page.textContent('#page-no')).toBe(`${n}/4`);
    expect(await visiblePage(page)).toEqual([String(n)]);
    const d = await diagramState(page);
    expect(d, `diagram on page ${n}`).toEqual(DIAGRAM[n]);
    seen.push(JSON.stringify(d));
    if (n < 4) await page.keyboard.press('ArrowRight');
  }
  expect(new Set(seen).size, 'each page highlights something different').toBe(4);
  expect(await page.isDisabled('#next')).toBe(true);
  await page.keyboard.press('ArrowRight'); // stays on 4
  expect(await page.textContent('#page-no')).toBe('4/4');
  for (let n = 3; n >= 1; n--) {
    await page.keyboard.press('ArrowLeft');
    expect(await page.textContent('#page-no')).toBe(`${n}/4`);
  }
  expect(await page.isDisabled('#prev')).toBe(true);
  for (let n = 2; n <= 4; n++) {
    await page.click('#next');
    expect(await page.textContent('#page-no')).toBe(`${n}/4`);
    expect(await diagramState(page)).toEqual(DIAGRAM[n]);
  }
  for (let n = 3; n >= 1; n--) {
    await page.click('#prev');
    expect(await page.textContent('#page-no')).toBe(`${n}/4`);
  }
  // Arrow keys inside a text input move the caret, not the page.
  await page.click('#next');
  await page.click('#next');
  await page.focus('#live');
  await page.keyboard.press('ArrowLeft');
  expect(await page.textContent('#page-no')).toBe('3/4');
});

test('panels: devtools and citations toggle; citations sit below devtools', async ({ page }) => {
  await load(page);
  await expect(page.locator('#devtools')).toBeHidden();
  await expect(page.locator('#citations')).toBeHidden();

  await page.click('#toggle-devtools');
  await expect(page.locator('#devtools')).toBeVisible();
  await expect(page.locator('#toggle-devtools')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#devtools h2')).toHaveText(['postMessage (ONE PING ONLY)', 'BUNDLE STATS']);
  await expect(page.locator('#numbers')).toContainText('Prism 1.30.0');
  await expect(page.locator('#numbers')).toContainText('12,780 B');
  await expect(page.locator('#numbers')).toContainText('core 7,461 + clike 708 + javascript 4,611');

  await page.click('#toggle-citations');
  await expect(page.locator('#citations')).toBeVisible();
  const dev = (await page.locator('#devtools').boundingBox())!;
  const cit = (await page.locator('#citations').boundingBox())!;
  expect(cit.y, 'citations panel starts below the devtools panel').toBeGreaterThanOrEqual(dev.y + dev.height);
  const pages = (await page.locator('#pages').boundingBox())!;
  expect(dev.y, 'panels sit under the pages').toBeGreaterThanOrEqual(pages.y + pages.height);

  await page.click('#toggle-devtools');
  await expect(page.locator('#devtools')).toBeHidden();
  await expect(page.locator('#citations')).toBeVisible();
  await page.click('#toggle-citations');
  await expect(page.locator('#citations')).toBeHidden();
  await expect(page.locator('#toggle-citations')).toHaveAttribute('aria-expanded', 'false');
});

for (const size of SIZES) {
  test(`no document scroll at ${size.width}x${size.height}, every page, panels closed and open`, async ({ page }) => {
    await page.setViewportSize(size);
    await load(page);
    const measure = () =>
      page.evaluate(() => ({
        scrollHeight: document.scrollingElement!.scrollHeight,
        scrollWidth: document.scrollingElement!.scrollWidth,
        innerHeight,
        innerWidth
      }));
    for (const panels of [false, true]) {
      if (panels) {
        await page.click('#toggle-devtools');
        await page.click('#toggle-citations');
      }
      for (let n = 1; n <= 4; n++) {
        await page.evaluate((k) => {
          while (Number(document.getElementById('page-no')!.textContent!.split('/')[0]) !== k) {
            document.getElementById(Number(document.getElementById('page-no')!.textContent!.split('/')[0]) < k ? 'next' : 'prev')!.click();
          }
        }, n);
        const m = await measure();
        const where = `page ${n}, panels ${panels ? 'open' : 'closed'}`;
        expect(m.scrollHeight, `scrollHeight <= innerHeight, ${where}`).toBeLessThanOrEqual(m.innerHeight);
        expect(m.scrollWidth, `scrollWidth <= innerWidth, ${where}`).toBeLessThanOrEqual(m.innerWidth);
      }
    }
  });
}

test('words: no stage-magic terms anywhere in the page', async ({ page }) => {
  await load(page);
  const text = await page.evaluate(() => document.documentElement.textContent ?? '');
  for (const word of [/Pledge/, /Prestige/, /\bTurn\b/, /Act /, /Under the table/]) {
    expect(text, String(word)).not.toMatch(word);
  }
  expect(text).toContain(
    'jco-worker-csp shows that JavaScript generated from a WebAssembly component can run in a Web Worker whose CSP allows it, on a page whose CSP refuses it.'
  );
  await expect(page.locator('.page h2, #pages h2')).not.toHaveCount(0);
  const titles = await page.locator('.page').evaluateAll((s) => s.map((x) => (x as HTMLElement).dataset.title));
  expect(titles).toEqual(['The component', 'Refused on the page', 'Run in the worker', 'What got out']);
});

test('citations: each link opens a new tab with noopener noreferrer and names a claim', async ({ page }) => {
  await load(page);
  const links = await page.locator('#citation-list li').evaluateAll((lis) =>
    lis.map((li) => {
      const a = li.querySelector('a')!;
      return { href: a.href, target: a.target, rel: a.rel, label: a.textContent, claim: li.textContent!.slice(a.textContent!.length) };
    })
  );
  expect(links.length).toBeGreaterThanOrEqual(16);
  for (const l of links) {
    expect(l.target, l.href).toBe('_blank');
    expect(l.rel, l.href).toBe('noopener noreferrer');
    expect(l.claim.trim().length, `claim for ${l.href}`).toBeGreaterThan(10);
  }
});

test('requests: Prism and everything else load same-origin; nothing leaves the origin', async ({ page }) => {
  const origin = new URL(process.env.POC_URL!).origin;
  const requests: string[] = [];
  const responses: string[] = [];
  const failed: string[] = [];
  page.context().on('request', (r) => requests.push(r.url()));
  page.context().on('response', (r) => responses.push(r.url()));
  page.context().on('requestfailed', (r) => failed.push(r.url()));
  await load(page);
  await page.waitForTimeout(300);

  const crossOrigin = (u: string) => /^https?:|^wss?:/.test(u) && new URL(u).origin !== origin;
  expect(responses.filter(crossOrigin), 'no cross-origin response').toEqual([]);
  // Chromium reports the worker's CSP-blocked import('https://example.com/x.js')
  // as a request that fails with "csp"; it never reaches the network.
  for (const u of requests.filter(crossOrigin)) expect(failed, `${u} must fail`).toContain(u);

  const prism = responses.filter((u) => u.includes('/vendor/prism/'));
  expect(prism.map((u) => new URL(u).pathname).sort()).toEqual([
    '/vendor/prism/prism-clike.min.js',
    '/vendor/prism/prism-core.min.js',
    '/vendor/prism/prism-javascript.min.js'
  ]);
  for (const u of prism) expect(new URL(u).origin).toBe(origin);
  expect(await page.evaluate(() => typeof (window as any).Prism?.highlight === 'function' && (window as any).Prism.manual === true)).toBe(true);
  expect(await page.locator('#glue-excerpt .token').count()).toBeGreaterThan(10);
});
