// Shared helpers for Playwright specs in this folder.

// A file:// URL to index.html with the given search string (e.g. '?demo').
export function pageURL(search = '') {
  const folder = process.cwd();
  const base = 'file://' + folder.replace(/\\/g, '/') + '/index.html';
  return base + search;
}

// Resolve the in-page debug handle. Call after page load.
export async function gameHandle(page) {
  await page.waitForFunction(() => (typeof window !== 'undefined' && window.__game), {
    timeout: 5_000,
  });
  return page.evaluate(() => window.__game);
}

// Advance the deterministic fixed-step simulation by `steps` (1 step = 1/60s).
export async function runSteps(page, steps) {
  return page.evaluate((n) => window.__game.runSteps(n), steps);
}

// Let the rAF loop run for `ms` of real wall-clock time (for human-paced checks).
export async function waitReal(page, ms) {
  return page.waitForTimeout(ms);
}
