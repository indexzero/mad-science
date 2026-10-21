// Browser checks: load the page, wait for the worker, assert every probe.
import { expect, test } from '@playwright/test';

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
  return [
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

test('guest worker probes', async ({ page, browserName, browser }, testInfo) => {
  const url = process.env.POC_URL!;
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__pocDone === true, null, {
    timeout: 45_000
  });
  const r = await page.evaluate(() => (window as any).__poc);
  const rows = rowsOf(r, new URL(url).origin);
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
