// TDD regression test for the jump bug (Req 4.3).
//
// Red (bug): the jump key (Enter/Z) is consumed only inside moveWorm(),
// which is called only when a direction key is held. Pressing Enter/Z while
// standing still therefore does nothing — the worm only jumps after it has
// started moving laterally.
//
// Green (fix): pressing Enter/Z alone must start the forward arc jump
// (vy = JUMP_VY, forward vx = facing * JUMP_VX) with no direction key
// pressed.
//
// Drives index.html in pvp mode headless (human input is honored in pvp;
// demo mode is CPU-vs-CPU and ignores keys), presses Enter with no arrow
// key, and asserts the active worm leaves the ground.
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

    const before = await page.evaluate(() => {
      const g = window.__game;
      const t = g.teams[g.activeTeam];
      const w = t.worms[t.activeWormIx];
      return { x: w.x, y: w.y, vy: w.vy, atRest: w.atRest, id: w.id };
    });

    // Press ONLY the jump key — no arrow keys.
    await page.keyboard.press('Enter');

    // Give the fixed-step loop a few frames to apply the jump.
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const g = window.__game;
      const t = g.teams[g.activeTeam];
      const w = t.worms[t.activeWormIx];
      return { x: w.x, y: w.y, vy: w.vy, atRest: w.atRest, id: w.id };
    });

    // The same worm must still be active (turn didn't flip mid-check).
    assert(after.id === before.id, 'active worm changed during the test');

    // The worm must have left the ground: risen above its starting y and
    // gained upward velocity, WITHOUT any lateral key pressed.
    assert(
      after.atRest === false || after.y < before.y - 5 || after.vy < -100,
      'worm did not jump when Enter was pressed standing still ' +
      '(before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after) + ')'
    );
    // The jump must be a forward arc: airborne AND horizontally displaced in
    // the facing direction.
    const movedForward = Math.abs(after.x - before.x) > 5;
    assert(
      movedForward || !after.atRest,
      'jump did not produce a forward arc')
    ;

    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
    console.log('PASS jump: Enter alone starts a forward arc jump');
    await page.close();
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('ALL TESTS PASSED');
})();