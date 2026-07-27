/* WORMS smoke test — drives the real game in headless Chromium via Playwright.
   Usage:  node test/smoke.js            (expects http://localhost:8123 running)
   Saves screenshots to test/screenshots/ and fails on any console error.
*/
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.WORMS_URL || 'http://localhost:8123';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
let failed = false;

function check(name, cond, extra = '') {
  const ok = !!cond;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
  if (!ok) failed = true;
}

(async () => {
  const browser = await chromium.launch({
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 760 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const S = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const st = () => page.evaluate(() => ({
    state,
    weaponIdx,
    power: +power.toFixed(2),
    wind: +wind.toFixed(2),
    turnTimer: +turnTimer.toFixed(1),
    activeTeam,
    turns,
    alive: [aliveCount(0), aliveCount(1)],
    hp: [teamHP(0), teamHP(1)],
    worm: activeWorm ? { x: +activeWorm.x.toFixed(0), y: +activeWorm.y.toFixed(0), name: activeWorm.name, onGround: activeWorm.onGround } : null,
    projectile: projectile ? { type: projectile.type, x: +projectile.x.toFixed(0), y: +projectile.y.toFixed(0), fuse: +projectile.fuse.toFixed(1) } : null,
    cam: { x: +cam.x.toFixed(0), y: +cam.y.toFixed(0) },
  }));

  const waitState = async (want, timeout = 10000) => {
    try {
      await page.waitForFunction((w) => state === w, want, { timeout });
      return true;
    } catch { return false; }
  };
  const waitGrounded = async () => {
    try {
      await page.waitForFunction(
        () => state === 'aim' && activeWorm && activeWorm.alive && activeWorm.onGround,
        null, { timeout: 8000 });
      return true;
    } catch { return false; }
  };

  console.log('— title screen —');
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(700);
  let s = await st();
  check('boots to title state', s.state === 'title');
  await S('01-title');

  console.log('— start match —');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  s = await st();
  check('match starts in aim state', s.state === 'aim');
  check('6 worms alive (3v3)', s.alive[0] === 3 && s.alive[1] === 3, JSON.stringify(s.alive));
  check('active worm exists & grounded', !!s.worm && await waitGrounded(), JSON.stringify(s.worm));
  const spawnOK = await page.evaluate(() =>
    worms.every(w => w.x > 0 && w.x < WORLD_W && w.y > 0 && w.y < WATER_Y));
  check('all worms spawned inside world above water', spawnOK);
  check('turn timer ~30s', s.turnTimer > 27 && s.turnTimer <= 30, String(s.turnTimer));
  check('camera snapped to worm', Math.abs(s.cam.x - Math.max(0, Math.min(640, s.worm.x - 480))) < 60, JSON.stringify(s.cam) + ' worm.x=' + s.worm.x);
  await S('02-match-start');

  console.log('— movement & aiming —');
  const x0 = s.worm.x;
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  s = await st();
  check('worm walks right', s.worm.x > x0 + 15, x0 + ' -> ' + s.worm.x);

  await page.keyboard.press('Enter'); // jump
  await page.waitForTimeout(250);
  s = await st();
  const jumped = !s.worm.onGround || true; // airborne frame may be short; just log
  console.log('  INFO after jump: ' + JSON.stringify(s.worm));
  await page.waitForTimeout(900);

  console.log('— bazooka: charge & fire —');
  check('worm grounded before firing', await waitGrounded());
  await page.keyboard.press('1');
  await page.keyboard.down(' ');
  await page.waitForTimeout(650);
  s = await st();
  check('charging fills power', s.state === 'charge' && s.power > 0.3, s.state + ' p=' + s.power);
  await S('03-charging');
  await page.keyboard.up(' ');
  await page.waitForTimeout(260);
  s = await st();
  check('bazooka in flight (projectile state)', s.state === 'projectile' && s.projectile && s.projectile.type === 0, s.state + ' ' + JSON.stringify(s.projectile));
  await S('04-flight');
  const teamBefore = s.activeTeam;
  check('turn advances after shot', await waitState('aim', 12000), 'state=' + (await st()).state);
  s = await st();
  check('other team now active', s.activeTeam === 1 - teamBefore, 'team=' + s.activeTeam);
  await S('05-after-shot');

  console.log('— grenade: fuse & retreat —');
  await waitGrounded();
  await page.keyboard.press('2');
  s = await st();
  check('grenade selected', s.weaponIdx === 1);
  await page.keyboard.down(' ');
  await page.waitForTimeout(500);
  await page.keyboard.up(' ');
  await page.waitForTimeout(400);
  s = await st();
  check('grenade thrown, retreat state w/ fuse', s.state === 'retreat' && s.projectile && s.projectile.fuse > 0, s.state + ' ' + JSON.stringify(s.projectile));
  await S('06-grenade-retreat');
  check('grenade detonates & turn ends', await waitState('aim', 9000));

  console.log('— dynamite —');
  await waitGrounded();
  await page.keyboard.press('3');
  await page.keyboard.down(' ');
  await page.waitForTimeout(200);
  await page.keyboard.up(' ');
  await page.waitForTimeout(300);
  s = await st();
  check('dynamite dropped w/ 5s fuse', s.state === 'retreat' && s.projectile && s.projectile.type === 2, s.state + ' ' + JSON.stringify(s.projectile));
  await S('07-dynamite');
  check('dynamite detonates & turn ends', await waitState('aim', 10000));
  await S('08-craters');

  console.log('— terrain destruction —');
  const carved = await page.evaluate(() => {
    let emptyCols = 0;
    for (let gx = 0; gx < GW; gx++) if (surface[gx] >= GH) emptyCols++;
    return emptyCols;
  });
  console.log('  INFO fully-carved columns: ' + carved);

  console.log('— forced victory & restart —');
  await page.evaluate(() => {
    for (const w of worms) if (w.team === 1) hurtWorm(w, 9999, 0, 0);
    enterSettle(0.1);
  });
  check('victory screen shows', await waitState('gameover', 5000));
  s = await st();
  check('red declared winner', s.alive[1] === 0, JSON.stringify(s.alive));
  await page.waitForTimeout(300);
  await S('09-victory');
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  s = await st();
  check('rematch starts fresh', s.state === 'aim' && s.alive[0] === 3 && s.alive[1] === 3);
  await S('10-rematch');

  console.log('— demo bot endurance (25s) —');
  await page.goto(BASE + '/index.html?demo');
  await page.waitForTimeout(25000);
  const demo = await page.evaluate(() => ({ state, turns, alive: [aliveCount(0), aliveCount(1)] }));
  console.log('  INFO demo: ' + JSON.stringify(demo));
  check('demo bot keeps game flowing', demo.turns >= 2 || demo.state === 'gameover', 'turns=' + demo.turns);
  await S('11-demo');

  check('zero console/page errors across all tests', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  console.log(failed ? '\nRESULT: FAILURES — see above' : '\nRESULT: ALL GREEN');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
