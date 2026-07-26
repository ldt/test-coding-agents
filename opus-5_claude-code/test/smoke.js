/* ============================================================================
 * Playwright smoke test for the HTML Worms build.
 *
 *   cd worms                       (repo root, where playwright is installed)
 *   node opus-5_claude-code/test/smoke.js
 *
 * Drives a real match through the browser and asserts the behaviour claimed in
 * spec/requirements.md. Screenshots land in test/screenshots/.
 * ==========================================================================*/
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = path.join(__dirname, 'screenshots');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  ok   ' + name); }
  else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const snap = name => page.screenshot({ path: path.join(SHOTS, name) });
  const state = () => page.evaluate(() => {
    const g = window.__worms.game;
    return {
      state: g.state, turnTeam: g.turnTeam, worm: g.active && g.active.name,
      hasFired: g.hasFired, shotsLeft: g.shotsLeft, projectiles: g.projectiles.length,
      wind: g.wind, weaponIdx: g.weaponIdx,
      alive: g.teams.map(t => t.worms.filter(w => !w.dead).length),
      health: g.teams.map(t => t.worms.reduce((s, w) => s + w.health, 0)),
      ammo: g.teams.map(t => Object.assign({}, t.ammo))
    };
  });
  const solidSamples = () => page.evaluate(() => {
    let n = 0; const m = window.__worms.terrain.mask;
    for (let i = 0; i < m.length; i += 401) n += m[i];
    return n;
  });
  /** Solid pixels sampled at least 200px away from the given point. */
  const farSolid = origin => page.evaluate(p => {
    const m = window.__worms.terrain.mask;
    let n = 0;
    for (let x = 0; x < 1800; x += 7) {
      if (Math.abs(x - p.x) < 200) continue;
      for (let y = 0; y < 900; y += 7) n += m[y * 1800 + x];
    }
    return n;
  }, origin);

  /* --- R1: title screen, then a fresh match ------------------------------ */
  console.log('\nR1  match setup');
  await page.goto(FILE);
  await sleep(500);
  check('title overlay shown, match not started',
    await page.evaluate(() => document.getElementById('overlay').classList.contains('show') &&
                              window.__worms.game.state === 'TITLE'));
  await snap('01-title.png');

  await page.click('#start-btn');
  await sleep(700);
  let s = await state();
  check('8 worms alive, 4 per team', s.alive[0] === 4 && s.alive[1] === 4, JSON.stringify(s.alive));
  check('every worm starts at 100 health', s.health[0] === 400 && s.health[1] === 400, JSON.stringify(s.health));
  check('all worms rest on solid ground',
    await page.evaluate(() => window.__worms.game.teams.flatMap(t => t.worms).every(w => !w.airborne)));
  check('worms spawn at least 90px apart',
    await page.evaluate(() => {
      const ws = window.__worms.game.teams.flatMap(t => t.worms);
      return ws.every((a, i) => ws.every((b, j) => i === j || Math.abs(a.x - b.x) >= 90));
    }));
  check('worms spawn above the water line',
    await page.evaluate(() => window.__worms.game.teams.flatMap(t => t.worms).every(w => w.y < 800)));
  check('state is AIM with an active worm', s.state === 'AIM' && !!s.worm, JSON.stringify(s.state));
  await snap('02-match-start.png');

  /* --- R4: walking and jumping ------------------------------------------- */
  console.log('\nR4  movement');
  const x0 = await page.evaluate(() => window.__worms.game.active.x);
  await page.keyboard.down('ArrowRight');
  await sleep(600);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => window.__worms.game.active.x);
  check('holding right walks right', x1 > x0 + 5, `${x0.toFixed(1)} -> ${x1.toFixed(1)}`);
  check('facing follows the walk direction',
    await page.evaluate(() => window.__worms.game.active.facing === 1));

  await page.waitForFunction(() => !window.__worms.game.active.airborne, null, { timeout: 8000 });
  const yBefore = await page.evaluate(() => window.__worms.game.active.y);
  await page.keyboard.press('Enter');
  let leftGround = false;
  for (let i = 0; i < 20 && !leftGround; i++) {
    leftGround = await page.evaluate(() => window.__worms.game.active.airborne);
    if (!leftGround) await sleep(25);
  }
  check('jump leaves the ground', leftGround, 'y before jump = ' + yBefore.toFixed(1));
  const landed = await page.waitForFunction(() => !window.__worms.game.active.airborne,
    null, { timeout: 8000 }).then(() => true).catch(() => false);
  check('the worm lands again', landed);

  /* --- R5: aiming and charging ------------------------------------------- */
  console.log('\nR5  aiming & power');
  const a0 = await page.evaluate(() => window.__worms.game.active.aim);
  await page.keyboard.down('ArrowUp');
  await sleep(300);
  await page.keyboard.up('ArrowUp');
  const a1 = await page.evaluate(() => window.__worms.game.active.aim);
  check('up raises the aim angle', a1 > a0, `${a0.toFixed(2)} -> ${a1.toFixed(2)}`);
  check('aim stays within ±85°', Math.abs(a1) <= 1.49);

  await page.keyboard.down('Space');
  await sleep(400);
  check('holding fire charges power',
    await page.evaluate(() => window.__worms.game.charging && window.__worms.game.charge > 0.2));
  await snap('03-charging.png');
  await page.keyboard.up('Space');
  await sleep(120);
  check('releasing fire launches a projectile',
    await page.evaluate(() => window.__worms.game.projectiles.length === 1 ||
                              window.__worms.game.state !== 'AIM'));
  await snap('04-flight.png');

  /* --- R7: the shot resolves into the retreat window ---------------------- */
  console.log('\nR7  projectile resolution');
  await page.waitForFunction(() => window.__worms.game.projectiles.length === 0, null, { timeout: 20000 });
  await page.waitForFunction(() => ['RETREAT', 'AIM', 'GAMEOVER'].includes(window.__worms.game.state),
    null, { timeout: 20000 });
  s = await state();
  check('firing leads into the retreat window', s.state === 'RETREAT', s.state);
  await snap('05-crater.png');

  /* --- R3: turn alternation ---------------------------------------------- */
  console.log('\nR3  turn machine');
  const teamBefore = s.turnTeam;
  const windBefore = s.wind;
  await page.keyboard.press('n');
  await sleep(400);
  s = await state();
  check('skipping hands the turn to the other team', s.turnTeam === 1 - teamBefore,
    `${teamBefore} -> ${s.turnTeam}`);
  check('wind is re-rolled each turn', s.wind !== windBefore);
  check('the turn clock resets', await page.evaluate(() => window.__worms.game.timeLeft > 40));

  /* --- R2: dynamite at the feet must eat the ground ---------------------- */
  console.log('\nR2  destructible terrain');
  const beforeSolid = await solidSamples();
  const feet = await page.evaluate(() => ({ x: window.__worms.game.active.x, y: window.__worms.game.active.y }));
  const farBefore = await farSolid(feet);
  await page.keyboard.press('5');
  await page.keyboard.down('Space');
  await sleep(200);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__worms.game.projectiles.length === 0, null, { timeout: 20000 });
  await sleep(300);
  const afterSolid = await solidSamples();
  check('the explosion destroyed terrain', afterSolid < beforeSolid, `${beforeSolid} -> ${afterSolid}`);
  check('the crater is empty at its centre',
    await page.evaluate(p => !window.__worms.terrain.solid(p.x, p.y + 6), feet));
  check('terrain more than 200px away is untouched', farBefore === await farSolid(feet),
    `${farBefore} -> ${await farSolid(feet)}`);
  await snap('06-dynamite.png');

  await page.waitForFunction(() => ['RETREAT', 'AIM', 'GAMEOVER'].includes(window.__worms.game.state),
    null, { timeout: 20000 });
  await page.keyboard.press('n');
  await sleep(400);

  /* --- R6: arsenal -------------------------------------------------------- */
  console.log('\nR6  weapons');
  s = await state();
  const team = s.turnTeam;
  const clusterBefore = s.ammo[team].cluster;
  await page.keyboard.press('3');
  check('key 3 selects the cluster bomb',
    await page.evaluate(() => window.__worms.WEAPONS[window.__worms.game.weaponIdx].id === 'cluster'));
  await page.keyboard.down('Space');
  await sleep(500);
  await page.keyboard.up('Space');
  await sleep(200);
  check('firing a limited weapon spends one round',
    (await state()).ammo[team].cluster === clusterBefore - 1,
    `${clusterBefore} -> ${(await state()).ammo[team].cluster}`);
  await page.waitForFunction(() => window.__worms.game.projectiles.length === 0,
    null, { timeout: 20000 });

  // R6.7 exactly: a cluster shell whose fuse runs out splits into 5 bomblets.
  // Placed directly so the assertion does not depend on where a lobbed shell
  // happens to roll before the fuse expires.
  const maxProj = await page.evaluate(async () => {
    const g = window.__worms.game;
    window.__worms.spawn('cluster', 400, 200, 0, 0, 0.15);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      peak = Math.max(peak, g.projectiles.length);
      await new Promise(r => setTimeout(r, 20));
    }
    return peak;
  });
  check('a cluster shell splits into 5 bomblets', maxProj >= 5, 'peak projectiles = ' + maxProj);
  await snap('07-cluster.png');

  await page.waitForFunction(() => ['RETREAT', 'AIM', 'GAMEOVER'].includes(window.__worms.game.state) &&
                                    window.__worms.game.projectiles.length === 0, null, { timeout: 25000 });
  await page.keyboard.press('n');
  await sleep(400);

  const shotgunTeam = (await state()).turnTeam;
  const shotgunBefore = (await state()).ammo[shotgunTeam].shotgun;
  await page.keyboard.press('4');
  await page.keyboard.down('Space');
  await sleep(300);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => ['AIM', 'RETREAT', 'GAMEOVER'].includes(window.__worms.game.state),
    null, { timeout: 20000 });
  s = await state();
  check('the shotgun keeps the turn alive for a second shot',
    s.state === 'AIM' && s.shotsLeft === 1, JSON.stringify({ state: s.state, shotsLeft: s.shotsLeft }));
  check('two shotgun shots cost one round of ammunition',
    s.ammo[shotgunTeam].shotgun === shotgunBefore - 1,
    `${shotgunBefore} -> ${s.ammo[shotgunTeam].shotgun}`);
  await page.keyboard.down('Space');
  await sleep(300);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__worms.game.shotsLeft === 0 &&
    ['RETREAT', 'AIM', 'GAMEOVER'].includes(window.__worms.game.state), null, { timeout: 20000 });
  s = await state();
  check('the second shot closes the turn', s.state === 'RETREAT' || s.state === 'GAMEOVER', s.state);

  /* --- R4.6 / R10.2: the sea kills --------------------------------------- */
  console.log('\nR10  hazards');
  const drowned = await page.evaluate(async () => {
    const g = window.__worms.game;
    const victim = g.teams[0].worms.find(w => !w.dead);
    victim.y = 890; victim.airborne = true; victim.vy = 2;
    await new Promise(r => setTimeout(r, 400));
    return victim.dead;
  });
  check('a worm dropped into the sea drowns', drowned);

  /* --- R9: victory --------------------------------------------------------- */
  console.log('\nR9  victory');
  const over = await page.evaluate(async () => {
    const g = window.__worms.game;
    g.teams[1].worms.forEach(w => { w.health = 0; w.dead = true; });
    g.state = 'SETTLE';
    await new Promise(r => setTimeout(r, 700));
    return {
      state: g.state,
      overlay: document.getElementById('result').classList.contains('show'),
      title: document.getElementById('result-title').textContent
    };
  });
  check('wiping a team ends the match', over.state === 'GAMEOVER' && over.overlay, JSON.stringify(over));
  check('the surviving team is declared the winner', over.title === 'RED TEAM WINS', over.title);
  await snap('08-victory.png');

  await page.click('#rematch-btn');
  await sleep(800);
  s = await state();
  check('rematch starts a fresh match', s.state === 'AIM' && s.alive[0] === 4 && s.alive[1] === 4,
    JSON.stringify(s.alive));
  await snap('09-rematch.png');

  check('no console or page errors', errors.length === 0, errors.join(' | '));

  await browser.close();

  console.log('\n' + '-'.repeat(60));
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) { process.exit(1); }
  console.log('screenshots in ' + path.relative(process.cwd(), SHOTS));
})();
