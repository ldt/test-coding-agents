// Playwright config for the PoolSide S 2.1 / Pool Worms implementation.
// Run from this folder with: ../../node_modules/.bin/playwright test
// (Playwright itself is installed at the repo root node_modules.)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // The game is a zero-dependency file:// app; chromium headless is enough
    // for deterministic state assertions via window.__game.
    ...devices['Desktop Chrome'],
    headless: true,
    // Allow loading the local index.html over file:// scheme.
    baseURL: 'file://' + process.cwd().replace(/\\/g, '/'),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
