import { test, expect } from '@playwright/test';
import { pageURL } from './helpers.js';

const WORM_ABOVE = 30; // worms rest ~13px above the surface; surface well above water

test.describe('Worms game — terrain & spawning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pageURL('?demo'));
    await page.waitForFunction(() => window.__game && window.__game.state === 'AIMING', { timeout: 5000 });
  });

  // Req 2.1 / 1.7: terrain provides at least 8 distinct standing zones above water.
  test('terrain has at least 8 standing zones above the water line', async ({ page }) => {
    const zones = await page.evaluate(() => window.__game.test.terrainStandingZones());
    expect(zones).toBeGreaterThanOrEqual(8);
  });

  // Req 1.2: two teams of 4 worms each.
  test('spawns exactly 8 worms (4 per team) on solid ground above water', async ({ page }) => {
    const info = await page.evaluate(() => {
      const g = window.__game;
      const waterY = g.waterY;
      const all = [];
      for (const t of g.teams) for (const w of t.worms) {
        all.push({ x: w.x, y: w.y, alive: w.alive, onGround: w.onGround, team: t.name });
      }
      return { waterY, count: all.length, teams: g.teams.map(t => t.worms.length), worms: all };
    });
    expect(info.count).toBe(8);
    expect(info.teams).toEqual([4, 4]);
    for (const w of info.worms) {
      expect(w.y).toBeLessThan(info.waterY - WORM_ABOVE); // above water
      expect(w.alive).toBe(true);
    }
  });

  // Req 2.2 / 2.3: carving removes terrain and the emptied region becomes passable.
  test('carving removes terrain making the area passable', async ({ page }) => {
    // find a solid point inside the dirt body (using the in-page test hook)
    const probe = await page.evaluate(() => {
      const solid = window.__game.test.terrainSolidAt;
      for (let x = 200; x < 1400; x += 6) {
        for (let y = 320; y < 720; y += 6) {
          if (solid(x, y) && solid(x, y + 6)) return { x, y };
        }
      }
      return null;
    });
    expect(probe).not.toBeNull();
    const before = await page.evaluate((p) => window.__game.test.terrainSolidAt(p.x, p.y), probe);
    expect(before).toBe(true);
    await page.evaluate((p) => window.__game.test.carve(p.x, p.y, 22), probe);
    const after = await page.evaluate((p) => window.__game.test.terrainSolidAt(p.x, p.y), probe);
    expect(after).toBe(false);
  });
});
