// HTTP checks: the page and the worker each carry the CSP we claim.
import { expect, test } from '@playwright/test';

// Literal copies on purpose. If src/server.ts drifts, this fails.
// Page CSP: verbatim from charlie.dev render/site/src/app.ts lines 119-131.
const PAGE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const WORKER_CSP =
  "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'none'";

const base = () => process.env.POC_URL!;

test('GET / carries the exact page CSP and no inline script', async ({ request }) => {
  const res = await request.get(`${base()}/`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toBe(PAGE_CSP);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  const html = await res.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  expect(scripts).toHaveLength(1);
  expect(scripts[0][1]).toContain('src="/main.js"');
  expect(scripts[0][2].trim()).toBe('');
  expect(html).not.toMatch(/\son[a-z]+\s*=/i); // no inline event handlers
});

test('GET /guest-worker.js carries the worker CSP', async ({ request }) => {
  const res = await request.get(`${base()}/guest-worker.js`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toBe(WORKER_CSP);
  expect(res.headers()['content-type']).toMatch(/^text\/javascript/);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('policies do not allow unsafe-eval or unsafe-inline in script-src', () => {
  for (const policy of [PAGE_CSP, WORKER_CSP]) {
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  }
});

test('vendor and component files are served same-origin', async ({ request }) => {
  const glue = await request.get(`${base()}/vendor/jco-transpile/js-component-bindgen-component.js`);
  expect(glue.status()).toBe(200);
  const text = await glue.text();
  expect(text).not.toContain("'@bytecodealliance/preview2-shim/");
  expect(text).toContain("'/vendor/preview2-shim/cli.js'");
  const wasm = await request.get(`${base()}/components/guest.wasm`);
  expect(wasm.headers()['content-type']).toBe('application/wasm');
  expect((await wasm.body()).subarray(0, 4)).toEqual(Buffer.from([0, 0x61, 0x73, 0x6d]));
  expect((await request.get(`${base()}/vendor/jco-transpile/../package.json`)).status()).toBe(404);
});
