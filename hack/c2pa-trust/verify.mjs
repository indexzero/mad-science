import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write(`c2pa-verify: ${message}\n`);
  process.exitCode = 4;
}

async function executable(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }

  throw new Error('Chrome/Chromium not found; set CHROME_BIN');
}

async function main() {
  const assetArg = process.argv[2];
  if (!assetArg || process.argv.length !== 3) {
    fail('usage: node verify.mjs IMAGE');
    return;
  }

  const assetPath = path.resolve(assetArg);
  const assetStat = await stat(assetPath);
  if (!assetStat.isFile()) throw new Error(`not a regular file: ${assetPath}`);
  if (assetStat.size > MAX_ASSET_BYTES) throw new Error('asset exceeds the SDK 1 GiB limit');

  let server;
  let browser;

  try {
    server = await createServer({
      root: MODULE_DIR,
      appType: 'mpa',
      clearScreen: false,
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
      },
    });
    await server.listen();

    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('local verifier server did not start');

    browser = await chromium.launch({
      executablePath: await findChrome(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/verify.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.setInputFiles('#asset', assetPath);
    await page.waitForFunction(() => document.body.dataset.done === 'true', undefined, {
      timeout: 60_000,
    });

    const rawResult = await page.locator('#result').textContent();
    const result = JSON.parse(rawResult ?? '{}');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (result.status === 'no-manifest') process.exitCode = 0;
    else if (result.status === 'manifest-found') process.exitCode = 3;
    else process.exitCode = 4;
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
