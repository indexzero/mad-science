// Browser checks: load the page, wait for the worker, assert every probe.
import { expect, test } from '@playwright/test';

const PAGE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const WORKER_CSP =
  "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'none'";

type Violation = {
  violatedDirective: string;
  effectiveDirective: string;
  blockedURI: string;
  originalPolicy?: string;
};
type Row = { probe: string; pass: boolean; detail: string; info?: boolean };

/**
 * Known findings: a check that fails in one browser for a reason outside our
 * control. The test asserts the OBSERVED behaviour, so if the browser
 * changes, the test fails and this list must be updated. Nothing is skipped.
 */
const EXPECTED_FAILURES: Record<string, Record<string, string>> = {
  webkit: {
    'worker: eval fires a violation event':
      "WebKit 27.2 blocks new Function() in the worker (EvalError quotes the worker's script-src) but fires no securitypolicyviolation event for it. Every other worker violation does fire, with the worker's originalPolicy."
  }
};

const has = (vs: Violation[], directive: string, blocked: (u: string) => boolean) =>
  vs.some((v) => v.effectiveDirective === directive && blocked(v.blockedURI));

function rowsOf(r: any, origin: string): Row[] {
  const pv: Violation[] = r.page.violations;
  const w = r.worker ?? {};
  const wv: Violation[] = w.violations ?? [];
  const ok = (b: unknown) => b === true;
  const glueOnPage = r.glue?.onPage ?? {};
  const c = r.component ?? {};
  return [
    {
      probe: 'p1: guest.wasm preamble = 00 61 73 6d 0d 00 01 00',
      pass: c.magic === '00 61 73 6d 0d 00 01 00',
      detail: String(c.magic)
    },
    {
      probe: 'p1: componentWit recovers the world from the bytes',
      pass:
        typeof c.wit === 'string' &&
        c.wit.includes('import washe:poc/host;') &&
        c.wit.includes('export run: func(input: string) -> string;'),
      detail: JSON.stringify(c.wit)
    },
    {
      probe: 'p1: print shows log type, canon lift and canon lower',
      pass:
        c.hasCanonLift === true &&
        c.hasCanonLower === true &&
        (c.printLines ?? []).some((l: string) => l.includes('(func (param "msg" string))')),
      detail: `lift=${c.hasCanonLift} lower=${c.hasCanonLower}`
    },
    {
      probe: 'p1: glue excerpt highlighted by Prism',
      pass: (r.prismHighlighted ?? 0) >= 3,
      detail: `Prism.highlight calls: ${r.prismHighlighted}`
    },
    {
      probe: 'p2: page reads its own CSP header (exact copy)',
      pass: r.csp?.page === PAGE_CSP,
      detail: String(r.csp?.page)
    },
    {
      probe: 'p2: glue refused on the page',
      pass:
        ok(glueOnPage.refused) &&
        (glueOnPage.violations ?? []).some(
          (v: Violation) => v.effectiveDirective === 'script-src-elem' && v.blockedURI.startsWith('blob')
        ),
      detail: glueOnPage.error ?? `NOT refused: ${glueOnPage.value}`
    },
    {
      probe: 'p3: page and worker glue have the same sha256',
      pass: !!r.glue?.pageSha256 && r.glue.pageSha256 === r.glue?.workerSha256,
      detail: `${r.glue?.pageSha256} vs ${r.glue?.workerSha256}`
    },
    {
      probe: 'p3: worker CSP read from its header',
      pass: r.csp?.worker === WORKER_CSP,
      detail: String(r.csp?.worker)
    },
    {
      probe: 'page: blob: import() refused',
      pass: ok(r.page.blobImport?.refused) && has(pv, 'script-src-elem', (u) => u.startsWith('blob')),
      detail: r.page.blobImport?.error ?? 'NOT refused'
    },
    {
      probe: 'page: new Function throws',
      pass: ok(r.page.newFunction?.threw) && has(pv, 'script-src', (u) => u === 'eval'),
      detail: r.page.newFunction?.error ?? 'did NOT throw'
    },
    {
      probe: 'worker: jco glue import()ed from blob:',
      pass: ok(w.glueBlobImport?.ok),
      detail: JSON.stringify(w.glueBlobImport ?? r.errors)
    },
    {
      probe: 'end to end: run("a b c") === "3" via postMessage',
      pass: r.result?.input === 'a b c' && r.result?.output === '3',
      detail: JSON.stringify(r.result ?? r.errors)
    },
    {
      probe: 'end to end: host log import called',
      pass: r.logs.includes('guest: run called'),
      detail: JSON.stringify(r.logs)
    },
    {
      probe: 'worker: no document, no window',
      pass: w.typeofDocument === 'undefined' && w.typeofWindow === 'undefined',
      detail: `document=${w.typeofDocument} window=${w.typeofWindow}`
    },
    {
      probe: 'worker: no OffscreenCanvas transferred',
      pass: w.offscreenCanvasReceived === false,
      detail: `received=${w.offscreenCanvasReceived}`
    },
    {
      probe: "worker: fetch('/') refused by connect-src",
      pass: ok(w.fetchSelf?.refused) && has(wv, 'connect-src', (u) => u === `${origin}/`),
      detail: w.fetchSelf?.error ?? `NOT refused: ${w.fetchSelf?.value}`
    },
    {
      probe: 'worker: fetch(https://example.com/) refused by connect-src',
      pass:
        ok(w.fetchCrossOrigin?.refused) &&
        has(wv, 'connect-src', (u) => u.startsWith('https://example.com')),
      detail: w.fetchCrossOrigin?.error ?? `NOT refused: ${w.fetchCrossOrigin?.value}`
    },
    {
      probe: 'worker: new WebSocket refused by connect-src',
      pass: ok(w.webSocket?.refused) && has(wv, 'connect-src', (u) => u.startsWith('ws://')),
      detail: `${w.webSocket?.how}${w.webSocket?.error ? `: ${w.webSocket.error}` : ''}`
    },
    {
      probe: 'worker: importScripts(cross-origin) refused',
      pass: ok(w.importScripts?.refused),
      detail: w.importScripts?.error ?? 'NOT refused'
    },
    {
      probe: 'worker: import(cross-origin) refused by script-src',
      pass:
        ok(w.importCrossOrigin?.refused) &&
        has(wv, 'script-src-elem', (u) => u.startsWith('https://example.com')),
      detail: w.importCrossOrigin?.error ?? 'NOT refused'
    },
    {
      probe: 'worker: new Function throws',
      pass: ok(w.newFunction?.refused),
      detail: w.newFunction?.error ?? 'did NOT throw'
    },
    {
      probe: 'worker: eval fires a violation event',
      pass: has(wv, 'script-src', (u) => u === 'eval'),
      detail: `events: ${wv.map((v) => `${v.effectiveDirective}:${v.blockedURI}`).join(', ')}`
    },
    {
      probe: "worker: every violation's originalPolicy is the worker CSP",
      pass: wv.length >= 4 && wv.every((v) => v.originalPolicy === WORKER_CSP),
      detail: `${wv.length} events; policies seen: ${JSON.stringify([...new Set(wv.map((v) => v.originalPolicy))])}`
    },
    {
      probe: 'info: worker can make its own OffscreenCanvas',
      pass: true,
      info: true,
      detail: w.selfMadeOffscreenCanvas?.value ?? w.selfMadeOffscreenCanvas?.error
    },
    {
      probe: 'info: worker has BroadcastChannel / indexedDB',
      pass: true,
      info: true,
      detail: `BroadcastChannel=${w.typeofBroadcastChannel} indexedDB=${w.typeofIndexedDB}`
    }
  ];
}

/**
 * The audience: walk all 4 pages with the buttons and keys, use each
 * control, then open both panels and send the one ping. Each step is a row.
 * The video of this test is the recorded walk-through.
 */
async function audience(page: import('@playwright/test').Page): Promise<Row[]> {
  const poc = () => page.evaluate(() => (window as any).__poc);
  const onPage = async (n: number) => (await page.textContent('#page-no')) === `${n}/4`;
  const rows: Row[] = [];
  const pause = () => page.waitForTimeout(400); // so the video shows each page

  await pause();
  await page.click('#next');
  rows.push({ probe: 'walk: [ → ] to page 2', pass: await onPage(2), detail: String(await page.textContent('#page-title')) });
  await page.click('#run-here');
  await page.waitForTimeout(300);
  const again = (await poc()).glue?.onPage;
  rows.push({
    probe: 'p2: import(blob: glue) button refused again',
    pass: again?.refused === true && (await page.textContent('#run-here-out'))?.includes('REFUSED') === true,
    detail: again?.error ?? 'NOT refused'
  });
  await pause();

  await page.keyboard.press('ArrowRight');
  rows.push({ probe: 'walk: ArrowRight to page 3', pass: await onPage(3), detail: String(await page.textContent('#page-title')) });
  await page.fill('#live', 'one two three four');
  const live = await page
    .waitForFunction(() => (window as any).__poc.live?.input === 'one two three four', null, { timeout: 5000 })
    .then(() => poc())
    .catch(() => poc());
  rows.push({
    probe: 'p3: live input -> run() -> "4"',
    pass: live.live?.output === '4' && (await page.textContent('#live-out'))?.includes('"4"') === true,
    detail: JSON.stringify(live.live)
  });
  await page.check('input[value="shout"]');
  const shouted = await page
    .waitForFunction(() => (window as any).__poc.logs.includes('GUEST: RUN CALLED'), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  rows.push({ probe: 'p3: host swaps the log import (SHOUT)', pass: shouted, detail: JSON.stringify((await poc()).logs.slice(-2)) });
  await pause();

  await page.click('#next');
  rows.push({ probe: 'walk: [ → ] to page 4', pass: await onPage(4), detail: String(await page.textContent('#page-title')) });
  await page.click('#rerun');
  const ledgerOk = await page
    .waitForFunction(
      () =>
        document.querySelectorAll('#ledger li').length === 6 &&
        [...document.querySelectorAll('#ledger li')].every((li) => li.textContent?.includes('[ REFUSED ]')),
      null,
      { timeout: 10_000 }
    )
    .then(() => true)
    .catch(() => false);
  rows.push({
    probe: 'p4: run the attempts again -> 6 x REFUSED',
    pass: ledgerOk,
    detail: (await page.textContent('#ledger'))?.replace(/\s+/g, ' ').slice(0, 200) ?? ''
  });
  await pause();

  await page.click('#toggle-devtools');
  await page.fill('#ping-in', 'Vasili');
  await page.click('#ping-btn');
  const pong = await page
    .waitForFunction(() => (window as any).__poc.pong, null, { timeout: 5000 })
    .then(() => poc().then((p) => p.pong))
    .catch(() => null);
  rows.push({
    probe: 'ping: one ping in, one pong out',
    pass:
      pong?.refused === false &&
      pong?.reply === 'pong' &&
      pong?.reversed === 'ilisaV' &&
      (await page.isDisabled('#ping-btn')),
    detail: JSON.stringify(pong)
  });
  // Go around the disabled button: the WORKER must refuse a second ping.
  await page.evaluate(() => (window as any).__pocPing('again'));
  const second = await page
    .waitForFunction(() => (window as any).__poc.pong?.refused === true, null, { timeout: 5000 })
    .then(() => poc().then((p) => p.pong))
    .catch(() => poc().then((p) => p.pong));
  rows.push({
    probe: 'ping: worker refuses a second ping',
    pass: second?.refused === true && second?.reply === 'one ping only',
    detail: JSON.stringify(second)
  });
  await page.click('#toggle-citations');
  await pause();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  rows.push({ probe: 'walk: ArrowLeft x3 back to page 1', pass: await onPage(1), detail: String(await page.textContent('#page-title')) });
  await pause();
  return rows;
}

test('guest worker probes', async ({ page, browserName, browser }, testInfo) => {
  const url = process.env.POC_URL!;
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__pocDone === true, null, {
    timeout: 45_000
  });
  const r = await page.evaluate(() => {
    const p = (window as any).__poc;
    return { ...p, glue: { ...p.glue, text: undefined } }; // skip the 130 kB glue text
  });
  const rows = rowsOf(r, new URL(url).origin);
  rows.push(...(await audience(page)));
  const known = EXPECTED_FAILURES[browserName] ?? {};

  const table = rows.map((row) => {
    const reason = known[row.probe];
    const status = row.info ? 'INFO' : reason ? (row.pass ? 'XPASS' : 'XFAIL') : row.pass ? 'PASS' : 'FAIL';
    if (reason) testInfo.annotations.push({ type: 'expected-failure', description: `${row.probe}: ${reason}` });
    return { ...row, status };
  });

  await testInfo.attach('probes', {
    contentType: 'application/json',
    body: JSON.stringify({
      browser: `${browserName} ${browser.version()}`,
      rows: table,
      numbers: {
        bindgenJsBytes: null, // filled by the reporter from disk
        bindgenCoreBytes: r.sizes.bindgenCores,
        guestComponentBytes: r.sizes.guestComponent,
        glueJsBytes: r.ready?.sizes.glueJs,
        guestCoreBytes: r.ready?.sizes.coreModules,
        bindgenInitMs: r.ready?.timings.bindgenInitMs,
        generateMs: r.ready?.timings.generateMs,
        instantiateMs: r.ready?.timings.instantiateMs,
        coldStartToFirstResultMs: r.timings.firstResult,
        workerCreateToFirstResultMs: r.timings.workerToFirstResult
      },
      errors: r.errors
    })
  });

  expect(r.errors, 'no errors from the page or worker').toEqual([]);
  for (const row of table) {
    if (row.info) continue;
    if (known[row.probe]) {
      // Expected failure: assert the observed (failing) behaviour, so a fix shows up as XPASS.
      expect.soft(row.pass, `XPASS, update EXPECTED_FAILURES: ${row.probe}`).toBe(false);
    } else {
      expect.soft(row.pass, `${row.probe}: ${row.detail}`).toBe(true);
    }
  }
});
