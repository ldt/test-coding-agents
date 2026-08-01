// Headless smoke test (spec: tasks.md task 11).
// Drives index.html?demo (CPU vs CPU — Req 9.5) and asserts, via window.__game:
//   - the page loads with zero console/page errors
//   - a match starts and turns advance
//   - explosions change team HP totals (or worms die)
// Run: NODE_PATH=<repo>/1-small-magical-prompt/node_modules node test/smoke.js
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // Use the environment's pre-installed Chromium when the pinned Playwright
  // version would otherwise try to download its own build.
  const launchOpts = {};
  if (process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const url = 'file://' + path.resolve(__dirname, '..', 'index.html') + '?demo';
  await page.goto(url);

  // match must start on its own in demo mode
  await page.waitForFunction(
    () => window.__game && ['TURN_START', 'AIMING', 'CHARGING'].includes(window.__game.state),
    null, { timeout: 10000 },
  );

  const snap = () => page.evaluate(() => ({
    state: window.__game.state,
    turnCount: window.__game.turnCount,
    hp: window.__game.teams.map(t => t.worms.reduce((s, w) => s + (w.alive ? Math.max(0, w.hp) : 0), 0)),
    alive: window.__game.teams.map(t => t.worms.filter(w => w.alive).length),
  }));

  const start = await snap();
  console.log('start:', JSON.stringify(start));
  if (start.alive[0] !== 4 || start.alive[1] !== 4) throw new Error('expected 4 worms per team, got ' + start.alive);
  if (start.hp[0] !== 400 || start.hp[1] !== 400) throw new Error('expected 400 hp per team, got ' + start.hp);

  // let the CPUs trade fire
  let last = start, sawDamage = false, maxTurns = 0;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const s = await snap();
    maxTurns = Math.max(maxTurns, s.turnCount);
    if (s.hp[0] < 400 || s.hp[1] < 400 || s.alive[0] < 4 || s.alive[1] < 4) sawDamage = true;
    last = s;
    if (maxTurns >= 3 && sawDamage) break;
    if (s.state === 'GAME_OVER') break;
  }
  console.log('end:  ', JSON.stringify(last), 'maxTurns:', maxTurns);

  await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'demo.png') });
  await browser.close();

  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  if (maxTurns < 2) throw new Error('turns did not advance (turnCount=' + maxTurns + ')');
  if (!sawDamage) throw new Error('no damage was dealt in 90s of CPU-vs-CPU play');
  console.log('SMOKE OK — turns advanced, damage dealt, no console errors');
})().catch(e => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
