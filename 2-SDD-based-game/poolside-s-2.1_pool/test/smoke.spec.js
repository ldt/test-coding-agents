// Red/green TDD smoke test.
// RED: written first, failed because index.html/game.js didn't exist.
// GREEN: implemented the game until these pass.
import { test, expect } from '@playwright/test';
import { pageURL, runSteps } from './helpers.js';

test.describe('Worms game — smoke (demo mode)', () => {
  test('page loads with no console errors and exposes a debug handle', async ({
    page,
  }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(pageURL('?demo'));
    const hasHandle = await page.evaluate(() => typeof window.__game === 'object');
    const hasRunSteps = await page.evaluate(() => typeof window.__game?.runSteps === 'function');
    const state = await page.evaluate(() => window.__game?.state);
    expect(hasHandle).toBe(true);
    expect(hasRunSteps).toBe(true);
    expect(state).toBe('AIMING'); // demo skips title → lands in a turn
    expect(errors).toEqual([]);
  });

  test('demo match advances turns and ends in bounded time', async ({
    page,
  }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(pageURL('?demo'));
    const initialTurn = await page.evaluate(() => window.__game.turnCount);

    let done = false;
    for (let batch = 0; batch < 90 && !done; batch++) {
      await runSteps(page, 2000);
      done = await page.evaluate(() => window.__game.state === 'GAME_OVER' || window.__game.state === 'TITLE');
    }

    const finalState = await page.evaluate(() => window.__game.state);
    const finalTurn = await page.evaluate(() => window.__game.turnCount);
    const hp = await page.evaluate(() => window.__game.teamHP());
    expect(finalState).toBe('GAME_OVER');
    expect(finalTurn).toBeGreaterThan(initialTurn);
    expect(hp.length).toBe(2); // two teams tracked
    expect(errors).toEqual([]);
  });

  test('no console errors across multiple rematches', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(pageURL('?demo'));
    for (let i = 0; i < 3; i++) {
      await runSteps(page, 4000);
      // restart the demo match in place
      await page.evaluate(() => { window.__game.test?.restart && window.__game.test.restart(); });
    }
    expect(errors).toEqual([]);
  });
});
