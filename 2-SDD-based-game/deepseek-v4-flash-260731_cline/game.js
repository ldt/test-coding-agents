// Worms — a turn-based artillery game
// Exactly three deliverable files live next to this one: index.html, game.js, style.css.
// No external dependencies. Rendering: one full-viewport 2D canvas. Terrain: a
// per-pixel offscreen canvas bitmap with an alpha-channel cache.

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const W = 1600, H = 900;            // logical playfield size
const WATER_H = 80;                  // initial water band height at the bottom
const WORM_R = 14;                   // worm body radius
const MAX_STEP = 4;                  // max slope step-up height (px)
const GRAVITY = 900;                 // px/s^2
const WALK_SPEED = 70;               // px/s
const JUMP_VY = -420;                // initial jump velocity
const JUMP_VX = 160;                 // horizontal jump kick
const TURN_TIME = 45;                // seconds per turn
const RETREAT_TIME = 5;              // seconds of retreat window after firing
const SETTLE_CAP = 8;                // hard cap for SETTLING (seconds)
const PROJ_TIMEOUT = 10;             // hard projectile timeout (seconds)
const CHARGE_TIME = 1.5;             // seconds for 0->100% power
const FIRE_SPEED = 1250;             // max projectile launch speed px/s
const SAFE_FALL = 120;               // px of free fall before damage
const FALL_DMG_K = 0.09;             // damage per excess fall px
const SUDDEN_DEATH_TURN = 20;        // total turns before sudden death (Req 10.1)
const SUDDEN_HP_CAP = 30;            // Req 10.2
const WATER_RISE = 12;               // px per turn during sudden death (Req 10.3)
const DEATH_DELAY = 0.5;             // seconds before a dead worm detonates (Req 6.4)
const DEATH_BLAST = { dmg: 25, r: 40 };
const STEP = 1 / 60;                 // fixed simulation timestep
const MAX_DT = 0.1;                  // delta clamp (Req 9.4)
const SUB_STEP = 3;                  // max px per projectile sub-step (no tunneling)

// ---------------------------------------------------------------------------
// State machine enum
// ---------------------------------------------------------------------------
const S = {
  TITLE: 'TITLE',
  PLACING: 'PLACING',
  TURN_START: 'TURN_START',
  AIMING: 'AIMING',
  CHARGING: 'CHARGING',
  RETREAT: 'RETREAT',
  SETTLING: 'SETTLING',
  TURN_END: 'TURN_END',
  GAME_OVER: 'GAME_OVER',
};

// ---------------------------------------------------------------------------
// Weapons table (data-driven; Req 5.1)
//   charge: needs the power gauge;  wind: affected by wind;  fuse: seconds
//   maxDmg/radius drive explode();  ammo: per-team stock (null = unlimited)
// ---------------------------------------------------------------------------
const WEAPONS = {
  bazooka:  { id: 'bazooka',  key: '1', name: 'Bazooka',  charge: true,  wind: true,  fuse: 0,      maxDmg: 50, radius: 55, ammo: null, kind: 'shell' },
  grenade:  { id: 'grenade',  key: '2', name: 'Grenade',  charge: true,  wind: false, fuse: 3,      maxDmg: 45, radius: 50, ammo: null, kind: 'bomb',  restitution: 0.45 },
  cluster:  { id: 'cluster',  key: '3', name: 'Cluster',  charge: true,  wind: false, fuse: 3,      maxDmg: 30, radius: 40, ammo: 3,   kind: 'bomb',  restitution: 0.4, bomblets: 5 },
  shotgun:  { id: 'shotgun',  key: '4', name: 'Shotgun',  charge: false, wind: false, fuse: 0,      maxDmg: 25, radius: 18, ammo: 3,   kind: 'ray',   shots: 2 },
  dynamite: { id: 'dynamite', key: '5', name: 'Dynamite', charge: false, wind: false, fuse: 3,      maxDmg: 75, radius: 80, ammo: 2,   kind: 'place' },
};
const WEAPON_ORDER = ['bazooka', 'grenade', 'cluster', 'shotgun', 'dynamite'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// Deterministic value noise for terrain (seeded per match).
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
class Terrain {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.alpha = new Uint8ClampedArray(W * H); // alpha channel cache
    this.waterY = H - WATER_H;                 // mutable (sudden death)
  }

  rebuildAlpha(dirty) {
    const d = dirty;
    const img = this.ctx.getImageData(d.x, d.y, d.w, d.h).data;
    for (let j = 0; j < d.h; j++) {
      for (let i = 0; i < d.w; i++) {
        const src = (j * d.w + i) * 4 + 3;
        const dx = d.x + i, dy = d.y + j;
        if (dx >= 0 && dx < W && dy >= 0 && dy < H) {
          this.alpha[dy * W + dx] = img[src];
        }
      }
    }
  }

  // Generate a new landscape. Retries (bounded) until >= 8 standing zones
  // exist above the water line (Req 1.7, 2.1). The final fallback keeps the
  // last generated map regardless so callers never loop forever.
  generate(seed) {
    let lastHeights = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const heights = this.buildHeightMap(seed + attempt * 12345);
      this.drawTerrain(heights);
      this.rebuildAlpha({ x: 0, y: 0, w: W, h: H });
      lastHeights = heights;
      if (this.countZones() >= 8) return;
    }
    // Last resort: redraw the final candidate so the map is always valid.
    this.drawTerrain(lastHeights);
    this.rebuildAlpha({ x: 0, y: 0, w: W, h: H });
  }

  buildHeightMap(seed) {
    const rnd = mulberry32(seed);
    const n1 = this.valueNoise(rnd, 90, 0.5);
    const n2 = this.valueNoise(rnd, 40, 0.3);
    const n3 = this.valueNoise(rnd, 15, 0.2);
    const heights = new Float32Array(W);
    const base = H - 200;
    for (let x = 0; x < W; x++) {
      const v = n1[x] + n2[x] + n3[x];
      heights[x] = clamp(base - v * 260, H * 0.25, H - 220);
    }
    return heights;
  }

  valueNoise(rnd, spacing, amp) {
    const out = new Float32Array(W);
    const pts = [];
    const n = Math.ceil(W / spacing) + 2;
    for (let i = 0; i < n; i++) pts.push({ x: i * spacing, y: rnd() * 2 - 1 });
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x / spacing);
      const a = pts[i], b = pts[i + 1] || pts[n - 1];
      const t = (x - a.x) / (b.x - a.x || 1);
      const s = t * t * (3 - 2 * t); // smoothstep
      out[x] = (a.y + (b.y - a.y) * s) * amp;
    }
    return out;
  }

  // Colorize terrain: grass band on top, dirt below, subtle variation.
  drawTerrain(heights) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const cols = [];
    const rnd = Math.random;
    for (let x = 0; x < W; x++) cols.push({
      g: 90 + Math.floor(rnd() * 30),
      d: 105 + Math.floor(rnd() * 40),
    });
    for (let x = 0; x < W; x++) {
      const top = Math.floor(heights[x]);
      const grassH = 8 + Math.floor(rnd() * 5);
      ctx.fillStyle = `rgb(${70 + Math.floor(rnd() * 30)},${140 + Math.floor(rnd() * 40)},60)`;
      ctx.fillRect(x, top, 1, grassH);
      ctx.fillStyle = `rgb(${cols[x].d},${cols[x].g},60)`;
      ctx.fillRect(x, top + grassH, 1, H - top - grassH);
    }
  }

  // Count distinct flat-enough runs (width >= 6) above the water line.
  countZones() {
    let zones = 0;
    for (let x = 0; x < W; x++) {
      let run = 0;
      while (x < W && this.surfaceHeight(x) < this.waterY - 10) { run++; x++; }
      if (run >= 6) zones++;
    }
    return zones;
  }

  // Highest solid y at column x (or H if no solid in the column).
  surfaceHeight(x) {
    const col = x | 0;
    for (let y = 0; y < H; y++) {
      if (this.alpha[y * W + col] > 127) return y;
    }
    return H;
  }

  solidAt(x, y) {
    const ix = x | 0, iy = y | 0;
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return false;
    return this.alpha[iy * W + ix] > 127;
  }

  // Remove a circle, darken the crater rim, refresh the alpha cache (Req 2.2, 2.5).
  carve(x, y, r) {
    const ctx = this.ctx;
    const rect = {
      x: Math.floor(x - r - 2), y: Math.floor(y - r - 2),
      w: Math.ceil(r * 2 + 4), h: Math.ceil(r * 2 + 4),
    };
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
    // dark rim ring on the remaining terrain
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.arc(x, y, r + 2, 0, TAU, true);
    ctx.clip();
    ctx.fillStyle = 'rgba(50,30,20,0.55)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    this.rebuildAlpha(rect);
  }
}

// ---------------------------------------------------------------------------
// Audio (Web Audio API, synthesized only; Req 8.7)
// ---------------------------------------------------------------------------
const AudioFX = {
  ctx: null, enabled: false,
  init() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.enabled = true;
    } catch (e) {
      this.enabled = false;
    }
  },
  wrap(fn) {
    if (!this.enabled || !this.ctx) return;
    try { fn(this.ctx); } catch (e) { this.enabled = false; }
  },
  blip(freq, dur, type, vol, sweepTo) {
    this.wrap(ctx => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur + 0.05);
    });
  },
  fire()  { this.blip(200, 0.25, 'sawtooth', 0.18, 900); },
  boom(r) { this.blip(60 + r * 0.3, 0.5, 'square', 0.3, 30); },
  splash(){ this.blip(700, 0.3, 'sine', 0.2, 200); },
  turn()  { this.blip(440, 0.12, 'triangle', 0.15, 660); },
  select(){ this.blip(300, 0.06, 'square', 0.1, 400); },
};

// ---------------------------------------------------------------------------
// Explosion resolver — the single choke point (Req 2.2, 6.2, 6.3, 6.7, 8.2)
// ---------------------------------------------------------------------------
function explode(game, x, y, radius, maxDmg) {
  const terrain = game.terrain;
  terrain.carve(x, y, radius);

  const count = 40 + (radius | 0);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const sp = Math.random() * radius * 4;
    spawnParticle(game, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 80,
      rand(3, 8), `rgba(${rand(120, 255)},${rand(60, 140)},40,0.9)`, rand(0.3, 0.8));
  }
  game.camera.shakeT = Math.min(0.4, 0.2 + radius * 0.002);
  game.camera.shakeMag = Math.min(22, radius * 0.3);
  spawnParticle(game, x, y, 0, 0, radius * 0.6, 'rgba(255,220,120,0.95)', 0.12);

  // Damage & knockback — no team filter (friendly fire, Req 6.7)
  for (const team of game.teams) {
    for (const worm of team.worms) {
      if (!worm.alive || worm.trulyDead || worm.dying) continue;
      const d = dist(x, y, worm.x, worm.y);
      if (d >= radius + WORM_R) continue;
      const frac = clamp(1 - d / radius, 0, 1);
      const dmg = Math.max(maxDmg * 0.25, maxDmg * frac);
      damageWorm(game, worm, dmg);
      // knockback (Req 6.3)
      if (d > 0.001) {
        const nx = (worm.x - x) / d, ny = (worm.y - y) / d;
        const kb = 60 + dmg * 3.2;
        worm.vx += nx * kb;
        worm.vy += ny * kb;
      } else {
        worm.vy -= 50;
        worm.vx += (Math.random() - 0.5) * 200;
      }
      if (worm.atRest) {
        worm.atRest = false;
        worm.fallStartY = worm.y;
      }
    }
  }
  game.lastExplosion = { x, y, radius, maxDmg };
  AudioFX.boom(radius);
}

function damageWorm(game, worm, dmg) {
  if (!worm.alive || worm.trulyDead || worm.dying) return;
  worm.hp = Math.max(0, worm.hp - dmg);
  game.damageNumbers.push({
    x: worm.x + rand(-10, 10), y: worm.y - WORM_R - 6,
    text: Math.round(dmg), life: 1.0, vy: -60,
  });
  if (worm.hp <= 0 && !worm.dying) {
    worm.dying = true;
    worm.dieTimer = DEATH_DELAY;
  }
}

function spawnParticle(game, x, y, vx, vy, size, color, life) {
  game.particles.push({ x, y, vx, vy, size, color, life, maxLife: life || 0.5 });
}

// ---------------------------------------------------------------------------
// Worm creation & physics
// ---------------------------------------------------------------------------
function createWorm(teamId, x, y) {
  return {
    id: teamId + '-' + Math.random().toString(36).slice(2, 8),
    team: teamId,
    x, y, vx: 0, vy: 0,
    hp: 100, facing: 1, aimAngle: -Math.PI / 4,
    alive: true, atRest: true, fallStartY: y,
    dying: false, dieTimer: 0, trulyDead: false,
    jumpCooldown: 0,
  };
}

// Circle vs terrain: true if any sampled point of the worm's body is solid.
function thisSolid(game, x, y) {
  for (let a = 0; a < TAU; a += Math.PI / 4) {
    if (game.terrain.solidAt(x + Math.cos(a) * WORM_R, y + Math.sin(a) * WORM_R)) return true;
  }
  return false;
}

function moveWorm(game, worm, dt, inputFacing) {
  if (!worm.alive || worm.dying || worm.trulyDead) return;

  // Jump (Enter/Z) — forward arc jump (Req 4.3)
  if (game.wantJump && worm === game.activeWorm() && worm.atRest) {
    worm.vx = worm.facing * JUMP_VX;
    worm.vy = JUMP_VY;
    worm.atRest = false;
    worm.fallStartY = worm.y;
    game.wantJump = false;
    worm.jumpCooldown = 0.25;
  }
  if (worm.jumpCooldown > 0) worm.jumpCooldown -= dt;
  if (!worm.atRest) {
    integrateWorm(game, worm, dt);
    return;
  }

  if (inputFacing) {
    worm.facing = inputFacing;
    if (worm.jumpCooldown <= 0) {
      let steps = Math.round(WALK_SPEED * dt);
      if (steps < 1) steps = 1;
      let moved = 0;
      for (let s = 0; s < steps; s++) {
        const nx = worm.x + inputFacing;
        if (!thisSolid(game, nx, worm.y)) {
          worm.x = nx;
          moved++;
        } else {
          let stepped = false;
          for (let up = 1; up <= MAX_STEP; up++) {
            const candY = worm.y - up;
            if (!thisSolid(game, nx, candY) && !thisSolid(game, nx, candY - WORM_R)) {
              worm.x = nx;
              worm.y = candY;
              stepped = true;
              break;
            }
          }
          if (!stepped) break;
        }
      }
      if (moved > 0) worm.facing = inputFacing;
    }
  }
  // If terrain below vanished, start falling (Req 2.4).
  if (!thisSolid(game, worm.x, worm.y + WORM_R + 1)) {
    worm.atRest = false;
    worm.vy = 0;
    worm.fallStartY = worm.y;
  }
}

function integrateWorm(game, worm, dt) {
  const subs = Math.max(1, Math.ceil((Math.abs(worm.vy) + Math.abs(worm.vx)) * dt / SUB_STEP));
  const sdt = dt / subs;
  for (let s = 0; s < subs; s++) {
    worm.vy += GRAVITY * sdt;
    let nx = clamp(worm.x + worm.vx * sdt, WORM_R, W - WORM_R);
    let ny = worm.y + worm.vy * sdt;
    if (thisSolid(game, nx, ny)) {
      if (worm.vy > 0) {
        landWorm(game, worm);
        return;
      } else {
        // hit ceiling / side
        worm.vy = 0;
        if (!thisSolid(game, nx, worm.y)) worm.x = nx;
      }
    } else {
      worm.x = nx; worm.y = ny;
    }
  }
}

function landWorm(game, worm) {
  let gy = Math.max(0, worm.y);
  while (gy < H && !thisSolid(game, worm.x, gy)) gy++;
  if (gy >= H) { worm.y = game.waterY - WORM_R - 2; worm.atRest = true; worm.vy = 0; worm.vx = 0; return; }
  worm.y = gy - WORM_R - 1;
  worm.vy = 0; worm.vx = 0;
  worm.atRest = true;
  const fallDist = Math.max(0, worm.fallStartY - worm.y);
  worm.fallStartY = worm.y;
  if (fallDist > SAFE_FALL) {
    const dmg = Math.round((fallDist - SAFE_FALL) * FALL_DMG_K);
    if (dmg > 0) damageWorm(game, worm, dmg);
  }
}

// Water check for every living worm (Req 6.5).
function checkDrown(game, worm) {
  if (!worm.alive || worm.trulyDead || worm.dying) return;
  if (worm.y > game.waterY - 4) {
    spawnParticle(game, worm.x, worm.y, 0, -60, 20, 'rgba(80,160,255,0.8)', 0.4);
    AudioFX.splash();
    worm.trulyDead = true;
    worm.alive = false;
    worm.dying = false;
    game.graves.push({ x: worm.x, y: worm.y, color: game.teams[worm.team] ? game.teams[worm.team].color : '#888', splash: true });
  }
}

function stepWorms(game, dt) {
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (!w.alive || w.trulyDead || w.dying) continue;
      if (!w.atRest) {
        integrateWorm(game, w, dt);
      } else if (!thisSolid(game, w.x, w.y + WORM_R + 1)) {
        w.atRest = false;
        w.vy = 0;
        w.fallStartY = w.y;
      }
      checkDrown(game, w);
    }
  }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------
function createProjectile(kind, x, y, angle, power, weapon, team) {
  const speed = power * FIRE_SPEED;
  return {
    kind, x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    fuse: weapon.fuse || 0,
    windFactor: weapon.wind ? 1 : 0,
    restitution: weapon.restitution || 0,
    bounces: 0,
    age: 0,
    timeoutAt: PROJ_TIMEOUT,
    team,
    sourceWeapon: weapon.id,
    bomblet: false,
    maxDmg: weapon.maxDmg,
    radius: weapon.radius,
    cluster: weapon.id === 'cluster',
    dead: false,
  };
}

function approximateNormal(terrain, x, y) {
  const s = 3;
  const left = terrain.solidAt(x - s, y) ? 1 : 0;
  const right = terrain.solidAt(x + s, y) ? 1 : 0;
  const up = terrain.solidAt(x, y - s) ? 1 : 0;
  const down = terrain.solidAt(x, y + s) ? 1 : 0;
  let nx = left - right, ny = up - down;
  if (nx === 0 && ny === 0) { nx = 0; ny = -1; }
  const len = Math.hypot(nx, ny);
  return { x: nx / len, y: ny / len };
}

function hitWormAt(game, x, y) {
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (!w.alive || w.trulyDead || w.dying) continue;
      if (dist(x, y, w.x, w.y) < WORM_R + 6) return w;
    }
  }
  return null;
}

function stepProjectile(game, p, dt) {
  if (p.kind === 'placed') {
    p.fuse -= dt; p.age += dt;
    if (p.fuse <= 0) {
      explode(game, p.x, p.y, p.radius, p.maxDmg);
      p.dead = true;
    }
    return;
  }
  p.age += dt;
  if (p.fuse > 0) p.fuse -= dt;
  if (p.age > p.timeoutAt) {
    // force-resolve (Req 9.1)
    if (p.fuse > 0 || p.kind === 'shell' || p.bomblet) explode(game, p.x, p.y, p.radius, p.maxDmg);
    p.dead = true;
    return;
  }
  // fuse expired for bombs / bomblets
  if (p.fuse <= 0 && (p.kind === 'bomb' || p.bomblet)) {
    if (p.cluster && !p.bomblet) {
      explode(game, p.x, p.y, p.radius, p.maxDmg);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * Math.PI / 4;
        const speed = rand(150, 320);
        const b = createProjectile('bomblet', p.x, p.y, a, speed / FIRE_SPEED, {
          fuse: 0, wind: false, restitution: 0.3, maxDmg: 15, radius: 25, id: 'cluster',
        }, p.team);
        b.bomblet = true;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        game.projectiles.push(b);
      }
    } else {
      explode(game, p.x, p.y, p.radius, p.maxDmg);
    }
    p.dead = true;
    return;
  }

  // physics with swept sub-steps (no tunneling)
  const subs = Math.max(1, Math.ceil((Math.abs(p.vx) + Math.abs(p.vy)) * dt / SUB_STEP));
  const sdt = dt / subs;
  for (let s = 0; s < subs; s++) {
    p.vy += GRAVITY * sdt;
    if (p.windFactor) p.vx += game.wind * 12 * sdt; // wind affects bazooka (Req 5.3)
    const nx = p.x + p.vx * sdt;
    const ny = p.y + p.vy * sdt;
    // OOB discard (Req 5.9)
    if (nx < -80 || nx > W + 80 || ny < -120) { p.dead = true; return; }
    // terrain collision
    if (game.terrain.solidAt(nx | 0, ny | 0)) {
      if (p.kind === 'shell' || p.bomblet) {
        explode(game, nx, ny, p.radius, p.maxDmg);
        p.dead = true;
        return;
      }
      const norm = approximateNormal(game.terrain, nx, ny);
      const dot = p.vx * norm.x + p.vy * norm.y;
      p.vx = (p.vx - 2 * dot * norm.x) * p.restitution;
      p.vy = (p.vy - 2 * dot * norm.y) * p.restitution;
      p.bounces++;
      if (p.bounces > 12) { p.vx = 0; p.vy = 0; }
      p.x = nx - p.vx * sdt * 2;
      p.y = ny - p.vy * sdt * 2;
      if (thisSolid(game, p.x, p.y)) { p.x = nx; p.y = ny - 2; }
      continue;
    }
    // worm collision
    const hit = hitWormAt(game, nx, ny);
    if (hit) {
      if (p.kind === 'shell' || p.bomblet) {
        explode(game, nx, ny, p.radius, p.maxDmg);
        p.dead = true;
        return;
      }
      const d = dist(nx, ny, hit.x, hit.y) || 1;
      const norm = { x: (nx - hit.x) / d, y: (ny - hit.y) / d };
      const dot = p.vx * norm.x + p.vy * norm.y;
      p.vx = (p.vx - 2 * dot * norm.x) * p.restitution;
      p.vy = (p.vy - 2 * dot * norm.y) * p.restitution;
      continue;
    }
    p.x = nx; p.y = ny;
  }
}

// Shotgun raycast (Req 5.6): march 2 px steps until terrain or worm hit.
function fireShotgunRay(game, worm, weapon) {
  const angle = worm.aimAngle;
  const stepSize = 2;
  const maxDist = 2400;
  let x = worm.x + Math.cos(angle) * (WORM_R + 2);
  let y = worm.y + Math.sin(angle) * (WORM_R + 2);
  let d = 0;
  while (d < maxDist) {
    if (x < 0 || x >= W || y < 0 || y >= H) break;
    if (game.terrain.solidAt(x | 0, y | 0)) {
      explode(game, x, y, weapon.radius, weapon.maxDmg);
      return;
    }
    const hit = hitWormAt(game, x, y);
    if (hit) {
      explode(game, x, y, weapon.radius, weapon.maxDmg);
      return;
    }
    x += Math.cos(angle) * stepSize;
    y += Math.sin(angle) * stepSize;
    d += stepSize;
  }
}

// ---------------------------------------------------------------------------
// Fire entry point — guarded by state (Req 9.3)
// ---------------------------------------------------------------------------
function fire(game) {
  if (game.state !== S.AIMING && game.state !== S.CHARGING && game.state !== S.RETREAT) return;
  if (game.shotFiredThisTurn && !game.shotgunSecond) return;
  const worm = game.activeWorm();
  if (!worm || !worm.alive) return;
  const weapon = WEAPONS[game.selectedWeapon];
  if (!weapon) return;
  const team = game.teams[game.activeTeam];
  if (weapon.ammo != null && team.ammo[weapon.id] <= 0) return;

  if (weapon.ammo != null) team.ammo[weapon.id]--;

  if (weapon.kind === 'ray') {
    fireShotgunRay(game, worm, weapon);
    game.shotsFiredThisTurn++;
    game.shotFiredThisTurn = true;
    if (game.shotsFiredThisTurn >= weapon.shots) {
      game.shotgunSecond = true;
      // hitscan: nothing to retreat from; resolve effects then end turn (Req 5.6)
      game.state = S.SETTLING;
      game.stateTime = 0;
      game.shotEffectsDone = true;
    } else {
      // timer keeps running between shots (Req 5.6)
      game.state = S.AIMING;
      game.stateTime = 0;
      game.awaitingShotgunSecond = true;
    }
    AudioFX.fire();
    return;
  }

  if (weapon.kind === 'place') {
    const p = createProjectile('placed', worm.x, worm.y + WORM_R * 0.5, 0, 0, weapon, game.activeTeam);
    game.projectiles.push(p);
  } else {
    const power = clamp(game.power, 0, 1);
    const p = createProjectile(
      weapon.kind === 'shell' ? 'shell' : 'bomb',
      worm.x + Math.cos(worm.aimAngle) * (WORM_R + 8),
      worm.y + Math.sin(worm.aimAngle) * (WORM_R + 8),
      worm.aimAngle, power, weapon, game.activeTeam);
    game.projectiles.push(p);
  }

  game.shotFiredThisTurn = true;
  game.power = 0;
  AudioFX.fire();
  // Retreat window starts at fire time and runs concurrently with projectile
  // flight; move allowed, no firing (Req 3.4).
  game.retreatTimer = RETREAT_TIME;
  game.state = S.RETREAT;
  game.stateTime = 0;
  game.baseWind = game.wind;
}

// ---------------------------------------------------------------------------
// CPU controller (Req 7)
// ---------------------------------------------------------------------------
function shortestAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function pickTarget(game, worm) {
  const enemyTeam = 1 - game.activeTeam;
  const enemies = game.teams[enemyTeam].worms.filter(w => w.alive && !w.trulyDead && !w.dying);
  if (!enemies.length) return null;
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    const d = dist(worm.x, worm.y, e.x, e.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Bounded simulation using the real integrator (Req 7.2, 7.5).
function computePlan(game, worm, target) {
  if (!target) return { angle: worm.aimAngle, power: 0.5, shouldWalk: false, walkDir: 0 };
  let best = null, bestScore = Infinity;
  const wind = game.wind;
  const angles = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    angles.push(-0.15 - t * (Math.PI - 0.3));
  }
  const powers = [0.45, 0.6, 0.75, 0.9, 1.0];
  const maxSims = 80;
  let sims = 0;
  outer:
  for (const a of angles) {
    for (const p of powers) {
      if (sims++ >= maxSims) break outer;
      const score = simulateShot(game, worm.x, worm.y, a, p, wind, target);
      if (score < bestScore) { bestScore = score; best = { angle: a, power: p }; }
    }
  }
  if (!best) best = { angle: worm.aimAngle, power: 0.6 };
  best.angle += rand(-0.06, 0.06);
  best.power = clamp(best.power + rand(-0.08, 0.08), 0.3, 1);
  best.shouldWalk = false;
  best.walkDir = (target.x > worm.x) ? 1 : -1;
  return best;
}

// Simulate one wind-affected shot against the alpha cache. Real integrator.
function simulateShot(game, sx, sy, angle, power, wind, target) {
  const speed = power * FIRE_SPEED;
  let x = sx + Math.cos(angle) * (WORM_R + 8);
  let y = sy + Math.sin(angle) * (WORM_R + 8);
  let vx = Math.cos(angle) * speed;
  let vy = Math.sin(angle) * speed;
  const dt = 1 / 60;
  let best = Infinity;
  for (let i = 0; i < 600; i++) {
    vy += GRAVITY * dt;
    vx += wind * 12 * dt;
    x += vx * dt;
    y += vy * dt;
    const d = dist(x, y, target.x, target.y);
    if (d < best) best = d;
    if (x < -80 || x > W + 80 || y < -120) break;
    if (game.terrain.solidAt(x | 0, y | 0)) break;
  }
  return best;
}

function cpuAct(game, dt) {
  const worm = game.activeWorm();
  if (!worm || !worm.alive) return;
  if (!game.cpuPhase) {
    game.cpuPhase = { stage: 'think', timer: rand(0.6, 1.0), target: pickTarget(game, worm) };
    return;
  }
  if (!game.cpuPlan) {
    game.cpuPlan = computePlan(game, worm, game.cpuPhase.target);
  }
  const phase = game.cpuPhase;
  const plan = game.cpuPlan;
  phase.timer -= dt;

  if (phase.stage === 'think') {
    if (phase.timer <= 0) {
      phase.stage = 'aim';
      phase.timer = 0.6;
    }
    return;
  }
  if (phase.stage === 'aim') {
    const target = plan.angle != null ? plan.angle : worm.aimAngle;
    const diff = shortestAngle(worm.aimAngle, target);
    worm.aimAngle += diff * Math.min(1, dt * 5);
    if (Math.abs(shortestAngle(worm.aimAngle, target)) < 0.02) {
      phase.stage = 'charge';
      phase.timer = 0.3;
    }
    return;
  }
  if (phase.stage === 'charge') {
    if (phase.timer > 0) {
      phase.timer -= dt;
      return;
    }
    // charge visibly to the computed power, then fire (Req 7.1)
    game.power = plan.power;
    game.state = S.CHARGING;
    game.stateTime = 0;
    fire(game);
    game.cpuPhase = null;
    game.cpuPlan = null;
    game.cpuMoveDir = 0;
  }
}

// ---------------------------------------------------------------------------
// Turn/state logic
// ---------------------------------------------------------------------------
function startMatch(game, mode) {
  game.mode = mode;
  game.state = S.PLACING;
  game.stateTime = 0;
  game.turnCount = 0;
  game.suddenDeath = false;
  game.suddenDeathAnnounced = false;
  game.gameOverShown = false;
  game.projectiles = [];
  game.particles = [];
  game.damageNumbers = [];
  game.graves = [];
  game.camera = { shakeT: 0, shakeMag: 0 };
  game.teams = [
    { name: 'Team Blue', color: '#3b9cff', isCpu: mode === 'cpu' || mode === 'demo',
      worms: [], ammo: { cluster: 3, shotgun: 3, dynamite: 2 }, activeWormIx: -1 },
    { name: 'Team Red', color: '#ff5a5a', isCpu: mode === 'demo',
      worms: [], ammo: { cluster: 3, shotgun: 3, dynamite: 2 }, activeWormIx: -1 },
  ];
  game.firstTeam = mode === 'cpu' ? 0 : (Math.random() < 0.5 ? 0 : 1);
  game.activeTeam = game.firstTeam;
  game.wind = 0;
  game.turnTimer = TURN_TIME;
  game.retreatTimer = 0;
  game.shotsFiredThisTurn = 0;
  game.shotFiredThisTurn = false;
  game.shotgunSecond = false;
  game.awaitingShotgunSecond = false;
  game.shotEffectsDone = false;
  game.power = 0;
  game.wantJump = false;
  game.selectedWeapon = 'bazooka';
  game.cpuPhase = null;
  game.cpuPlan = null;
  game.cpuMoveDir = 0;
  game.winner = null;
  game.draw = false;
  game.spaceWasDown = false;
  game.terrain = new Terrain();
  game.terrain.generate(Math.floor(Math.random() * 1e9));
  game.waterY = game.terrain.waterY;
  placeWorms(game);
  advanceCursor(game, game.teams[game.activeTeam]);
  game.state = S.TURN_START;
  game.stateTime = 0;
}

// Collect candidate spawn columns: surface above water with a gentle local
// slope (so worms can stand). Returns an array of x positions.
function collectSpawnPoints(terrain) {
  const pts = [];
  for (let x = 8; x < W - 8; x++) {
    const sy = terrain.surfaceHeight(x);
    if (sy >= terrain.waterY - 30) continue;
    // gentle slope check: neighbors within a few px of this surface
    const left = terrain.surfaceHeight(Math.max(0, x - 3));
    const right = terrain.surfaceHeight(Math.min(W - 1, x + 3));
    if (Math.abs(left - sy) <= 6 && Math.abs(right - sy) <= 6) {
      pts.push(x);
    }
  }
  return pts;
}

// Greedily pick `count` points from candidates with >= MIN_SPACING separation.
function pickSpacedPoints(candidates, count, minSpacing) {
  const chosen = [];
  const used = new Array(candidates.length).fill(false);
  for (let i = 0; i < count; i++) {
    let best = -1, bestD = -Infinity;
    for (let ci = 0; ci < candidates.length; ci++) {
      if (used[ci]) continue;
      let minD = Infinity;
      for (const up of chosen) minD = Math.min(minD, Math.abs(candidates[ci] - up));
      if (minD > bestD) { bestD = minD; best = ci; }
    }
    if (best < 0) break;
    used[best] = true;
    chosen.push(candidates[best]);
  }
  return chosen;
}

function placeWorms(game) {
  // Bounded, non-recursive placement: regenerate terrain up to a hard cap,
  // then place 8 worms with >= 80px spacing (Req 1.2, 1.7).
  const terrain = game.terrain;
  const MIN_SPACING = 80;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidates = collectSpawnPoints(terrain);
    if (candidates.length >= 8) {
      const pts = pickSpacedPoints(candidates, 8, MIN_SPACING);
      if (pts.length >= 8) {
        for (let i = 0; i < 8; i++) {
          const team = i % 2;
          game.teams[team].worms.push(createWorm(team, pts[i], terrain.surfaceHeight(pts[i]) - WORM_R - 1));
        }
        return;
      }
    }
    terrain.generate(Math.floor(Math.random() * 1e9));
  }
  // Final fallback: place whatever we can on the current map.
  const candidates = collectSpawnPoints(terrain);
  const pts = pickSpacedPoints(candidates, 8, MIN_SPACING);
  for (let i = 0; i < pts.length; i++) {
    const team = i % 2;
    game.teams[team].worms.push(createWorm(team, pts[i], terrain.surfaceHeight(pts[i]) - WORM_R - 1));
  }
}

function activeWorm(game) {
  const team = game.teams[game.activeTeam];
  if (!team || !team.worms) return null;
  return team.worms[team.activeWormIx];
}

function advanceCursor(game, team) {
  const worms = team.worms;
  const n = worms.length;
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    team.activeWormIx = (team.activeWormIx + 1) % n;
    const w = worms[team.activeWormIx];
    if (w.alive && !w.trulyDead && !w.dying) return true;
  }
  return false;
}

function teamAliveCount(team) {
  return team.worms.filter(w => w.alive && !w.trulyDead && !w.dying).length;
}

function teamHealthTotal(team) {
  return team.worms.reduce((s, w) => s + (w.alive && !w.trulyDead && !w.dying ? w.hp : 0), 0);
}

function checkEnd(game) {
  const a = teamAliveCount(game.teams[0]);
  const b = teamAliveCount(game.teams[1]);
  if (a === 0 && b === 0) {
    game.draw = true; game.winner = null;
    game.state = S.GAME_OVER;
    return;
  }
  if (a === 0 || b === 0) {
    game.winner = a > 0 ? 0 : 1;
    game.state = S.GAME_OVER;
  }
}

function resolveDeaths(game) {
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (w.dying && !w.trulyDead) {
        w.dieTimer -= STEP;
        if (w.dieTimer <= 0) {
          const dx = w.x, dy = w.y;
          w.trulyDead = true; w.alive = false; w.dying = false;
          game.graves.push({ x: dx, y: dy, color: team.color });
          spawnParticle(game, dx, dy, 0, -40, 30, 'rgba(200,200,200,0.8)', 0.5);
          explode(game, dx, dy, DEATH_BLAST.r, DEATH_BLAST.dmg);
        }
      }
    }
  }
}

function endTurn(game) {
  resolveDeaths(game);
  checkEnd(game);
  if (game.state === S.GAME_OVER) return;
  game.activeTeam = 1 - game.activeTeam;
  advanceCursor(game, game.teams[game.activeTeam]);
  game.turnCount++;
  game.turnTimer = TURN_TIME;
  game.shotsFiredThisTurn = 0;
  game.shotFiredThisTurn = false;
  game.shotgunSecond = false;
  game.awaitingShotgunSecond = false;
  game.shotEffectsDone = false;
  game.power = 0;
  game.wantJump = false;
  game.cpuPhase = null;
  game.cpuPlan = null;
  game.cpuMoveDir = 0;
  game.wind = rand(-1, 1) * rand(0.2, 1.0); // random wind each turn (Req 5.8)
  game.selectedWeapon = 'bazooka';
  if (game.turnCount >= SUDDEN_DEATH_TURN && !game.suddenDeath) {
    game.suddenDeath = true;
    for (const t of game.teams) {
      for (const w of t.worms) {
        if (w.alive && !w.trulyDead && !w.dying) w.hp = Math.min(w.hp, SUDDEN_HP_CAP);
      }
    }
  }
  if (game.suddenDeath) {
    game.terrain.waterY = Math.max(0, game.terrain.waterY - WATER_RISE);
    game.waterY = game.terrain.waterY;
  }
  game.state = S.TURN_START;
  game.stateTime = 0;
  AudioFX.turn();
}

// ---------------------------------------------------------------------------
// Main game object & update
// ---------------------------------------------------------------------------
function createGame() {
  return {
    state: S.TITLE,
    stateTime: 0,
    mode: null,
    teams: [],
    activeTeam: 0,
    turnTimer: TURN_TIME,
    retreatTimer: 0,
    wind: 0,
    shotsFiredThisTurn: 0,
    shotFiredThisTurn: false,
    shotgunSecond: false,
    awaitingShotgunSecond: false,
    shotEffectsDone: false,
    power: 0,
    wantJump: false,
    selectedWeapon: 'bazooka',
    turnCount: 0,
    suddenDeath: false,
    suddenDeathAnnounced: false,
    gameOverShown: false,
    projectiles: [],
    particles: [],
    damageNumbers: [],
    graves: [],
    terrain: null,
    waterY: H - WATER_H,
    camera: { shakeT: 0, shakeMag: 0 },
    cpuPhase: null,
    cpuPlan: null,
    cpuMoveDir: 0,
    winner: null,
    draw: false,
    firstTeam: 0,
    spaceWasDown: false,
    activeWorm() { return activeWorm(this); },
  };
}

function update(game, dt) {
  game.stateTime += dt;
  switch (game.state) {
    case S.TITLE:
    case S.PLACING:
      break;
    case S.TURN_START:
      game.state = S.AIMING;
      game.stateTime = 0;
      break;
    case S.AIMING:
      updateAiming(game, dt);
      break;
    case S.CHARGING:
      updateCharging(game, dt);
      break;
    case S.RETREAT:
      updateRetreat(game, dt);
      break;
    case S.SETTLING:
      updateSettling(game, dt);
      break;
    case S.TURN_END:
      endTurn(game);
      break;
    case S.GAME_OVER:
      if (!game.gameOverShown) {
        game.gameOverShown = true;
        showVictoryScreen(game);
      }
      break;
  }
  game.spaceWasDown = !!game.keys['Space'];
}

function updateAiming(game, dt) {
  const worm = game.activeWorm();
  const team = game.teams[game.activeTeam];
  if (!team) { game.state = S.TURN_END; return; }
  if (!worm || !worm.alive || worm.dying || worm.trulyDead) {
    game.state = S.SETTLING;
    game.stateTime = 0;
    return;
  }
  game.turnTimer -= dt;
  if (game.turnTimer <= 0) {
    game.turnTimer = 0;
    // Req 3.3: if mid-charge at expiry, charging state will fire at current power
    if (game.power > 0 && WEAPONS[game.selectedWeapon] && WEAPONS[game.selectedWeapon].charge) {
      fire(game);
      return;
    }
    game.state = S.TURN_END;
    return;
  }

  const keys = game.keys || {};
  const spacePressed = keys['Space'] && !game.spaceWasDown;

  // CPU turn
  if (team.isCpu && !game.shotFiredThisTurn) {
    cpuAct(game, dt);
    if (game.cpuMoveDir) moveWorm(game, worm, dt, game.cpuMoveDir);
    return;
  }

  // Human: movement (Req 4.1, 4.2)
  const left = keys['ArrowLeft'], right = keys['ArrowRight'];
  let dir = 0;
  if (left) dir = -1;
  if (right) dir = 1;
  if (dir) {
    const prevFacing = worm.facing;
    moveWorm(game, worm, dt, dir);
    if (dir !== prevFacing) {
      // mirror aim to the new facing side (Req 4.6)
      if (worm.facing > 0) worm.aimAngle = -Math.PI + worm.aimAngle;
      else worm.aimAngle = Math.PI - worm.aimAngle;
      worm.aimAngle = clamp(worm.aimAngle, -Math.PI * 0.95, Math.PI * 0.95);
    }
  }
  // Aim (Req 4.5)
  if (keys['ArrowUp']) worm.aimAngle = clamp(worm.aimAngle - dt * 2.2, -Math.PI * 0.95, -0.02);
  if (keys['ArrowDown']) worm.aimAngle = clamp(worm.aimAngle + dt * 2.2, -Math.PI * 0.95, -0.02);

  const weapon = WEAPONS[game.selectedWeapon];
  if (!weapon) return;
  // Firing (space press edge)
  if (spacePressed) {
    if (game.shotFiredThisTurn) return;
    if (weapon.charge) {
      game.state = S.CHARGING;
      game.stateTime = 0;
    } else {
      // instant weapons: shotgun / dynamite fire on press (Req 5.6, 5.7)
      if (game.awaitingShotgunSecond && game.shotsFiredThisTurn === 1) {
        game.shotgunSecond = true;
        game.state = S.CHARGING;
        game.stateTime = 0;
      } else if (!game.shotFiredThisTurn) {
        game.state = S.CHARGING;
        game.stateTime = 0;
      }
    }
  }
}

function updateCharging(game, dt) {
  const worm = game.activeWorm();
  if (!worm || !worm.alive) { game.state = S.TURN_END; return; }
  const weapon = WEAPONS[game.selectedWeapon];
  if (!weapon) { game.state = S.AIMING; return; }
  const keys = game.keys || {};

  if (weapon.charge) {
    game.turnTimer -= dt;
    game.power = Math.min(1, game.power + dt / CHARGE_TIME);
    if (game.turnTimer <= 0 || game.power >= 1) {
      // Req 3.3 (fire at current power on expiry) / Req 5.2 (full charge fires)
      fire(game);
      return;
    }
    if (!keys['Space']) {
      // release fires at charged power (Req 5.2)
      fire(game);
      return;
    }
  } else {
    // instant weapons: fire immediately, then leave CHARGING
    fire(game);
    return;
  }
}

function updateRetreat(game, dt) {
  game.retreatTimer -= dt;
  // projectiles keep flying during retreat
  for (const p of game.projectiles) stepProjectile(game, p, dt);
  game.projectiles = game.projectiles.filter(p => !p.dead);
  stepWorms(game, dt);

  // Movement only, no firing (Req 3.4); jump allowed
  const worm = game.activeWorm();
  const aliveActive = worm && worm.alive && !worm.trulyDead && !worm.dying;
  if (aliveActive) {
    const keys = game.keys || {};
    const left = keys['ArrowLeft'], right = keys['ArrowRight'];
    const dir = left ? -1 : right ? 1 : 0;
    if (dir) moveWorm(game, worm, dt, dir);
    if (game.wantJump) {
      worm.vx = worm.facing * JUMP_VX;
      worm.vy = JUMP_VY;
      worm.atRest = false;
      worm.fallStartY = worm.y;
      game.wantJump = false;
    }
  }

  const projectilesDone = game.projectiles.length === 0;
  const wormRest = !aliveActive || (worm.atRest && worm.vy === 0);
  // End early when effects resolved AND worm at rest; hard cap is the retreat timer
  if (projectilesDone && wormRest) {
    game.state = S.SETTLING;
    game.stateTime = 0;
    return;
  }
  if (game.retreatTimer <= 0) {
    game.state = S.SETTLING;
    game.stateTime = 0;
  }
}

function updateSettling(game, dt) {
  stepWorms(game, dt);
  resolveDeaths(game);
  const anyProjectile = game.projectiles.length > 0;
  const anyAirborne = game.teams.some(t => t.worms.some(w =>
    w.alive && !w.trulyDead && !w.dying && !w.atRest));
  const anyDying = game.teams.some(t => t.worms.some(w => w.dying));
  if (!anyProjectile && !anyAirborne && !anyDying) {
    game.state = S.TURN_END;
    game.stateTime = 0;
    return;
  }
  if (game.stateTime >= SETTLE_CAP) {
    forceSettle(game);
    game.state = S.TURN_END;
    game.stateTime = 0;
  }
}

function forceSettle(game) {
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (!w.alive || w.trulyDead || w.dying) continue;
      w.vx = 0; w.vy = 0;
      if (!w.atRest) {
        checkDrown(game, w);
        if (!w.alive) continue;
        let gy = w.y;
        while (gy < H && !thisSolid(game, w.x, gy)) gy++;
        if (gy >= H) {
          checkDrown(game, w);
          if (w.alive) { w.y = game.waterY - WORM_R - 2; w.atRest = true; }
        } else {
          w.y = gy - WORM_R - 1;
          w.atRest = true;
        }
      }
    }
  }
}

function showVictoryScreen(game) {
  const title = document.getElementById('victory-title');
  const sub = document.getElementById('victory-subtitle');
  if (game.draw) {
    title.textContent = 'DRAW!';
    title.style.color = '#ffd24a';
    sub.textContent = 'Both teams were eliminated together.';
  } else if (game.winner != null) {
    const team = game.teams[game.winner];
    title.textContent = team.name + ' WINS!';
    title.style.color = team.color;
    sub.textContent = 'What a battle!';
  }
  document.getElementById('victory-screen').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render(game, ctx, vw, vh) {
  const scale = Math.min(vw / W, vh / H);
  const ox = (vw - W * scale) / 2;
  const oy = (vh - H * scale) / 2;
  ctx.save();
  ctx.fillStyle = '#0d1624';
  ctx.fillRect(0, 0, vw, vh);
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  if (game.camera.shakeT > 0) {
    ctx.translate(rand(-game.camera.shakeMag, game.camera.shakeMag),
      rand(-game.camera.shakeMag, game.camera.shakeMag));
  }
  drawSky(ctx);
  if (game.terrain) ctx.drawImage(game.terrain.canvas, 0, 0);
  drawWater(ctx, game);
  drawGraves(ctx, game);
  drawWorms(ctx, game);
  drawProjectiles(ctx, game);
  drawParticles(ctx, game);
  drawDamageNumbers(ctx, game);
  drawCrosshair(ctx, game);
  ctx.restore();
}

function drawSky(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b1a2e');
  grad.addColorStop(0.6, '#16304f');
  grad.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawWater(ctx, game) {
  const wy = game.waterY;
  const grad = ctx.createLinearGradient(0, wy, 0, H);
  grad.addColorStop(0, 'rgba(30,90,160,0.85)');
  grad.addColorStop(1, 'rgba(10,40,90,0.95)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, wy + 6);
  for (let x = 0; x <= W; x += 12) {
    ctx.lineTo(x, wy + 6 + Math.sin(x * 0.02 + performance.now() * 0.001) * 4);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawGraves(ctx, game) {
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const g of game.graves) {
    ctx.fillStyle = 'rgba(120,120,130,0.9)';
    ctx.fillRect(g.x - 12, g.y - 16, 24, 30);
    ctx.fillStyle = 'rgba(40,40,48,0.9)';
    ctx.beginPath();
    ctx.arc(g.x, g.y - 18, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.fillText('☠', g.x, g.y - 22);
  }
}

function drawWorms(ctx, game) {
  const active = game.activeWorm();
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (!w.alive || w.trulyDead) continue;
      const alpha = w.dying ? 0.4 + 0.3 * Math.sin(performance.now() * 0.02) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(w.x, w.y + WORM_R + 2, WORM_R * 0.8, 6, 0, 0, TAU);
      ctx.fill();
      const grad = ctx.createRadialGradient(w.x - 4, w.y - 6, 2, w.x, w.y, WORM_R + 2);
      grad.addColorStop(0, '#fff6d8');
      grad.addColorStop(0.6, team.color);
      grad.addColorStop(1, '#2a2a35');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(w.x, w.y, WORM_R, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(w.x + w.facing * 5, w.y - 5, 4.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(w.x + w.facing * 7, w.y - 5.5, 2.2, 0, TAU);
      ctx.fill();
      // HP label (Req 6.1)
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(Math.max(0, Math.ceil(w.hp)), w.x, w.y - WORM_R - 6);
      ctx.fillStyle = w.hp > 50 ? '#7CFC00' : w.hp > 25 ? '#ffd24a' : '#ff5a5a';
      ctx.fillText(Math.max(0, Math.ceil(w.hp)), w.x, w.y - WORM_R - 7);
      ctx.restore();
      if (active === w) drawActiveMarker(ctx, w);
    }
  }
}

function drawActiveMarker(ctx, w) {
  const bob = Math.sin(performance.now() * 0.006) * 4;
  ctx.save();
  ctx.strokeStyle = '#ffe95a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w.x - 14, w.y - WORM_R - 18 + bob);
  ctx.lineTo(w.x, w.y - WORM_R - 30 + bob);
  ctx.lineTo(w.x + 14, w.y - WORM_R - 18 + bob);
  ctx.stroke();
  ctx.fillStyle = '#ffe95a';
  ctx.beginPath();
  ctx.arc(w.x, w.y - WORM_R - 34 + bob, 4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawProjectiles(ctx, game) {
  for (const p of game.projectiles) {
    ctx.save();
    if (p.kind === 'placed') {
      ctx.fillStyle = '#c33';
      ctx.fillRect(p.x - 6, p.y - 10, 12, 14);
      ctx.fillStyle = '#eee';
      ctx.fillRect(p.x - 6, p.y - 10, 12, 4);
      if (Math.floor(performance.now() / 100) % 2) {
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath();
        ctx.arc(p.x + 4, p.y - 12, 3, 0, TAU);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = p.bomblet ? '#8a6c3f' : p.kind === 'shell' ? '#556' : '#3a6';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.bomblet ? 4 : 6, 0, TAU);
      ctx.fill();
      if (p.fuse > 0 && p.fuse < 1) {
        ctx.fillStyle = 'rgba(255,120,0,0.9)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawParticles(ctx, game) {
  for (const pt of game.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size * clamp(pt.life / pt.maxLife, 0, 1), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawDamageNumbers(ctx, game) {
  ctx.save();
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const d of game.damageNumbers) {
    ctx.globalAlpha = clamp(d.life, 0, 1);
    ctx.fillStyle = '#ff5a3c';
    ctx.fillText(d.text, d.x + 1, d.y + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(d.text, d.x, d.y);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawCrosshair(ctx, game) {
  const w = game.activeWorm();
  if (!w || !w.alive || w.dying || w.trulyDead) return;
  if (game.state !== S.AIMING && game.state !== S.CHARGING && game.state !== S.RETREAT) return;
  const len = 46;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w.x + Math.cos(w.aimAngle) * (WORM_R + 4), w.y + Math.sin(w.aimAngle) * (WORM_R + 4));
  ctx.lineTo(w.x + Math.cos(w.aimAngle) * len, w.y + Math.sin(w.aimAngle) * len);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,80,60,0.9)';
  ctx.beginPath();
  ctx.arc(w.x + Math.cos(w.aimAngle) * len, w.y + Math.sin(w.aimAngle) * len, 5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(w.x + Math.cos(w.aimAngle) * len, w.y + Math.sin(w.aimAngle) * len, 9, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHUD(game) {
  const el = (id) => document.getElementById(id);
  if (game.state === S.TITLE || game.state === S.GAME_OVER || !game.terrain) {
    el('hud').style.display = 'none';
    return;
  }
  el('hud').style.display = 'block';
  el('turn-timer').textContent = Math.max(0, Math.ceil(game.turnTimer));
  el('turn-timer').classList.toggle('low', game.turnTimer < 10);
  if (game.state === S.CHARGING) {
    el('power-gauge').classList.remove('hidden');
    el('power-fill').style.width = (game.power * 100).toFixed(0) + '%';
  } else {
    el('power-gauge').classList.add('hidden');
  }
  el('wind-value').textContent = Math.round(Math.abs(game.wind) * 100);
  const windPx = game.wind * 20;
  el('wind-arrow').style.transform = `scaleX(${windPx < 0 ? -1 : 1}) rotate(${windPx * 0.1}deg)`;
  el('sudden-death').classList.toggle('hidden', !game.suddenDeath);

  for (let i = 0; i < 2; i++) {
    const hp = teamHealthTotal(game.teams[i]);
    const alive = teamAliveCount(game.teams[i]);
    const panel = el(`team-panel-${i}`);
    panel.style.borderColor = game.activeTeam === i ? game.teams[i].color : 'rgba(255,255,255,0.15)';
    panel.style.background = game.activeTeam === i ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.35)';
    el(`team-bar-${i}`).style.width = (hp / 400 * 100) + '%';
    el(`team-bar-${i}`).style.background = game.teams[i].color;
    el(`team-hp-${i}`).textContent = hp + ' (' + alive + ')';
  }

  const panelEl = el('weapon-panel');
  const team = game.teams[game.activeTeam];
  let html = '';
  for (const wid of WEAPON_ORDER) {
    const w = WEAPONS[wid];
    const ammo = w.ammo == null ? '∞' : team.ammo[wid];
    const depleted = w.ammo != null && team.ammo[wid] <= 0;
    const sel = game.selectedWeapon === wid;
    html += `<div class="weapon ${sel ? 'selected' : ''} ${depleted ? 'depleted' : ''}" data-weapon="${wid}">
      <span class="wkey">${w.key}</span>${w.name}<span class="wammo">${ammo}</span></div>`;
  }
  panelEl.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Input (Req 9.3: all game reactions read the key set inside the fixed step)
// ---------------------------------------------------------------------------
function setupInput(game) {
  const keys = {};
  game.keys = keys;
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(e.key)) {
      e.preventDefault();
    }
    if (game.state === S.AIMING || game.state === S.RETREAT || game.state === S.CHARGING) {
      keys[e.key] = true;
      keys[e.code] = true;
    }
    if ((e.key === 'Enter' || e.key === 'z' || e.key === 'Z') &&
        (game.state === S.AIMING || game.state === S.RETREAT) && !game.wantJump) {
      game.wantJump = true;
    }
    for (const wid of WEAPON_ORDER) {
      if (e.key === WEAPONS[wid].key && (game.state === S.AIMING || game.state === S.CHARGING)) {
        const team = game.teams[game.activeTeam];
        const w = WEAPONS[wid];
        if (team && w.ammo != null && team.ammo[wid] <= 0) continue;
        if (game.shotFiredThisTurn) continue;
        game.selectedWeapon = wid;
        AudioFX.select();
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    keys[e.code] = false;
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const game = createGame();
  window.__game = game; // debug handle (Req 9.5)

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();
  setupInput(game);

  document.getElementById('btn-pvp').addEventListener('click', () => {
    AudioFX.init();
    document.getElementById('title-screen').classList.add('hidden');
    startMatch(game, 'pvp');
  });
  document.getElementById('btn-cpu').addEventListener('click', () => {
    AudioFX.init();
    document.getElementById('title-screen').classList.add('hidden');
    startMatch(game, 'cpu');
  });
  document.getElementById('btn-rematch').addEventListener('click', () => {
    document.getElementById('victory-screen').classList.add('hidden');
    startMatch(game, game.mode || 'pvp');
  });

  if (new URLSearchParams(location.search).has('demo')) {
    document.getElementById('title-screen').classList.add('hidden');
    startMatch(game, 'demo');
    AudioFX.init();
  }

  let last = performance.now();
  let acc = 0;
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, MAX_DT); // clamp delta (Req 9.4)
    acc += dt;
    while (acc >= STEP) {
      update(game, STEP);
      updateCosmetics(game, STEP);
      acc -= STEP;
    }
    render(game, ctx, window.innerWidth, window.innerHeight);
    updateHUD(game);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function updateCosmetics(game, dt) {
  for (const p of game.particles) {
    p.vy += GRAVITY * 0.3 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  game.particles = game.particles.filter(p => p.life > 0);
  for (const d of game.damageNumbers) {
    d.y += d.vy * dt;
    d.vy *= 0.9;
    d.life -= dt * 1.4;
  }
  game.damageNumbers = game.damageNumbers.filter(d => d.life > 0);
  if (game.camera.shakeT > 0) {
    game.camera.shakeT -= dt;
    if (game.camera.shakeT <= 0) game.camera.shakeMag = 0;
  }
  if (game.terrain) game.waterY = game.terrain.waterY;
  // Active worm died during its own turn -> end turn after effects (Req 3.7)
  const active = game.activeWorm();
  if (active && !active.alive && (game.state === S.AIMING || game.state === S.RETREAT)) {
    game.state = S.SETTLING;
    game.stateTime = 0;
  }
}

window.addEventListener('DOMContentLoaded', boot);