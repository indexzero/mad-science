// Playwright: the new player is served from this directory by e2e/serve.js; the live export is fetched
// over the network. Captures are sequential (workers: 1) so build timing stays stable.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT) || 4173;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.js/,
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    browserName: 'chromium',
  },
  webServer: {
    command: 'node e2e/serve.js',
    port: PORT,
    reuseExistingServer: true,
    timeout: 20000,
  },
});
