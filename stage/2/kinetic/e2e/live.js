// Drive the live KPF export. `?currentSlide=n` is a full navigation (the player reads it at startup and has no
// hashchange listener); the player maps slide n (1-based) to its first scene. There is no window handle on
// the player, so the URL and the keyboard are the only drivers.
export const LIVE_BASE = process.env.KINETIC_LIVE_BASE || 'https://all-docs.talks.charlie.dev/';
export const SETTLE_MS = 1000;

/** True once `#waitingIndicator` is display: none. */
export function indicatorHidden() {
  const e = document.getElementById('waitingIndicator');
  return !!e && getComputedStyle(e).display === 'none';
}

/** Wait for the waiting indicator to hide, then SETTLE_MS. */
export async function settle(page) {
  await page.waitForFunction(indicatorHidden, null, { timeout: 120000 });
  await page.waitForTimeout(SETTLE_MS);
}

/** Navigate the live export to slide n (1-based) and settle. Returns the ms from navigation to settled. */
export async function gotoLive(page, n) {
  const t0 = Date.now();
  await page.goto(`${LIVE_BASE}?currentSlide=${n}`, { waitUntil: 'load' });
  await settle(page);
  return Date.now() - t0;
}

/** Advance one build on the live side: ArrowRight, then wait for the indicator and settle. */
export async function advanceLive(page, presses = 1) {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('ArrowRight');
    await settle(page);
  }
}
