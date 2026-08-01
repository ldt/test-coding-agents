// TDD regression test for the jump bug (Req 4.3).
//
// Red (bug v1): the jump key (Enter/Z) was consumed only inside moveWorm(),
// which runs only when a direction key is held — pressing Enter/Z standing
// still did nothing.
//
// Red (bug v2): tryJump() marked the worm airborne, but the worm's physics
// integration happens inside moveWorm(), which still only ran when a
// direction key was held. So after a standing jump the worm was flagged
// airborne but never moved — it hovered frozen until a direction key was
// pressed. A test that only checked atRest was a false positive.
//
// Green (fix): the active worm's physics must be stepped every AIMING frame
// even with no direction key, so a standing jump actually leaves the ground
// and arcs forward.
//
// This test is strict: it asserts REAL displacement (the worm's y drops by
// a substantial amount and x moves in the facing direction) ~300ms after a
// bare Enter press with no arrow keys.
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const assert = require('assert');

const GAME_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(GAME_URL, { timeout: 15000 });
    await page.click('#btn-pvp');

    // wait until a match is running in AIMING with a living active worm at rest
    await page.waitForFunction(() => {
      const g = window.__game;
      if (!g || g.state !== 'AIMING') return false;
      const t = g.teams && g.teams[g.activeTeam];
      if (!t || !t.worms || !t.worms.length) return false;
      const w = t.worms[t.activeWormIx];
      return w && w.alive && w.atRest && !w.trulyDead && !w.dying;
    }, null, { timeout: 15000 });

    // Teleport the active worm onto a known flat, open plateau so the jump
    // test is independent of random spawn/wall geometry. This isolates the
    // exact bug: physics not stepping when no direction key is held.
    const before = await page.evaluate(() => {
      const g = window.__game;
      const W = 1600;
      const t = g.teams[g.activeTeam];
      const w = t.worms[t.activeWormIx];
      // find the widest flat run on the terrain to stand on
      const terrain = g.terrain;
      let bestX = 400, bestRun = 0;
      for (let x = 100; x < W - 100;) {
        let run = 0;
        while (x + run < W - 100 &&
               Math.abs(terrain.surfaceHeight(x + run) - terrain.surfaceHeight(x)) <= 2) run += 4;
        if (run > bestRun) { bestRun = run; bestX = x + Math.floor(run / 2); }
        x = x + Math.max(4, run);
      }
      const sy = terrain.surfaceHeight(bestX);
      w.x = bestX;
      w.y = sy - 15; // center = surfaceHeight - WORM_R(14) - 1
      w.vx = 0; w.vy = 0;
      w.atRest = true;
      w.facing = 1; // jump forward to the right over open ground
      w.fallStartY = w.y;
      return { x: w.x, y: w.y, vy: w.vy, atRest: w.atRest, id: w.id, facing: w.facing };
    });

    // Press ONLY the jump key — no arrow keys.
    await page.keyboard.press('Enter');

    // Sample at ~120ms: the jump must already be physically lifting
    // (vy = -420 + g*t => strongly negative, y risen ~40px) and still
    // climbing, BEFORE any landing masks the result. Before the fix, the
    // worm was flagged airborne with vy=-420 yet its position never changed
    // (physics only stepped inside the movement path).
    await page.waitForTimeout(120);

    const after = await page.evaluate(() => {
      const g = window.__game;
      const t = g.teams[g.activeTeam];
      const w = t.worms[t.activeWormIx];
      return { x: w.x, y: w.y, vy: w.vy, atRest: w.atRest, id: w.id };
    });

    // The same worm must still be active (turn didn't flip mid-check).
    assert(after.id === before.id, 'active worm changed during the test');

    // The worm must have REALLY jumped: risen substantially (physics ran)
    // and still moving upward, WITHOUT any lateral key.
    assert(
      after.y < before.y - 15 && after.vy < 0,
      'worm did not physically jump on a bare Enter press ' +
      '(before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after) + ')'
    );
    // The jump is a forward arc in the facing direction (vx = facing * 160;
    // ~19px expected at 120ms on open ground).
    const movedForward = (after.x - before.x) * before.facing > 5;
    assert(
      movedForward,
      'jump did not produce a forward arc in the facing direction ' +
      '(before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after) + ')'
    );

    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
    console.log('PASS jump: bare Enter press physically launches a forward arc jump');
    await page.close();
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('ALL TESTS PASSED');
})();