import { test, expect } from '@playwright/test';
import { pageURL, runSteps } from './helpers.js';

test.describe('Worms game — sudden death', () => {
  // Req 10.1–10.4: sudden death begins at 20 completed turns; living worms' HP
  // is capped at 30; the water level rises each turn-start; the match ends.
  test('activates at 20 turns, caps HP at 30, and the match ends', async ({
    page,
  }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(pageURL('?demo'));

    // Drive the demo until sudden death triggers (or until GAME_OVER).
    let over = false;
    for (let i = 0; i < 120 && !over; i++) {
      await runSteps(page, 2000);
      over = await page.evaluate(() => window.__game.state === 'GAME_OVER');
    }

    const info = await page.evaluate(() => {
      const g = window.__game;
      const livingMax = Math.max(
        0,
        ...g.teams.flatMap(t => t.worms.filter(w => w.alive).map(w => w.hp))
      );
      return {
        state: g.state,
        turnCount: g.turnCount,
        sd: g.suddenDeath,
        waterY: g.waterY,
        livingMaxHP: livingMax,
      };
    });

    expect(errors).toEqual([]);
    expect(info.state).toBe('GAME_OVER');
    expect(info.turnCount).toBeGreaterThanOrEqual(20);
    // If sudden death was never reached because a team was wiped before turn 20,
    // that is still a valid termination. Otherwise sudden death must be active
    // and the HP cap must have held.
    if (info.turnCount >= 20) {
      expect(info.sd).toBe(true);
      expect(info.livingMaxHP).toBeLessThanOrEqual(30);
      expect(info.waterY).toBeLessThan(770); // water rose above its initial line
    }
  });
});
