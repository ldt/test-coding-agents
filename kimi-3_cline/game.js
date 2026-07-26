/* ============================================================================
   WORMS — 2-player hot-seat artillery clone
   Zero-dependency vanilla JS. Single canvas. See spec/design.md.
   ============================================================================ */
'use strict';

/* ---------------------------------------------------------------- config */
const WORLD_W = 1600, WORLD_H = 640;      // world size in px
const VIEW_W = 960, VIEW_H = 540;         // viewport size in px
const CELL = 2;                           // terrain cell size in px
const GW = WORLD_W / CELL | 0;            // terrain grid width  (800)
const GH = WORLD_H / CELL | 0;            // terrain grid height (320)
const WATER_Y = 614;                      // water surface y (world px)

const GRAVITY = 900;                      // px/s^2
const MAX_FALL = 720;                     // terminal velocity
const WORM_R = 8;                         // worm body radius
const WALK_SPEED = 58;                    // px/s
const JUMP_VY = -335;                     // jump impulse
const FALL_SAFE_V = 520;                  // px/s before fall damage
const FALL_DMG_K = 0.06;

const TURN_TIME = 30;                     // seconds per turn
const WORMS_PER_TEAM = 3;
const WORM_HP = 100;
const SETTLE_TIME = 1.0;

const WIND_MAX = 3;
const WIND_ACCEL = 35;                    // px/s^2 per wind unit (bazooka only)

const TEAMS = [
  { name: 'RED',  color: '#e74c3c', dark: '#7e2318' },
  { name: 'BLUE', color: '#3498db', dark: '#1a4e74' },
];

const WEAPONS = [
  { name: 'Bazooka',  icon: '\u{1F680}', minV: 250, maxV: 640, radius: 45, dmg: 50, fuse: 0 },
  { name: 'Grenade',  icon: '\u{1F4A3}', minV: 210, maxV: 520, radius: 40, dmg: 45, fuse: 3 },
  { name: 'Dynamite', icon: '\u{1F9E8}', minV: 0,   maxV: 0,   radius: 62, dmg: 75, fuse: 5 },
];

const WORM_NAMES = [
  ['Jimmy', 'Spudge', 'Clive'],
  ['Boggy', 'Rex', 'Fletch'],
];

const MONO = '"Courier New", ui-monospace, monospace';
const DEMO = /[?&]demo\b/.test(location.search);

/* ---------------------------------------------------------------- canvas */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* ------------------------------------------------------------ terrain */
const grid = new Uint8Array(GW * GH);           // 1 = solid
const surface = new Int16Array(GW);             // first solid cell row per column

const terrainCanvas = document.createElement('canvas');
terrainCanvas.width = WORLD_W;
terrainCanvas.height = WORLD_H;
const terrainCtx = terrainCanvas.getContext('2d');
const terrainImg = terrainCtx.createImageData(WORLD_W, WORLD_H);

/** deterministic noise in [0,1) — repaint-stable */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function gridAt(gx, gy) {
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return 0;
  return grid[gx + gy * GW];
}

/** solidity query in world px; world sides are walls, sky/water column open */
function solidPx(x, y) {
  if (x < 0 || x >= WORLD_W) return true;
  if (y < 0 || y >= WORLD_H) return false;
  return grid[((x / CELL) | 0) + ((y / CELL) | 0) * GW] === 1;
}

function genTerrain() {
  grid.fill(0);
  const p1 = Math.random() * 7, p2 = Math.random() * 7, p3 = Math.random() * 7;
  const f1 = 1.6 + Math.random() * 1.6, f2 = 3.0 + Math.random() * 2.4, f3 = 6.0 + Math.random() * 4.0;
  const a1 = 78 + Math.random() * 46, a2 = 34 + Math.random() * 22, a3 = 10 + Math.random() * 12;

  for (let gx = 0; gx < GW; gx++) {
    const t = gx / GW;
    let h = 300
      + a1 * Math.sin(t * Math.PI * 2 * f1 + p1)
      + a2 * Math.sin(t * Math.PI * 2 * f2 + p2)
      + a3 * Math.sin(t * Math.PI * 2 * f3 + p3);
    // raised borders so worms can't easily leave the sides
    const edge = Math.max(0, 0.09 - Math.min(t, 1 - t)) / 0.09;
    h -= edge * 150;
    h = Math.max(150, Math.min(560, h));
    const gy0 = (h / CELL) | 0;
    for (let gy = gy0; gy < GH; gy++) grid[gx + gy * GW] = 1;
  }

  // carve a couple of caves for character
  for (let c = 0; c < 2; c++) {
    const cx = (0.2 + Math.random() * 0.6) * GW;
    const cy = (0.62 + Math.random() * 0.2) * GH;
    const rx = 26 + Math.random() * 26, ry = 12 + Math.random() * 10;
    for (let gy = Math.max(0, cy - ry | 0); gy < Math.min(GH, cy + ry); gy++)
      for (let gx = Math.max(0, cx - rx | 0); gx < Math.min(GW, cx + rx); gx++) {
        const dx = (gx - cx) / rx, dy = (gy - cy) / ry;
        if (dx * dx + dy * dy < 1) grid[gx + gy * GW] = 0;
      }
  }

  refreshSurface(0, GW - 1);
}

function refreshSurface(gx0, gx1) {
  for (let gx = Math.max(0, gx0); gx <= Math.min(GW - 1, gx1); gx++) {
    surface[gx] = GH;
    for (let gy = 0; gy < GH; gy++) {
      if (grid[gx + gy * GW] === 1) { surface[gx] = gy; break; }
    }
  }
}

/** write one cell column (2 px wide) into the terrain ImageData */
function paintColumn(gx) {
  const d = terrainImg.data;
  const surf = surface[gx];
  for (let gy = 0; gy < GH; gy++) {
    const solid = gridAt(gx, gy) === 1;
    let r = 0, g = 0, b = 0, a = 0;
    if (solid) {
      const depth = gy - surf;
      const n = hash2(gx, gy);
      if (depth <= 2) {                       // grass band
        r = 52 + n * 26; g = 150 + n * 44; b = 52 + n * 22;
      } else {                                // dirt, darker with depth
        const t = Math.min(1, (gy * CELL) / WORLD_H);
        const v = 0.82 + n * 0.36;
        r = (128 - 66 * t) * v; g = (82 - 42 * t) * v; b = (44 - 22 * t) * v;
      }
      a = 255;
    }
    for (let py = gy * CELL; py < gy * CELL + CELL; py++)
      for (let px = gx * CELL; px < gx * CELL + CELL; px++) {
        const i = (px + py * WORLD_W) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
      }
  }
}

function repaintColumns(gx0, gx1) {
  gx0 = Math.max(0, gx0 | 0); gx1 = Math.min(GW - 1, gx1 | 0);
  for (let gx = gx0; gx <= gx1; gx++) paintColumn(gx);
  terrainCtx.putImageData(terrainImg, 0, 0);
}

function paintAllTerrain() {
  for (let gx = 0; gx < GW; gx++) paintColumn(gx);
  terrainCtx.putImageData(terrainImg, 0, 0);
}

/* ------------------------------------------------------------ entities */
let teams = [];                 // [{worms:[...], cursor}]
let worms = [];                 // flat list
let activeWorm = null;
let activeTeam = 0;
let projectile = null;          // {type,x,y,vx,vy,fuse,smokeT}
let particles = [];
let flashes = [];

let state = 'title';            // title|aim|charge|projectile|retreat|settle|gameover
let weaponIdx = 0;
let power = 0;
let chargeLatch = false;        // space held & not yet consumed by a shot
let wind = 0;
let turnTimer = TURN_TIME;
let settleT = 0;
let bannerT = 0, bannerText = '';
let winner = -1;                // -1 none, 0 red, 1 blue, 2 draw
let turns = 0;
let time = 0;

const cam = { x: 0, y: WORLD_H - VIEW_H };
let shakeT = 0, shakeMag = 0;

const clouds = [];
for (let i = 0; i < 7; i++) clouds.push({
  x: Math.random() * WORLD_W, y: 30 + Math.random() * 160,
  s: 0.6 + Math.random() * 0.9, v: 6 + Math.random() * 10,
});

/* ------------------------------------------------------------ helpers */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

function spawnParticles(x, y, n, opts) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(opts.sp0, opts.sp1);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 0),
      life: rand(opts.l0, opts.l1), t: 0,
      size: rand(opts.s0, opts.s1),
      color: opts.colors[Math.random() * opts.colors.length | 0],
      grav: opts.grav, grow: opts.grow || 0,
    });
  }
}

/* ------------------------------------------------------------ match setup */
function makeWorm(team, name, x, y) {
  return {
    team, name, x, y, vx: 0, vy: 0,
    hp: WORM_HP, alive: true,
    facing: team === 0 ? 1 : -1,
    aimDeg: 30, onGround: true,
  };
}

function findSpawnColumn(zone) {
  for (let tries = 0; tries < 60; tries++) {
    const gx = ((zone + rand(0.08, 0.92)) * (GW / 6)) | 0;
    const surf = surface[clamp(gx, 0, GW - 1)];
    if (surf < GH && surf * CELL < WATER_Y - 30) return gx;
  }
  return ((zone + 0.5) * GW / 6) | 0;
}

function newMatch() {
  genTerrain();
  paintAllTerrain();

  worms = [];
  teams = TEAMS.map((t, ti) => ({ def: t, worms: [], cursor: 0 }));
  const zones = [0, 3, 1, 4, 2, 5];
  for (let i = 0; i < WORMS_PER_TEAM * 2; i++) {
    const team = i % 2;
    const gx = findSpawnColumn(zones[i]);
    const surf = surface[clamp(gx, 0, GW - 1)];
    const y = (surf < GH ? surf * CELL : WORLD_H * 0.5) - WORM_R - 1;
    const w = makeWorm(team, WORM_NAMES[team][teams[team].worms.length], gx * CELL, y);
    teams[team].worms.push(w);
    worms.push(w);
  }

  particles = [];
  flashes = [];
  projectile = null;
  weaponIdx = 0;
  winner = -1;
  turns = 0;
  activeTeam = 0;
  teams.forEach(t => t.cursor = 0);

  startTurn();
  state = 'aim';
}

function aliveCount(team) {
  const t = teams[team];
  return t ? t.worms.reduce((n, w) => n + (w.alive ? 1 : 0), 0) : 0;
}

function teamHP(team) {
  const t = teams[team];
  return t ? t.worms.reduce((n, w) => n + (w.alive ? w.hp : 0), 0) : 0;
}

function nextLivingWorm(team) {
  const ws = teams[team].worms;
  for (let i = 0; i < ws.length; i++) {
    teams[team].cursor = (teams[team].cursor + 1) % ws.length;
    if (ws[teams[team].cursor].alive) return ws[teams[team].cursor];
  }
  return null;
}

function startTurn() {
  activeWorm = nextLivingWorm(activeTeam);
  wind = rand(-WIND_MAX, WIND_MAX);
  turnTimer = TURN_TIME;
  power = 0;
  turns++;
  if (activeWorm) {
    bannerText = TEAMS[activeTeam].name + ' — ' + activeWorm.name + "'s turn";
    bannerT = 1.8;
    snapCamera(activeWorm.x, activeWorm.y);
  }
  syncWeaponButtons();
}

function nextTurn() {
  activeTeam = 1 - activeTeam;
  startTurn();
  state = 'aim';
}

function enterSettle(t) {
  state = 'settle';
  settleT = t;
  power = 0;
}

function endMatch() {
  const a = aliveCount(0), b = aliveCount(1);
  winner = a === 0 && b === 0 ? 2 : a === 0 ? 1 : 0;
  state = 'gameover';
  syncWeaponButtons();
}

function checkVictory() {
  if (aliveCount(0) === 0 || aliveCount(1) === 0) { endMatch(); return true; }
  return false;
}

/* ------------------------------------------------------------ combat */
function hurtWorm(w, dmg, kx, ky) {
  if (!w.alive) return;
  w.hp -= dmg;
  if (kx || ky) { w.vx += kx; w.vy += ky; w.onGround = false; }
  if (w.hp <= 0) killWorm(w);
}

function killWorm(w) {
  if (!w.alive) return;
  w.alive = false;
  w.hp = 0;
  spawnParticles(w.x, w.y, 22, {
    sp0: 40, sp1: 190, up: 60, l0: 0.4, l1: 1.0, s0: 1.5, s1: 3.5,
    colors: ['#c9ccd6', '#9aa0b0', TEAMS[w.team].color], grav: 500,
  });
}

function explode(x, y, radius, maxDmg) {
  // carve terrain
  const gr = Math.ceil(radius / CELL);
  const cgx = (x / CELL) | 0, cgy = (y / CELL) | 0;
  for (let dy = -gr; dy <= gr; dy++)
    for (let dx = -gr; dx <= gr; dx++) {
      if (dx * dx + dy * dy > gr * gr) continue;
      const gx = cgx + dx, gy = cgy + dy;
      if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) grid[gx + gy * GW] = 0;
    }
  refreshSurface(cgx - gr, cgx + gr);
  repaintColumns(cgx - gr, cgx + gr);

  // damage + knockback
  for (const w of worms) {
    if (!w.alive) continue;
    const d = dist(w.x, w.y, x, y);
    const reach = radius * 1.5;
    if (d < reach) {
      const f = 1 - d / reach;
      const a = Math.atan2(w.y - y, w.x - x);
      const imp = 460 * f;
      hurtWorm(w, Math.round(maxDmg * f), Math.cos(a) * imp, Math.sin(a) * imp - 110 * f);
    }
  }

  // juice
  flashes.push({ x, y, t: 0, life: 0.32, max: radius * 1.25 });
  spawnParticles(x, y, 34, {
    sp0: 60, sp1: 330, up: 40, l0: 0.35, l1: 0.9, s0: 1.5, s1: 3.5,
    colors: ['#8a5a2e', '#6b4423', '#4c3018', '#ffb347', '#ff7b2e'], grav: 620,
  });
  spawnParticles(x, y, 12, {
    sp0: 15, sp1: 70, up: 50, l0: 0.8, l1: 1.8, s0: 4, s1: 9,
    colors: ['rgba(120,120,130,0.5)', 'rgba(90,90,100,0.45)'], grav: -40, grow: 6,
  });
  shakeT = 0.45;
  shakeMag = Math.min(14, radius * 0.22);
}

function splash(x) {
  spawnParticles(x, WATER_Y, 14, {
    sp0: 30, sp1: 160, up: 180, l0: 0.3, l1: 0.7, s0: 1.5, s1: 3,
    colors: ['#7ec8f0', '#4aa3dd', '#bfe6fa'], grav: 700,
  });
}

function fire() {
  const w = activeWorm;
  if (!w || !w.alive) return;
  const def = WEAPONS[weaponIdx];
  const a = w.aimDeg * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);

  if (weaponIdx === 2) {           // dynamite: dropped at feet
    projectile = {
      type: weaponIdx,
      x: w.x + w.facing * (WORM_R + 5), y: w.y - 2,
      vx: w.facing * 26, vy: -40,
      fuse: def.fuse, smokeT: 0,
    };
  } else {
    const v = def.minV + power * (def.maxV - def.minV);
    projectile = {
      type: weaponIdx,
      x: w.x + w.facing * cos * (WORM_R + 6),
      y: w.y - sin * (WORM_R + 6) - 2,
      vx: w.facing * cos * v, vy: -sin * v,
      fuse: def.fuse, smokeT: 0,
    };
  }
  power = 0;
  chargeLatch = false;
  state = weaponIdx === 0 ? 'projectile' : 'retreat';
  syncWeaponButtons();
}

/* ------------------------------------------------------------ physics */
function wormGrounded(x, y) {
  return solidPx(x, y + WORM_R) || solidPx(x - 4, y + WORM_R) || solidPx(x + 4, y + WORM_R);
}

function wormPhysics(w, dt) {
  if (!w.alive) return;

  w.vy = Math.min(w.vy + GRAVITY * dt, MAX_FALL);

  // horizontal — body strip test excludes lowest 6px → free step-up
  if (w.vx !== 0) {
    const dir = Math.sign(w.vx);
    const nx = w.x + w.vx * dt;
    let blocked = false;
    for (let py = w.y - WORM_R + 2; py <= w.y + WORM_R - 7; py += 2) {
      if (solidPx(nx + dir * (WORM_R - 1), py)) { blocked = true; break; }
    }
    if (blocked) w.vx = 0; else w.x = clamp(nx, WORM_R, WORLD_W - WORM_R);
  }

  // vertical
  const ny = w.y + w.vy * dt;
  if (w.vy >= 0) {
    if (wormGrounded(w.x, ny)) {
      // landing
      let y = ny, guard = 0;
      while (wormGrounded(w.x, y) && guard++ < 40) y -= 1;
      if (w.vy > FALL_SAFE_V) {
        const dmg = Math.round((w.vy - FALL_SAFE_V) * FALL_DMG_K);
        if (dmg > 0) {
          hurtWorm(w, dmg, 0, 0);
          if (w === activeWorm && (state === 'aim' || state === 'charge' || state === 'retreat')) {
            power = 0;
            enterSettle(0.8);
          }
        }
      }
      w.y = y; w.vy = 0; w.onGround = true;
    } else {
      w.y = ny; w.onGround = false;
    }
  } else {
    if (solidPx(w.x, ny - WORM_R + 2)) { w.vy = 0; }
    else w.y = ny;
    w.onGround = false;
  }

  // stick to ground on down-slopes
  if (w.onGround) {
    let y = w.y, g = 0;
    while (!wormGrounded(w.x, y + 1) && g++ < 6) y += 1;
    w.y = y;
    if (!wormGrounded(w.x, w.y + 1)) w.onGround = false;
  }

  // ground friction
  if (w.onGround) w.vx *= Math.pow(0.0001, dt);

  // drowning
  if (w.y > WATER_Y - 2) {
    splash(w.x);
    killWorm(w);
  }
}

function surfNormal(x, y) {
  let nx = 0, ny = 0;
  if (solidPx(x - 3, y)) nx -= 1;
  if (solidPx(x + 3, y)) nx += 1;
  if (solidPx(x, y - 3)) ny -= 1;
  if (solidPx(x, y + 3)) ny += 1;
  const l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
}

function updateProjectile(dt) {
  const p = projectile;
  if (!p) return;
  const def = WEAPONS[p.type];

  p.fuse -= dt;
  if (p.fuse <= 0 && p.type !== 0) {
    explode(p.x, p.y, def.radius, def.dmg);
    projectile = null;
    enterSettle(SETTLE_TIME);
    return;
  }

  if (p.type === 0) p.vx += wind * WIND_ACCEL * dt;   // bazooka loves wind
  p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // trails
  p.smokeT -= dt;
  if (p.smokeT <= 0) {
    p.smokeT = p.type === 0 ? 0.03 : 0.08;
    if (p.type === 0) {
      particles.push({
        x: p.x, y: p.y, vx: 0, vy: -14, life: 0.5, t: 0, size: 2,
        color: 'rgba(200,200,210,0.4)', grav: 0, grow: 3,
      });
    } else if (p.type === 2) {  // dynamite spark
      spawnParticles(p.x, p.y - 4, 1, {
        sp0: 20, sp1: 60, up: 40, l0: 0.15, l1: 0.3, s0: 1, s1: 2,
        colors: ['#ffd23f', '#ff9a2e'], grav: 200,
      });
    }
  }

  // out of bounds / water
  if (p.x < -24 || p.x > WORLD_W + 24) { projectile = null; enterSettle(0.3); return; }
  if (p.y > WATER_Y) { splash(p.x); projectile = null; enterSettle(0.4); return; }

  // worm contact (bazooka detonates, others pass through)
  if (p.type === 0) {
    for (const w of worms) {
      if (w.alive && w !== activeWorm && dist(p.x, p.y, w.x, w.y) < WORM_R + 3) {
        explode(p.x, p.y, def.radius, def.dmg);
        projectile = null;
        enterSettle(SETTLE_TIME);
        return;
      }
    }
  }

  // terrain
  if (solidPx(p.x, p.y)) {
    if (p.type === 0) {
      explode(p.x, p.y, def.radius, def.dmg);
      projectile = null;
      enterSettle(SETTLE_TIME);
      return;
    }
    // bounce / settle along estimated normal
    const [nx, ny] = surfNormal(p.x, p.y);
    if (nx === 0 && ny === 0) { p.vx *= -0.4; p.vy *= -0.4; }
    else {
      p.x += nx * 2; p.y += ny * 2;
      const dot = p.vx * nx + p.vy * ny;
      const rest = p.type === 1 ? 0.45 : 0.08;
      p.vx -= (1 + rest) * dot * nx;
      p.vy -= (1 + rest) * dot * ny;
      // tangential friction
      const fr = p.type === 1 ? 0.8 : 0.5;
      p.vx *= fr; p.vy *= fr;
      if (p.type === 2 && Math.hypot(p.vx, p.vy) < 30) { p.vx = 0; p.vy = 0; }
    }
  }
}

/* ------------------------------------------------------------ update */
const keys = {};

function controlState() {
  return state === 'aim' || state === 'charge' || state === 'retreat';
}

function update(dt) {
  time += dt;

  // clouds drift regardless of state
  for (const c of clouds) {
    c.x += c.v * dt;
    if (c.x > WORLD_W + 120) c.x = -120;
  }
  if (bannerT > 0) bannerT -= dt;
  if (shakeT > 0) shakeT -= dt;

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.t += dt;
    if (pt.t >= pt.life) { particles.splice(i, 1); continue; }
    pt.vy += (pt.grav || 0) * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    if (pt.grow) pt.size += pt.grow * dt;
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].t += dt;
    if (flashes[i].t >= flashes[i].life) flashes.splice(i, 1);
  }

  if (state === 'title' || state === 'gameover') return;

  // turn timer
  if (state === 'aim' || state === 'charge') {
    turnTimer -= dt;
    if (turnTimer <= 0) {
      turnTimer = 0;
      power = 0;
      if (checkVictory()) return;
      nextTurn();
      return;
    }
  }

  // active worm control
  const w = activeWorm;
  if (w && w.alive && controlState()) {
    const canAct = state !== 'retreat' || true; // retreat still allows walking/jumping
    let move = 0;
    if (keys.ArrowLeft) move -= 1;
    if (keys.ArrowRight) move += 1;
    if (canAct) {
      if (move !== 0) {
        w.facing = move;
        if (w.onGround) w.vx = move * WALK_SPEED;
      } else if (w.onGround) {
        w.vx = 0;
      }
    }
    if (state !== 'retreat') {
      if (keys.ArrowUp) w.aimDeg = clamp(w.aimDeg + 65 * dt, -75, 90);
      if (keys.ArrowDown) w.aimDeg = clamp(w.aimDeg - 65 * dt, -75, 90);
    }
  }

  // begin charging when space is held and the worm is controllable & grounded
  if (chargeLatch && state === 'aim' && w && w.alive && w.onGround) {
    state = 'charge';
    power = 0;
    syncWeaponButtons();
  }

  // charging
  if (state === 'charge') {
    power += dt / 1.3;
    if (power >= 1) { power = 1; fire(); }
  }

  // projectile
  if (state === 'projectile' || state === 'retreat') updateProjectile(dt);

  // worms physics (all — knockback can hit anyone, anytime)
  for (const wm of worms) wormPhysics(wm, dt);

  // active worm died during its own turn
  if (controlState() && (!activeWorm || !activeWorm.alive)) enterSettle(0.8);

  // settle
  if (state === 'settle') {
    settleT -= dt;
    if (settleT <= 0) {
      if (checkVictory()) return;
      nextTurn();
    }
  }

  // camera
  let tx = null, ty = null;
  if ((state === 'projectile' || state === 'retreat') && projectile) {
    tx = projectile.x; ty = projectile.y;
  } else if (activeWorm && activeWorm.alive) {
    tx = activeWorm.x; ty = activeWorm.y;
  }
  if (tx !== null) {
    const k = 1 - Math.exp(-6 * dt);
    cam.x += (clamp(tx - VIEW_W / 2, 0, WORLD_W - VIEW_W) - cam.x) * k;
    cam.y += (clamp(ty - VIEW_H / 2, 0, WORLD_H - VIEW_H) - cam.y) * k;
  }
}

function snapCamera(x, y) {
  cam.x = clamp(x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  cam.y = clamp(y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
}

/* ------------------------------------------------------------ rendering */
let skyGrad = null;

function drawSky() {
  if (!skyGrad) {
    skyGrad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    skyGrad.addColorStop(0, '#2b5aa8');
    skyGrad.addColorStop(0.55, '#7fb2e5');
    skyGrad.addColorStop(1, '#cfe8f7');
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // sun
  const sx = VIEW_W - 130 - cam.x * 0.06, sy = 74;
  const sg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 60);
  sg.addColorStop(0, 'rgba(255,244,190,0.95)');
  sg.addColorStop(0.35, 'rgba(255,224,130,0.55)');
  sg.addColorStop(1, 'rgba(255,224,130,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(sx - 60, sy - 60, 120, 120);

  // clouds (parallax)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of clouds) {
    const cx = (c.x - cam.x * 0.3) % (WORLD_W + 240);
    const x = cx < -120 ? cx + WORLD_W + 240 : cx;
    if (x < -140 || x > VIEW_W + 140) continue;
    const y = c.y - cam.y * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, 16 * c.s, 0, 7);
    ctx.arc(x + 18 * c.s, y + 4 * c.s, 12 * c.s, 0, 7);
    ctx.arc(x - 18 * c.s, y + 5 * c.s, 11 * c.s, 0, 7);
    ctx.fill();
  }

  // distant hills
  ctx.fillStyle = 'rgba(70,110,90,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let x = 0; x <= VIEW_W; x += 8) {
    const wx = x + cam.x * 0.5;
    ctx.lineTo(x, 420 - cam.y * 0.35 + 34 * Math.sin(wx * 0.006) + 18 * Math.sin(wx * 0.017));
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

function drawWater() {
  const y0 = WATER_Y;
  ctx.save();
  ctx.globalAlpha = 0.78;
  const wg = ctx.createLinearGradient(0, y0, 0, WORLD_H);
  wg.addColorStop(0, '#3d8fd1');
  wg.addColorStop(1, '#123a66');
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.moveTo(cam.x - 20, y0);
  for (let x = cam.x - 20; x <= cam.x + VIEW_W + 20; x += 12)
    ctx.lineTo(x, y0 + Math.sin(x * 0.05 + time * 2.2) * 2.5);
  ctx.lineTo(cam.x + VIEW_W + 20, WORLD_H);
  ctx.lineTo(cam.x - 20, WORLD_H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#bfe6fa';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = cam.x - 20; x <= cam.x + VIEW_W + 20; x += 12) {
    const y = y0 + Math.sin(x * 0.05 + time * 2.2) * 2.5;
    if (x === cam.x - 20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawWorm(w) {
  if (!w.alive) return;
  const t = TEAMS[w.team];

  // body
  ctx.beginPath();
  ctx.arc(w.x, w.y, WORM_R, 0, 7);
  ctx.fillStyle = t.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.dark;
  ctx.stroke();

  // eye
  const ex = w.x + w.facing * 3, ey = w.y - 2.5;
  ctx.beginPath();
  ctx.arc(ex, ey, 2.6, 0, 7);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex + w.facing * 1.1, ey, 1.3, 0, 7);
  ctx.fillStyle = '#10131a';
  ctx.fill();

  // name + hp
  ctx.font = 'bold 9px ' + MONO;
  ctx.textAlign = 'center';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(w.name, w.x, w.y - 22);
  ctx.fillStyle = '#fff';
  ctx.fillText(w.name, w.x, w.y - 22);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(w.x - 13, w.y - 19, 26, 4);
  ctx.fillStyle = t.color;
  ctx.fillRect(w.x - 12, w.y - 18, 24 * (w.hp / WORM_HP), 2);

  // active marker
  if (w === activeWorm && controlState()) {
    const bob = Math.sin(time * 6) * 2;
    ctx.beginPath();
    ctx.moveTo(w.x - 5, w.y - 30 + bob);
    ctx.lineTo(w.x + 5, w.y - 30 + bob);
    ctx.lineTo(w.x, w.y - 24 + bob);
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.fill();

    // crosshair
    const a = w.aimDeg * Math.PI / 180;
    const cx = w.x + w.facing * Math.cos(a) * 34;
    const cy = w.y - Math.sin(a) * 34;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, 7);
    ctx.moveTo(cx - 9, cy); ctx.lineTo(cx - 3, cy);
    ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy - 3);
    ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 9);
    ctx.stroke();
  }
}

function drawProjectile() {
  const p = projectile;
  if (!p) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.type === 0) {                       // bazooka rocket
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = '#3a3f4a';
    ctx.fillRect(-7, -2.5, 12, 5);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(5, -2.5); ctx.lineTo(10, 0); ctx.lineTo(5, 2.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-7, -2); ctx.lineTo(-11 - Math.random() * 4, 0); ctx.lineTo(-7, 2);
    ctx.closePath(); ctx.fill();
  } else if (p.type === 1) {                // grenade
    ctx.fillStyle = '#2e6b34';
    ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#173d1c';
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#9aa0b0';
    ctx.fillRect(-1.5, -7.5, 3, 3);
  } else {                                  // dynamite bundle
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-6, -3.5, 12, 7);
    ctx.strokeStyle = '#7e2318';
    ctx.lineWidth = 1;
    ctx.strokeRect(-6, -3.5, 12, 7);
    ctx.beginPath(); ctx.moveTo(0, -3.5); ctx.lineTo(0, 3.5); ctx.stroke();
  }
  ctx.restore();

  // fuse countdown
  if (p.type !== 0 && p.fuse > 0) {
    ctx.font = 'bold 13px ' + MONO;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const s = Math.ceil(p.fuse).toString();
    ctx.strokeText(s, p.x, p.y - 14);
    ctx.fillStyle = p.fuse < 1.2 ? '#ff5a4e' : '#ffd23f';
    ctx.fillText(s, p.x, p.y - 14);
  }
}

function drawParticles() {
  for (const pt of particles) {
    ctx.globalAlpha = clamp(1 - pt.t / pt.life, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
}

function drawFlashes() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of flashes) {
    const k = f.t / f.life;
    const r = f.max * (0.4 + 0.6 * k);
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    g.addColorStop(0, 'rgba(255,255,230,' + (0.9 * (1 - k)) + ')');
    g.addColorStop(0.5, 'rgba(255,160,60,' + (0.55 * (1 - k)) + ')');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, 7);
    ctx.fill();
  }
  ctx.restore();
}

/* ------- HUD ------- */

function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTeamPanel(team, x, alignRight) {
  const def = TEAMS[team];
  const w = 196, h = 52;
  ctx.fillStyle = 'rgba(10,14,22,0.72)';
  rrect(x, 10, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = def.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = alignRight ? 'right' : 'left';
  ctx.font = 'bold 12px ' + MONO;
  ctx.fillStyle = def.color;
  const tx = alignRight ? x + w - 10 : x + 10;
  ctx.fillText(def.name + ' TEAM', tx, 26);

  // total hp bar
  const hp = teamHP(team), max = WORM_HP * WORMS_PER_TEAM;
  const bx = x + 10, bw = w - 20;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(bx, 32, bw, 7);
  ctx.fillStyle = def.color;
  ctx.fillRect(bx, 32, bw * (hp / max), 7);

  // worm pips
  for (let i = 0; i < WORMS_PER_TEAM; i++) {
    const worm = teams[team].worms[i];
    const px = alignRight ? x + w - 14 - i * 14 : x + 14 + i * 14;
    ctx.beginPath();
    ctx.arc(px, 49, 3.5, 0, 7);
    ctx.fillStyle = worm && worm.alive ? def.color : 'rgba(255,255,255,0.15)';
    ctx.fill();
  }
}

function drawHUD() {
  if (state === 'title') return;

  drawTeamPanel(0, 10, false);
  drawTeamPanel(1, VIEW_W - 10 - 196, true);

  // wind
  const wx = VIEW_W / 2 - 88, wy = 10, ww = 176, wh = 34;
  ctx.fillStyle = 'rgba(10,14,22,0.72)';
  rrect(wx, wy, ww, wh, 8); ctx.fill();
  ctx.strokeStyle = '#3d5080'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = 'bold 10px ' + MONO;
  ctx.fillStyle = '#8b98b3';
  ctx.fillText('WIND', wx + 10, wy + 21);
  const ax = wx + 98, ay = wy + wh / 2;
  const len = wind * 13;
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + len, ay);
  ctx.stroke();
  if (Math.abs(wind) > 0.15) {
    const dir = Math.sign(wind);
    ctx.beginPath();
    ctx.moveTo(ax + len, ay);
    ctx.lineTo(ax + len - dir * 6, ay - 4);
    ctx.lineTo(ax + len - dir * 6, ay + 4);
    ctx.closePath();
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#dfe7f5';
  ctx.font = 'bold 11px ' + MONO;
  ctx.fillText(Math.abs(wind).toFixed(1), wx + ww - 10, wy + 21);

  // timer
  if (state === 'aim' || state === 'charge') {
    const low = turnTimer <= 5;
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px ' + MONO;
    ctx.fillStyle = low ? (Math.sin(time * 10) > 0 ? '#ff5a4e' : '#ffd23f') : '#dfe7f5';
    ctx.fillText(Math.ceil(turnTimer).toString(), VIEW_W / 2, 74);
  }

  // weapon slots
  const sw = 64, sh = 42, gap = 8;
  const total = WEAPONS.length * sw + (WEAPONS.length - 1) * gap;
  let sx = VIEW_W / 2 - total / 2;
  const sy = VIEW_H - sh - 10;
  for (let i = 0; i < WEAPONS.length; i++) {
    const sel = i === weaponIdx;
    ctx.fillStyle = sel ? 'rgba(40,52,80,0.9)' : 'rgba(10,14,22,0.72)';
    rrect(sx, sy, sw, sh, 8); ctx.fill();
    ctx.strokeStyle = sel ? '#ffd23f' : '#3d5080';
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.stroke();
    ctx.font = '16px ' + MONO;
    ctx.textAlign = 'center';
    ctx.fillText(WEAPONS[i].icon, sx + sw / 2, sy + 22);
    ctx.font = 'bold 9px ' + MONO;
    ctx.fillStyle = sel ? '#ffd23f' : '#8b98b3';
    ctx.fillText((i + 1) + ' ' + WEAPONS[i].name, sx + sw / 2, sy + 35);
    sx += sw + gap;
  }

  // power bar
  if (state === 'charge') {
    const pw = 240, ph = 14, px = VIEW_W / 2 - pw / 2, py = sy - 26;
    ctx.fillStyle = 'rgba(10,14,22,0.8)';
    rrect(px - 3, py - 3, pw + 6, ph + 6, 6); ctx.fill();
    const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
    pg.addColorStop(0, '#7ac74f');
    pg.addColorStop(0.6, '#ffd23f');
    pg.addColorStop(1, '#ff5a4e');
    ctx.fillStyle = pg;
    ctx.fillRect(px, py, pw * power, ph);
    ctx.strokeStyle = '#dfe7f5';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);
  }

  // controls hint
  ctx.textAlign = 'left';
  ctx.font = '10px ' + MONO;
  ctx.fillStyle = 'rgba(223,231,245,0.5)';
  ctx.fillText('\u2190\u2192 walk  \u2191\u2193 aim  SPACE fire  ENTER jump  1-3 weapon', 12, VIEW_H - 14);

  // turn banner
  if (bannerT > 0) {
    const a = clamp(bannerT, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px ' + MONO;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(bannerText, VIEW_W / 2, 120);
    ctx.fillStyle = TEAMS[activeTeam].color;
    ctx.fillText(bannerText, VIEW_W / 2, 120);
    ctx.globalAlpha = 1;
  }
}

function drawTitle() {
  ctx.fillStyle = 'rgba(6,9,15,0.82)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.font = 'bold 72px ' + MONO;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1c2a12';
  ctx.strokeText('WORMS', VIEW_W / 2, 170);
  ctx.fillStyle = '#7ac74f';
  ctx.fillText('WORMS', VIEW_W / 2, 170);

  ctx.font = 'bold 14px ' + MONO;
  ctx.fillStyle = '#8b98b3';
  ctx.fillText('2 - P L A Y E R   H O T - S E A T   A R T I L L E R Y', VIEW_W / 2, 205);

  const lines = [
    ['\u2190 \u2192', 'walk'],
    ['\u2191 \u2193', 'aim'],
    ['SPACE', 'hold to charge, release to fire'],
    ['ENTER', 'jump'],
    ['1 2 3', 'bazooka / grenade / dynamite'],
  ];
  ctx.font = '13px ' + MONO;
  let y = 262;
  for (const [k, v] of lines) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(k, VIEW_W / 2 - 14, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dfe7f5';
    ctx.fillText(v, VIEW_W / 2 + 14, y);
    y += 26;
  }

  if (Math.sin(time * 4) > -0.3) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px ' + MONO;
    ctx.fillStyle = '#fff';
    ctx.fillText('PRESS ENTER OR CLICK TO START', VIEW_W / 2, 450);
  }
  if (DEMO) {
    ctx.font = 'bold 11px ' + MONO;
    ctx.fillStyle = '#ff9a2e';
    ctx.fillText('— DEMO MODE —', VIEW_W / 2, 480);
  }
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(6,9,15,0.78)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.font = 'bold 44px ' + MONO;
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  let msg, color;
  if (winner === 2) { msg = 'DRAW!'; color = '#dfe7f5'; }
  else { msg = TEAMS[winner].name + ' TEAM WINS!'; color = TEAMS[winner].color; }
  ctx.strokeText(msg, VIEW_W / 2, 220);
  ctx.fillStyle = color;
  ctx.fillText(msg, VIEW_W / 2, 220);

  ctx.font = '14px ' + MONO;
  ctx.fillStyle = '#8b98b3';
  ctx.fillText(turns + ' turns played', VIEW_W / 2, 262);

  if (Math.sin(time * 4) > -0.3) {
    ctx.font = 'bold 15px ' + MONO;
    ctx.fillStyle = '#fff';
    ctx.fillText('PRESS R OR CLICK FOR REMATCH', VIEW_W / 2, 330);
  }
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawSky();

  // world space
  ctx.save();
  let shx = 0, shy = 0;
  if (shakeT > 0) {
    const k = shakeT / 0.45;
    shx = (Math.random() * 2 - 1) * shakeMag * k;
    shy = (Math.random() * 2 - 1) * shakeMag * k;
  }
  ctx.translate(-Math.round(cam.x + shx), -Math.round(cam.y + shy));

  drawWater();
  ctx.drawImage(terrainCanvas, 0, 0);
  drawProjectile();
  for (const w of worms) drawWorm(w);
  drawParticles();
  drawFlashes();

  ctx.restore();

  // screen space
  drawHUD();
  if (state === 'title') drawTitle();
  if (state === 'gameover') drawGameOver();
}

/* ------------------------------------------------------------ input */
const wbtns = Array.from(document.querySelectorAll('.wbtn'));

function syncWeaponButtons() {
  wbtns.forEach((b, i) => {
    b.classList.toggle('selected', i === weaponIdx);
    b.disabled = state !== 'aim';
  });
}

function selectWeapon(i) {
  if (state !== 'aim') return;
  weaponIdx = clamp(i, 0, WEAPONS.length - 1);
  syncWeaponButtons();
}

wbtns.forEach((b, i) => b.addEventListener('click', () => selectWeapon(i)));

function startFromTitle() {
  if (state === 'title') { newMatch(); return true; }
  if (state === 'gameover') { newMatch(); return true; }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) { keys[e.key] = true; return; }
  keys[e.key] = true;

  if (e.key === 'Enter') {
    if (startFromTitle()) return;
    const w = activeWorm;
    if (controlState() && w && w.alive && w.onGround) {
      w.vy = JUMP_VY;
      w.onGround = false;
    }
  }
  if (e.key === 'r' || e.key === 'R') {
    if (state === 'gameover') newMatch();
  }
  if (e.key === ' ') chargeLatch = true;
  if (e.key >= '1' && e.key <= '3') selectWeapon(+e.key - 1);
});

window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  if (e.key === ' ') {
    chargeLatch = false;
    if (state === 'charge') fire();
  }
});

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  chargeLatch = false;
  if (state === 'charge') { state = 'aim'; power = 0; syncWeaponButtons(); }
});

canvas.addEventListener('click', () => startFromTitle());

/* ------------------------------------------------------------ demo bot */
const bot = { t: 0, phase: 'wait', dur: 0.6 };

function botKey(type, key) {
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
}

function botReleaseAll() {
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']) botKey('keyup', k);
}

function updateBot(dt) {
  if (!DEMO) return;
  bot.t += dt;
  if (bot.t < bot.dur) return;
  bot.t = 0;
  botReleaseAll();

  if (state === 'title') { botKey('keydown', 'Enter'); return; }
  if (state === 'gameover') { botKey('keydown', 'r'); return; }
  if (state !== 'aim') { bot.dur = 0.4; return; }

  const roll = Math.random();
  if (roll < 0.34) {
    botKey('keydown', Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight');
    bot.dur = rand(0.4, 1.2);
  } else if (roll < 0.55) {
    botKey('keydown', Math.random() < 0.6 ? 'ArrowUp' : 'ArrowDown');
    bot.dur = rand(0.2, 0.6);
  } else if (roll < 0.68) {
    botKey('keydown', 'Enter');
    setTimeout(() => botKey('keyup', 'Enter'), 60);
    bot.dur = 0.3;
  } else if (roll < 0.78) {
    botKey('keydown', String(1 + (Math.random() * 3 | 0)));
    bot.dur = 0.2;
  } else {
    botKey('keydown', ' ');
    bot.dur = rand(0.35, 1.15);   // keyup happens on next bot tick → fires
  }
}

/* ------------------------------------------------------------ main loop */
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    update(STEP);
    updateBot(STEP);
    acc -= STEP;
    steps++;
  }
  render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------ boot */
genTerrain();
paintAllTerrain();
syncWeaponButtons();
requestAnimationFrame(frame);
