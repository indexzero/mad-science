import { defineConfig, devices } from '@playwright/test';

// Firefox: Playwright's bundled Firefox (firefox-1555, Firefox 157) exits at
// launch on the macOS 27 host this was built on ("Could not find profile
// folder"). By default we drive the system Firefox over WebDriver BiDi
// instead. Set PW_FIREFOX_CHANNEL=bundled to use Playwright's own build.
const firefoxChannel =
  process.env.PW_FIREFOX_CHANNEL === 'bundled' ? undefined : 'moz-firefox';

export default defineConfig({
  testDir: 'tests',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['./tests/table-reporter.ts']],
  timeout: 60_000,
  projects: [
    { name: 'http', testMatch: /headers\.spec\.ts/ },
    { name: 'chromium', testMatch: /probes\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      testMatch: /probes\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], channel: firefoxChannel }
    },
    { name: 'webkit', testMatch: /probes\.spec\.ts/, use: { ...devices['Desktop Safari'] } }
  ]
});
