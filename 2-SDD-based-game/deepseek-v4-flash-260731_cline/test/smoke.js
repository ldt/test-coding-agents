// Smoke test for the Worms game (TDD: written before the implementation).
// Drives index.html?demo headless with Playwright (preinstalled at repo root).
// Asserts: no console errors, match starts with 2x4 worms @ 100 HP, turns
// advance, team HP totals change, and the match eventually ends (GAME_OVER).
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const assert = require('assert');

const GAME_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    // ---- Test 1: title screen shows required elements --------------------
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.goto(GAME_URL);
      await page.waitForSelector('#title-screen', { timeout: 10000 });
      assert(await page.isVisible('#btn-pvp'), '2 Players button is visible');
      assert(await page.isVisible('#btn-cpu'), 'vs CPU button is visible');
      assert(await page.isVisible('#controls-summary'), 'controls summary is visible');
      assert(errors.length === 0, 'no console errors on title screen: ' + errors.join(' | '));
      results.push('PASS title screen');
      await page.close();
    }

    // ---- Test 2: demo mode full match -------------------------------------
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.goto(GAME_URL + '?demo', { timeout: 15000 });

      // window.__game debug handle exists and a match started (not TITLE)
      await page.waitForFunction(() => {
        const g = window.__game;
        return g && typeof g.state === 'string' && g.state !== 'TITLE';
      }, null, { timeout: 15000 });

      const readState = () => page.evaluate(() => {
        const g = window.__game;
        return {
          state: g.state,
          turnCount: g.turnCount,
          turnTimer: g.turnTimer,
          teams: (g.teams || []).map((t) => ({
            hp: t.worms.reduce((s, w) => s + (w.alive && !w.dying ? w.hp : 0), 0),
            alive: t.worms.filter((w) => w.alive && !w.dying).length,
          })),
        };
      });

      const initial = await readState();
      assert(initial.teams.length === 2, 'match has two teams');
      for (const t of initial.teams) {
        assert(t.alive === 4, 'each team starts with 4 worms');
        assert(t.hp === 400, 'each team starts with 400 total HP');
      }

      // turns advance (turnCount increments)
      await page.waitForFunction(
        (turn) => window.__game.turnCount > turn,
        initial.turnCount,
        { timeout: 240000 }
      );

      // team HP totals change (weapons deal damage over time)
      const startTotal = initial.teams[0].hp + initial.teams[1].hp;
      await page.waitForFunction(
        (start) => {
          const g = window.__game;
          const total = g.teams.reduce(
            (s, t) => s + t.worms.reduce((x, w) => x + (w.alive && !w.dying ? w.hp : 0), 0),
            0
          );
          return total < start - 1;
        },
        startTotal,
        { timeout: 420000 }
      );

      // match eventually ends (sudden death guarantees bounded length)
      await page.waitForFunction(
        () => window.__game.state === 'GAME_OVER',
        null,
        { timeout: 1500000 }
      );

      assert(errors.length === 0, 'no console errors across the whole demo match: ' + errors.join(' | '));
      results.push('PASS demo mode full match (turns, HP, end state, no console errors)');
      await page.close();
    }
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log('ALL TESTS PASSED');
})();