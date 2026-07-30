import { test, expect } from '@playwright/test';
import { pageURL } from './helpers.js';

test.describe('Worms game — damage model', () => {
  // Req 6.2: explosion damage scales with proximity and is floored at 25% of
  // max while the blast circle overlaps the worm's body circle.
  test('damage is max at center and floored at 25% of max inside the radius', async ({
    page,
  }) => {
    await page.goto(pageURL('?demo'));
    const D = 50; // max damage
    const R = 50; // blast radius
    const call = (d, r, mx) =>
      page.evaluate((o) => window.__game.test.damageAt(o.d, o.r, o.mx), { d, r, mx });
    // center → full damage
    expect(await call(0, R, D)).toBeCloseTo(50, 5);
    // halfway → half damage
    expect(await call(R * 0.5, R, D)).toBeCloseTo(25, 5);
    // at the edge (d == R) the linear term hits 0 → floor to 25%
    expect(await call(R, R, D)).toBeCloseTo(12.5, 5);
    // just inside overlap (radius + WORM_R) → still floored at 25%
    const eps = 0.01;
    expect(await call(R + 12 - eps, R, D)).toBeCloseTo(12.5, 5);
    // outside the overlap circle → no damage
    expect(await call(R + 12 + eps, R, D)).toBe(0);
  });
});
