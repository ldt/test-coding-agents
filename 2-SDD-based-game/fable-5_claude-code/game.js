'use strict';
(() => {

// ============================================================ constants

const W = 1600, H = 900;
const WATER0 = 830;              // initial water line (rises in sudden death)
const FIXED_DT = 1 / 60;         // 60 Hz sim, swept <=3 px projectile sub-steps
const MAX_FRAME_DT = 0.1;        // clamp for backgrounded tabs (Req 9.4)

const GRAV = 900;                // px/s^2
const WORM_R = 10;
const WALK_SPEED = 95;
const STEP_UP = 5;               // max slope step per walk step (Req 4.2)
const JUMP_VX = 165, JUMP_VY = 300;
const SAFE_FALL = 130;           // px of free fall before damage (Req 4.4)
const FALL_DMG_K = 0.12, FALL_DMG_CAP = 45;

const TURN_TIME = 45;            // Req 3.3
const RETREAT_TIME = 5;          // Req 3.4 (max; ends early when settled)
const CHARGE_TIME = 1.5;         // Req 5.2
const MAX_POWER = 1000;          // launch speed at 100% (full-power 45deg ~ 1100 px range)
const WIND_ACC = 100;            // px/s^2 at |wind| = 1 (bazooka only)
const SETTLE_CAP = 8;            // Req 9.2
const PROJ_TIMEOUT = 10;         // Req 9.1
const SUDDEN_DEATH_TURNS = 20;   // Req 10.1
const SD_HP_CAP = 30, SD_WATER_RISE = 12;
const DEATH_BLAST = { dmg: 25, radius: 40, delay: 0.5 }; // Req 6.4

// Weapons table (Req 5) — ammo is per team per match; Infinity = unlimited
const WEAPONS = {
  bazooka:  { name: 'Bazooka',  icon: '\u{1F680}', key: '1', ammo: Infinity, charge: true,  wind: 1, fuse: 0, impact: true,  dmg: 50, radius: 55, rest: 0 },
  grenade:  { name: 'Grenade',  icon: '\u{1F4A3}', key: '2', ammo: Infinity, charge: true,  wind: 0, fuse: 3, impact: false, dmg: 45, radius: 50, rest: 0.45 },
  cluster:  { name: 'Cluster',  icon: '☄️', key: '3', ammo: 3,     charge: true,  wind: 0, fuse: 3, impact: false, dmg: 30, radius: 40, rest: 0.45,
              bomblets: { count: 5, dmg: 15, radius: 25 } },
  shotgun:  { name: 'Shotgun',  icon: '\u{1F52B}', key: '4', ammo: 3, instant: 'ray',  shots: 2, dmg: 25, radius: 18 },
  dynamite: { name: 'Dynamite', icon: '\u{1F9E8}', key: '5', ammo: 2, instant: 'drop', wind: 0, fuse: 3, impact: false, dmg: 75, radius: 80, rest: 0.1 },
};
const WEAPON_IDS = Object.keys(WEAPONS);

const TEAM_DEFS = [
  { name: 'Crimson', color: '#e2504c', dark: '#8e2723' },
  { name: 'Azure',   color: '#4d8de0', dark: '#24528e' },
];
const WORM_NAMES = [['Boggy', 'Spade', 'Tulip', 'Ziggy'], ['Piton', 'Umber', 'Quill', 'Nacho']];

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const rand = (a, b) => a + Math.random() * (b - a);
// Box–Muller, for CPU aim error
function gauss(sigma) {
  const u = Math.max(1e-9, Math.random()), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v) * sigma;
}

// ============================================================ audio (Req 8.7)
// Web Audio synthesis only; created on first user gesture; failure-safe.

const audio = {
  ctx: null,
  ensure() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* stay silent */ }
  },
  env(node, t0, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g); g.connect(this.ctx.destination);
    return g;
  },
  tone(freq0, freq1, dur, type, peak) {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t0 + dur);
      this.env(o, t0, peak || 0.12, dur);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  },
  noise(dur, peak, filterFreq) {
    if (!this.ctx) return;
    try {
      const t0 = this.ctx.currentTime;
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 900;
      src.connect(f);
      this.env(f, t0, peak || 0.3, dur);
      src.start(t0);
    } catch (e) { /* ignore */ }
  },
  play(what, size) {
    if (!this.ctx) return;
    if (what === 'fire') this.tone(300, 900, 0.14, 'square', 0.08);
    else if (what === 'explosion') { this.noise(0.45, clamp((size || 50) / 160, 0.15, 0.5), 700); this.tone(160, 40, 0.4, 'sine', 0.2); }
    else if (what === 'splash') this.noise(0.3, 0.15, 2200);
    else if (what === 'turn') { this.tone(440, 660, 0.09, 'sine', 0.08); }
    else if (what === 'ui') this.tone(700, 950, 0.05, 'sine', 0.05);
    else if (what === 'jump') this.tone(250, 450, 0.1, 'sine', 0.05);
    else if (what === 'tick') this.tone(1100, 1050, 0.03, 'sine', 0.04);
  },
};

// ============================================================ terrain (Req 2)

const terrain = {
  cvs: null, ctx: null,
  alpha: new Uint8Array(W * H),  // >127 = solid; refreshed per dirty rect
  heights: new Float32Array(W),
  waterY: WATER0,

  solid(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    return this.alpha[y * W + x] > 127;
  },

  refreshAlpha(rx, ry, rw, rh) {
    rx = clamp(rx | 0, 0, W); ry = clamp(ry | 0, 0, H);
    rw = clamp(rw | 0, 0, W - rx); rh = clamp(rh | 0, 0, H - ry);
    if (rw <= 0 || rh <= 0) return;
    const img = this.ctx.getImageData(rx, ry, rw, rh).data;
    for (let y = 0; y < rh; y++) {
      const rowDst = (ry + y) * W + rx, rowSrc = y * rw;
      for (let x = 0; x < rw; x++) this.alpha[rowDst + x] = img[(rowSrc + x) * 4 + 3];
    }
  },

  // Layered-sine heightmap; must yield >= 8 standing zones (Req 2.1) — caller retries
  genHeights() {
    const base = H * 0.62 + rand(-40, 40);
    const parts = [];
    for (let i = 0; i < 4; i++) {
      parts.push({ amp: [150, 85, 42, 20][i] * rand(0.7, 1.25), freq: [1.3, 2.6, 5.1, 9.7][i] * rand(0.8, 1.3), ph: rand(0, TAU) });
    }
    for (let x = 0; x < W; x++) {
      let y = base;
      for (const p of parts) y += p.amp * Math.sin(TAU * p.freq * x / W + p.ph);
      this.heights[x] = clamp(y, 140, WATER0 + 55);
    }
  },

  standingZones() {
    let zones = 0, run = 0;
    for (let x = 0; x < W; x++) {
      if (this.heights[x] < this.waterY - 12) run++;
      else { if (run >= 70) zones++; run = 0; }
    }
    if (run >= 70) zones++;
    return zones;
  },

  paint() {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    // dirt body
    const grad = c.createLinearGradient(0, 100, 0, H);
    grad.addColorStop(0, '#8a5a33');
    grad.addColorStop(0.55, '#6e4526');
    grad.addColorStop(1, '#4b2d18');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x < W; x++) c.lineTo(x, this.heights[x]);
    c.lineTo(W, H);
    c.closePath();
    c.fill();
    // speckle for texture
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * W, y = this.heights[x | 0] + Math.random() * (H - this.heights[x | 0]);
      c.fillRect(x, y, 2, 2);
    }
    // grass band along the surface
    c.lineWidth = 7; c.strokeStyle = '#4d9e3f'; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, this.heights[0]);
    for (let x = 1; x < W; x++) c.lineTo(x, this.heights[x]);
    c.stroke();
    c.lineWidth = 3; c.strokeStyle = '#6fc45c';
    c.beginPath();
    c.moveTo(0, this.heights[0] - 2);
    for (let x = 1; x < W; x++) c.lineTo(x, this.heights[x] - 2);
    c.stroke();
    this.refreshAlpha(0, 0, W, H);
  },

  generate() {
    if (!this.cvs) {
      this.cvs = document.createElement('canvas');
      this.cvs.width = W; this.cvs.height = H;
      this.ctx = this.cvs.getContext('2d', { willReadFrequently: true });
    }
    this.waterY = WATER0;
    for (let attempt = 0; attempt < 8; attempt++) {   // Req 1.7 bounded retries
      this.genHeights();
      if (this.standingZones() >= 8) break;
    }
    this.paint();
  },

  carve(cx, cy, r) {                                   // Req 2.2, 2.3, 2.5
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-atop';        // scorched rim on remaining dirt
    c.strokeStyle = 'rgba(38,24,13,0.9)'; c.lineWidth = 5;
    c.beginPath(); c.arc(cx, cy, r - 1, 0, TAU); c.stroke();
    c.restore();
    const m = r + 6;
    this.refreshAlpha(cx - m, cy - m, m * 2, m * 2);
  },

  // topmost solid pixel in a column (spawning); null if none above water
  surfaceY(x) {
    for (let y = 100; y < this.waterY; y++) if (this.solid(x, y)) return y;
    return null;
  },
};

// ============================================================ game state

const game = {
  state: 'TITLE', stateTime: 0,
  mode: null,                       // 'pvp' | 'cpu' | 'demo'
  teams: [],
  activeTeam: 0,
  turnTimer: 0, retreatTimer: 0, wind: 0,
  turnCount: 0, suddenDeath: false,
  shotsLeft: 0, weaponLocked: false,
  selectedWeapon: 'bazooka',
  projectiles: [], particles: [], texts: [], graves: [],
  shakeT: 0, shakeMag: 0,
  aimingCharge: 0,
  cpu: null,
};
window.__game = game;               // Req 9.5 debug handle

const activeTeamObj = () => game.teams[game.activeTeam];
const activeWorm = () => { const t = activeTeamObj(); return t ? t.worms[t.cursor] : null; };
const livingWorms = () => game.teams.flatMap(t => t.worms).filter(w => w.alive);
const teamAlive = t => t.worms.some(w => w.alive);

function setState(s) { game.state = s; game.stateTime = 0; }

// ============================================================ worms & physics (Req 4, 6)

function makeWorm(teamIx, i, x, y) {
  return {
    team: teamIx, name: WORM_NAMES[teamIx][i],
    x, y, vx: 0, vy: 0, hp: 100,
    facing: teamIx === 0 ? 1 : -1, aim: 0.35,   // aim = elevation in radians
    alive: true, dying: false, dyingT: 0,
    airborne: true, peakY: y,
  };
}

function wormBlocked(x, y) {
  // sampled circle hull vs terrain
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * TAU;
    if (terrain.solid(x + Math.cos(a) * (WORM_R - 1), y + Math.sin(a) * (WORM_R - 1))) return true;
  }
  return terrain.solid(x, y);
}

function wormOnGround(w) {
  return terrain.solid(w.x, w.y + WORM_R + 1) ||
         terrain.solid(w.x - WORM_R * 0.6, w.y + WORM_R + 1) ||
         terrain.solid(w.x + WORM_R * 0.6, w.y + WORM_R + 1);
}

function walkWorm(w, dir, dt) {
  if (w.airborne || !w.alive) { w.facing = dir; return; }
  w.facing = dir;                                  // aim mirrors automatically (Req 4.6)
  let dx = dir * WALK_SPEED * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(dx)));
  const sx = dx / steps;
  for (let s = 0; s < steps; s++) {
    let moved = false;
    for (let up = 0; up <= STEP_UP; up++) {        // climbable slope (Req 4.1/4.2)
      if (!wormBlocked(w.x + sx, w.y - up)) { w.x += sx; w.y -= up; moved = true; break; }
    }
    if (!moved) break;                             // too steep — blocked (Req 4.2)
    // follow gentle down-slopes; steep drops become falls
    if (!wormOnGround(w)) {
      let dropped = false;
      for (let down = 1; down <= STEP_UP; down++) {
        if (terrain.solid(w.x, w.y + WORM_R + down)) { w.y += down - 1; dropped = true; break; }
      }
      if (!dropped) { w.airborne = true; w.peakY = w.y; break; }
    }
  }
  w.x = clamp(w.x, WORM_R, W - WORM_R);
}

function jumpWorm(w) {
  if (w.airborne || !w.alive) return;
  w.vx = w.facing * JUMP_VX; w.vy = -JUMP_VY;
  w.airborne = true; w.peakY = w.y;
  audio.play('jump');
}

function stepWorm(w, dt) {
  if (!w.alive) return;
  if (!w.airborne && !wormOnGround(w)) { w.airborne = true; w.peakY = w.y; }  // Req 2.4
  if (w.airborne) {
    w.vy += GRAV * dt;
    w.peakY = Math.min(w.peakY, w.y);
    // sub-stepped integration (no tunnelling into thin terrain)
    const len = Math.hypot(w.vx * dt, w.vy * dt);
    const n = Math.max(1, Math.ceil(len / 3));
    for (let i = 0; i < n; i++) {
      const nx = w.x + w.vx * dt / n, ny = w.y + w.vy * dt / n;
      if (!wormBlocked(nx, ny)) { w.x = nx; w.y = ny; continue; }
      if (w.vy > 0 && wormBlocked(w.x, ny)) {      // landing
        let snapped = w.y;
        for (let s = 0; s < 14 && wormBlocked(w.x, snapped); s++) snapped -= 1;
        w.y = snapped;
        const fall = w.y - w.peakY;
        if (fall > SAFE_FALL) {                    // Req 4.4
          const dmg = Math.round(clamp((fall - SAFE_FALL) * FALL_DMG_K, 1, FALL_DMG_CAP));
          w.hp -= dmg;
          addText(w.x, w.y - 22, `-${dmg}`, '#ffb54d');
        }
        w.vx = 0; w.vy = 0; w.airborne = false;
        break;
      }
      if (wormBlocked(nx, w.y)) w.vx = 0; else w.x = nx;   // slide along walls
      if (wormBlocked(w.x, ny)) w.vy = 0; else w.y = ny;
    }
    w.x = clamp(w.x, WORM_R, W - WORM_R);
  }
  // drowning (Req 6.5) — instant, regardless of HP
  if (w.alive && w.y + WORM_R >= terrain.waterY) drownWorm(w);
  // HP death -> delayed detonation (Req 6.4)
  if (w.alive && !w.dying && w.hp <= 0) { w.dying = true; w.dyingT = DEATH_BLAST.delay; }
  if (w.dying) {
    w.dyingT -= dt;
    if (w.dyingT <= 0) {
      w.alive = false; w.dying = false;
      explode(w.x, w.y, DEATH_BLAST.radius, DEATH_BLAST.dmg);
      addGrave(w.x, w.y);
    }
  }
}

function drownWorm(w) {
  w.alive = false; w.dying = false;
  audio.play('splash');
  for (let i = 0; i < 14; i++) {
    game.particles.push({ x: w.x + rand(-8, 8), y: terrain.waterY, vx: rand(-60, 60), vy: rand(-240, -60), life: rand(0.4, 0.8), color: '#9fd0f5', size: rand(2, 4), grav: 1 });
  }
  addText(w.x, terrain.waterY - 24, `${w.name} drowned!`, '#9fd0f5');
}

function addGrave(x, y) {
  let gy = y;
  while (gy < terrain.waterY - 4 && !terrain.solid(x, gy + 6)) gy += 2;   // settle on ground
  if (gy < terrain.waterY - 2) game.graves.push({ x, y: gy });
}

function addText(x, y, txt, color) {
  game.texts.push({ x, y, txt, color, life: 1.3 });
}

// ============================================================ explosions (Req 6)

function explode(x, y, radius, maxDmg) {
  terrain.carve(x, y, radius);                                   // Req 2.2
  for (const w of livingWorms()) {
    const d = dist(w.x, w.y, x, y);
    if (d >= radius + WORM_R) continue;
    // proximity falloff with the 25%-of-max floor while overlapping (Req 6.2)
    const dmg = Math.round(Math.max(maxDmg * (1 - d / radius), 0.25 * maxDmg));
    w.hp -= dmg;
    addText(w.x, w.y - 24, `-${dmg}`, '#ff6b57');
    // knockback away from blast centre, scaled by damage (Req 6.3)
    let nx = (w.x - x) / (d || 1), ny = (w.y - y) / (d || 1);
    if (!d) { nx = 0; ny = -1; }
    const imp = 110 + dmg * 5.5;
    w.vx += nx * imp; w.vy += ny * imp - 70;
    w.airborne = true; w.peakY = w.y;              // fallStart recorded after knockback
  }
  // feedback (Req 8.2)
  const n = clamp(radius / 3, 10, 30) | 0;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(60, 320);
    game.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: rand(0.35, 0.9), color: Math.random() < 0.5 ? '#6e4526' : '#ffb054', size: rand(2, 5), grav: 1 });
  }
  game.particles.push({ x, y, vx: 0, vy: 0, life: 0.22, color: 'flash', size: radius });
  game.shakeT = 0.35; game.shakeMag = clamp(radius / 8, 3, 12);
  audio.play('explosion', radius);
}

// ============================================================ projectiles (Req 5)

function spawnProjectile(wid, x, y, vx, vy) {
  const w = WEAPONS[wid];
  game.projectiles.push({ wid, x, y, vx, vy, fuse: w.fuse || 0, age: 0, safety: 0.12 });
}

function projExplode(p) {
  const w = WEAPONS[p.wid];
  const dmg = p.wid === 'bomblet' ? WEAPONS.cluster.bomblets.dmg : w.dmg;
  const radius = p.wid === 'bomblet' ? WEAPONS.cluster.bomblets.radius : w.radius;
  explode(p.x, p.y, radius, dmg);
  if (p.wid === 'cluster') {                                     // Req 5.5: exactly 5 bomblets
    for (let i = 0; i < WEAPONS.cluster.bomblets.count; i++) {
      game.projectiles.push({ wid: 'bomblet', x: p.x, y: p.y - 6, vx: rand(-170, 170), vy: rand(-330, -140), fuse: 0, age: 0, safety: 0.15 });
    }
  }
}

function stepProjectile(p, dt) {
  const w = p.wid === 'bomblet' ? { wind: 0, impact: true, rest: 0 } : WEAPONS[p.wid];
  p.age += dt;
  if (p.safety > 0) p.safety -= dt;
  if (p.age > PROJ_TIMEOUT) { projExplode(p); return false; }    // Req 9.1
  if (w.fuse) { p.fuse -= dt; if (p.fuse <= 0) { projExplode(p); return false; } }
  p.vx += (w.wind ? game.wind * WIND_ACC * w.wind : 0) * dt;     // Req 5.3/5.8
  p.vy += GRAV * dt;
  const len = Math.hypot(p.vx * dt, p.vy * dt);
  const n = Math.max(1, Math.ceil(len / 3));                     // swept <=3 px sub-steps
  for (let i = 0; i < n; i++) {
    const nx = p.x + p.vx * dt / n, ny = p.y + p.vy * dt / n;
    // water removes it — splash, no explosion
    if (ny >= terrain.waterY) {
      audio.play('splash');
      for (let k = 0; k < 8; k++) game.particles.push({ x: nx, y: terrain.waterY, vx: rand(-50, 50), vy: rand(-200, -60), life: 0.5, color: '#9fd0f5', size: 3, grav: 1 });
      return false;
    }
    // worm hit (impact weapons) — small safety window so it clears its own muzzle
    if (p.safety <= 0) {
      for (const worm of livingWorms()) {
        if (dist(nx, ny, worm.x, worm.y) < WORM_R + 3) {
          if (w.impact) { p.x = nx; p.y = ny; projExplode(p); return false; }
        }
      }
    }
    if (terrain.solid(nx, ny)) {
      if (w.impact) { p.x = nx; p.y = ny; projExplode(p); return false; }
      // bounce: estimate surface normal from local solidity samples
      let gx = 0, gy = 0;
      for (let ox = -3; ox <= 3; ox += 3) for (let oy = -3; oy <= 3; oy += 3) {
        if (terrain.solid(nx + ox, ny + oy)) { gx -= ox; gy -= oy; }
      }
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl; gy /= gl;
      const dot = p.vx * gx + p.vy * gy;
      p.vx = (p.vx - 2 * dot * gx) * w.rest;
      p.vy = (p.vy - 2 * dot * gy) * w.rest;
      if (Math.hypot(p.vx, p.vy) < 25) { p.vx = 0; p.vy = 0; }
      continue;
    }
    p.x = nx; p.y = ny;
  }
  // off-world discard once it cannot return (Req 5.9); top always returns via gravity
  if (p.x < -260 || p.x > W + 260) return false;
  return true;
}

// ============================================================ firing (Req 5)

function currentWeapon() { return WEAPONS[game.selectedWeapon]; }

function teamAmmo(team, wid) {
  const base = WEAPONS[wid].ammo;
  return base === Infinity ? Infinity : team.ammo[wid];
}

function selectWeapon(wid) {
  if (game.state !== 'AIMING' && game.state !== 'CHARGING') return;
  if (game.weaponLocked) return;                          // mid-shotgun lock
  if (teamAmmo(activeTeamObj(), wid) <= 0) return;        // Req 5.10 refuse depleted
  game.selectedWeapon = wid;
  audio.play('ui');
  syncWeaponPanel();
}

function consumeAmmo(wid) {
  const t = activeTeamObj();
  if (WEAPONS[wid].ammo !== Infinity) t.ammo[wid]--;
}

function aimDir(w) { return { x: w.facing * Math.cos(w.aim), y: -Math.sin(w.aim) }; }

function fireCharged(power) {                              // bazooka / grenade / cluster
  const w = activeWorm(), wd = currentWeapon();
  const d = aimDir(w);
  const speed = Math.max(0.12, power) * MAX_POWER;
  spawnProjectile(game.selectedWeapon, w.x + d.x * (WORM_R + 7), w.y + d.y * (WORM_R + 7), d.x * speed, d.y * speed);
  consumeAmmo(game.selectedWeapon);
  afterShot(true);
  audio.play('fire');
}

function fireShotgun() {                                   // Req 5.6 — instant ray
  const w = activeWorm(), d = aimDir(w);
  if (game.shotsLeft === 0) { game.shotsLeft = WEAPONS.shotgun.shots; consumeAmmo('shotgun'); game.weaponLocked = true; }
  let hx = null, hy = null;
  let x = w.x + d.x * (WORM_R + 5), y = w.y + d.y * (WORM_R + 5);
  for (let s = 0; s < 1100; s++) {
    x += d.x * 2; y += d.y * 2;
    if (x < 0 || x > W || y < 0 || y >= terrain.waterY) break;
    const hitWorm = livingWorms().find(o => o !== w && dist(x, y, o.x, o.y) < WORM_R + 2);
    if (hitWorm || terrain.solid(x, y)) { hx = x; hy = y; break; }
  }
  for (let s = 0; s < 12; s++) {
    const t = s / 12;
    game.particles.push({ x: w.x + d.x * (WORM_R + 5) + d.x * t * ((hx !== null ? dist(w.x, w.y, hx, hy) : 500)), y: w.y + d.y * (WORM_R + 5) + d.y * t * ((hx !== null ? dist(w.x, w.y, hx, hy) : 500)), vx: 0, vy: 0, life: 0.12, color: '#fff3b0', size: 2, grav: 0 });
  }
  if (hx !== null) explode(hx, hy, WEAPONS.shotgun.radius, WEAPONS.shotgun.dmg);
  audio.play('fire');
  game.shotsLeft--;
  if (game.shotsLeft <= 0) afterShot(false);               // no retreat after hitscan
  // between shots: stay in AIMING, timer keeps running (Req 5.6)
}

function fireDynamite() {                                  // Req 5.7
  const w = activeWorm();
  spawnProjectile('dynamite', w.x, w.y + WORM_R - 6, w.facing * 12, -20);
  consumeAmmo('dynamite');
  afterShot(true);
  audio.play('ui');
}

function afterShot(withRetreat) {
  game.retreatTimer = withRetreat ? RETREAT_TIME : 0;      // Req 3.4
  game.aimingCharge = 0;
  setState('PROJECTILE');
  syncWeaponPanel();
}

function pressFire() {
  if (game.state !== 'AIMING') return;
  const wd = currentWeapon();
  if (wd.charge) { setState('CHARGING'); game.aimingCharge = 0; }
  else if (wd.instant === 'ray') fireShotgun();
  else if (wd.instant === 'drop') fireDynamite();
}

function releaseFire() {
  if (game.state !== 'CHARGING') return;
  fireCharged(game.aimingCharge);
}

// ============================================================ turn flow (Req 3, 10)

function startMatch(mode) {
  game.mode = mode;
  terrain.generate();
  game.teams = TEAM_DEFS.map((def, ti) => ({
    name: def.name, color: def.color, dark: def.dark,
    isCpu: mode === 'demo' || (mode === 'cpu' && ti === 1),
    cursor: -1,
    ammo: { cluster: WEAPONS.cluster.ammo, shotgun: WEAPONS.shotgun.ammo, dynamite: WEAPONS.dynamite.ammo },
    worms: [],
  }));
  // spawn placement with spacing; regenerate terrain on failure (Req 1.2, 1.7)
  let placed = null;
  for (let attempt = 0; attempt < 8 && !placed; attempt++) {
    placed = tryPlaceWorms();
    if (!placed) terrain.generate();
  }
  if (!placed) placed = tryPlaceWorms(true);               // last resort: relax spacing
  placed.forEach((p, i) => {
    const ti = i % 2, wi = (i / 2) | 0;
    game.teams[ti].worms.push(makeWorm(ti, wi, p.x, p.y));
  });
  game.projectiles = []; game.particles = []; game.texts = []; game.graves = [];
  game.turnCount = 0; game.suddenDeath = false;
  game.activeTeam = Math.floor(Math.random() * 2);         // Req 3.1 random first team
  game.selectedWeapon = 'bazooka';
  document.getElementById('title').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('sudden').classList.add('hidden');
  buildWeaponPanel();
  setState('TURN_START');
}

function tryPlaceWorms(relaxed) {
  const spacing = relaxed ? 40 : 80;
  const spots = [];
  for (let x = 30; x < W - 30; x += 8) {
    const y = terrain.heights[x | 0];
    if (y < terrain.waterY - 14 && Math.abs(terrain.heights[clamp(x + 8, 0, W - 1) | 0] - terrain.heights[clamp(x - 8, 0, W - 1) | 0]) < 16) {
      spots.push({ x, y: y - WORM_R - 3 });
    }
  }
  for (let i = spots.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const chosen = [];
  for (const s of spots) {
    if (chosen.every(c => Math.abs(c.x - s.x) >= spacing)) chosen.push(s);
    if (chosen.length === 8) return chosen;
  }
  return null;
}

function nextLivingCursor(team) {
  for (let i = 1; i <= team.worms.length; i++) {
    const ix = (team.cursor + i) % team.worms.length;
    if (team.worms[ix].alive) return ix;
  }
  return -1;
}

function beginTurn() {
  const team = activeTeamObj();
  // a team wiped between turn end and turn start (late fall/drowning) must
  // resolve to victory, not crash the turn machinery (Req 9.3)
  if (!teamAlive(team) || !teamAlive(game.teams[1 - game.activeTeam])) { setState('SETTLING'); return; }
  team.cursor = nextLivingCursor(team);                    // Req 3.2 round-robin
  game.wind = rand(-1, 1);                                 // Req 5.8
  game.turnTimer = TURN_TIME;
  game.retreatTimer = 0;
  game.shotsLeft = 0; game.weaponLocked = false;
  game.aimingCharge = 0;
  if (teamAmmo(team, game.selectedWeapon) <= 0) game.selectedWeapon = 'bazooka';
  if (game.suddenDeath) {                                  // Req 10.3 rising water
    terrain.waterY -= SD_WATER_RISE;
  }
  const w = activeWorm();
  showBanner(`${team.name} — ${w.name}`, team.color);
  audio.play('turn');
  if (team.isCpu) cpuInit();
  else game.cpu = null;
  buildWeaponPanel();
  setState('AIMING');
}

function endTurnCheck() {
  // called from TURN_END: victory / draw / continue (Req 1.3, 1.4)
  const a = teamAlive(game.teams[0]), b = teamAlive(game.teams[1]);
  if (!a || !b) {
    const msg = !a && !b ? 'DRAW!' : `${(a ? game.teams[0] : game.teams[1]).name.toUpperCase()} WINS!`;
    const el = document.getElementById('resulttext');
    el.textContent = msg;
    el.style.color = !a && !b ? '#fff' : (a ? game.teams[0] : game.teams[1]).color;
    setState('GAME_OVER');
    setTimeout(() => document.getElementById('gameover').classList.remove('hidden'), 900);
    return;
  }
  game.turnCount++;
  if (!game.suddenDeath && game.turnCount >= SUDDEN_DEATH_TURNS) {   // Req 10.1/10.2
    game.suddenDeath = true;
    for (const w of livingWorms()) w.hp = Math.min(w.hp, SD_HP_CAP);
    document.getElementById('sudden').classList.remove('hidden');
    showBanner('SUDDEN DEATH', '#ff5240');
  }
  game.activeTeam = 1 - game.activeTeam;
  setState('TURN_START');
}

function allSettled() {
  return game.projectiles.length === 0 &&
         livingWorms().every(w => !w.airborne && !w.dying) &&
         !game.teams.flatMap(t => t.worms).some(w => w.dying);
}

// ============================================================ CPU (Req 7)

function cpuInit() {
  const team = activeTeamObj();
  const me = activeWorm();
  const enemies = game.teams[1 - game.activeTeam].worms.filter(w => w.alive);
  let target = enemies[0];
  for (const e of enemies) if (dist(me.x, me.y, e.x, e.y) < dist(me.x, me.y, target.x, target.y)) target = e;
  // candidate grid: 40 bazooka + 20 grenade sims, time-sliced (Req 7.5)
  const cands = [];
  const side = target.x >= me.x ? 1 : -1;
  for (const el of [15, 24, 33, 42, 51, 60, 69, 78]) {
    for (const pw of [0.4, 0.55, 0.7, 0.85, 1.0]) cands.push({ wid: 'bazooka', el: el * Math.PI / 180, pw, side });
  }
  for (const el of [40, 55, 70, 80]) {
    for (const pw of [0.35, 0.5, 0.65, 0.8, 0.95]) cands.push({ wid: 'grenade', el: el * Math.PI / 180, pw, side });
  }
  game.cpu = { phase: 'think', t: 0.8, target, cands, next: 0, best: null, plan: null };
}

function cpuSimShot(me, cand, target) {
  const w = WEAPONS[cand.wid];
  const dx = cand.side * Math.cos(cand.el), dy = -Math.sin(cand.el);
  let x = me.x + dx * (WORM_R + 7), y = me.y + dy * (WORM_R + 7);
  let vx = dx * cand.pw * MAX_POWER, vy = dy * cand.pw * MAX_POWER;
  let fuse = w.fuse, bestD = 1e9;
  const dt = FIXED_DT;
  for (let s = 0; s < 600; s++) {
    vx += (w.wind ? game.wind * WIND_ACC : 0) * dt;
    vy += GRAV * dt;
    const len = Math.hypot(vx * dt, vy * dt), n = Math.max(1, Math.ceil(len / 3));
    let done = false;
    for (let i = 0; i < n; i++) {
      const nx = x + vx * dt / n, ny = y + vy * dt / n;
      if (ny >= terrain.waterY || nx < -260 || nx > W + 260) { done = true; break; }
      if (s * dt > 0.15 && dist(nx, ny, target.x, target.y) < WORM_R + 3) { return 0; }
      if (terrain.solid(nx, ny)) {
        if (w.impact) { done = true; bestD = Math.min(bestD, dist(nx, ny, target.x, target.y)); break; }
        let gx = 0, gy = 0;
        for (let ox = -3; ox <= 3; ox += 3) for (let oy = -3; oy <= 3; oy += 3) if (terrain.solid(nx + ox, ny + oy)) { gx -= ox; gy -= oy; }
        const gl = Math.hypot(gx, gy) || 1;
        const dot = vx * (gx / gl) + vy * (gy / gl);
        vx = (vx - 2 * dot * gx / gl) * w.rest; vy = (vy - 2 * dot * gy / gl) * w.rest;
        continue;
      }
      x = nx; y = ny;
    }
    if (w.fuse) { fuse -= dt; if (fuse <= 0) return dist(x, y, target.x, target.y); }
    if (done) break;
  }
  return bestD;
}

function cpuUpdate(dt) {
  const c = game.cpu, me = activeWorm();
  if (!c || !me || !me.alive) return;
  if (c.phase === 'think') {
    // time-sliced search: <=8 sims per frame keeps every frame under budget
    let done = 0;
    while (c.next < c.cands.length && done < 8) {
      const cand = c.cands[c.next++];
      const score = cpuSimShot(me, cand, c.target);
      if (!c.best || score < c.best.score) c.best = { ...cand, score };
      done++;
    }
    c.t -= dt;
    if ((c.t <= 0 && c.next >= c.cands.length) || game.turnTimer < 6) {
      const sameTarget = activeTeamObj().lastTarget === c.target;
      activeTeamObj().lastTarget = c.target;
      const sigA = (sameTarget ? 1.6 : 3.2) * Math.PI / 180;
      const b = c.best || { wid: 'bazooka', el: 0.9, pw: 0.8, side: me.facing, score: 1e9 };
      c.plan = {
        wid: b.wid,
        el: clamp(b.el + gauss(sigA), 0.06, 1.5),
        pw: clamp(b.pw + gauss(0.03), 0.15, 1),
        side: b.side,
      };
      c.phase = 'aim';
    }
  } else if (c.phase === 'aim') {
    me.facing = c.plan.side;
    if (game.selectedWeapon !== c.plan.wid) { game.selectedWeapon = c.plan.wid; syncWeaponPanel(); }
    const d = c.plan.el - me.aim;
    const step = 1.6 * dt;                                  // visible sweep (Req 7.1)
    if (Math.abs(d) <= step) { me.aim = c.plan.el; c.phase = 'fire'; }
    else me.aim += Math.sign(d) * step;
  } else if (c.phase === 'fire') {
    if (game.state === 'AIMING') pressFire();               // enters CHARGING
    if (game.state === 'CHARGING' && game.aimingCharge >= c.plan.pw) releaseFire();
    if (game.turnTimer < 1.5 && game.state === 'CHARGING') releaseFire();
  }
}

// ============================================================ input (Req 4, 5)

const keys = new Set();
const PREVENT = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter'];

function humanTurn() {
  const t = activeTeamObj();
  return t && !t.isCpu;
}

addEventListener('keydown', e => {
  if (PREVENT.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (!humanTurn()) return;
  if (game.state === 'AIMING') {
    if (e.code === 'Space') pressFire();
    else if (e.code === 'Enter' || e.code === 'KeyZ') jumpWorm(activeWorm());
    else {
      const wid = WEAPON_IDS.find(id => 'Digit' + WEAPONS[id].key === e.code);
      if (wid) selectWeapon(wid);
    }
  }
});

addEventListener('keyup', e => {
  keys.delete(e.code);
  if (!humanTurn()) return;
  if (e.code === 'Space') releaseFire();
});

function handleHeldInput(dt) {
  if (!humanTurn()) return;
  const w = activeWorm();
  if (!w || !w.alive) return;
  const canWalk = game.state === 'AIMING' ||
    ((game.state === 'PROJECTILE' || game.state === 'SETTLING') && game.retreatTimer > 0); // Req 3.4
  const canAim = game.state === 'AIMING' || game.state === 'CHARGING';
  if (canWalk) {
    if (keys.has('ArrowLeft')) walkWorm(w, -1, dt);
    else if (keys.has('ArrowRight')) walkWorm(w, 1, dt);
  }
  if (canAim) {                                             // Req 4.5 smooth sweep
    if (keys.has('ArrowUp')) w.aim = clamp(w.aim + 1.5 * dt, -1.48, 1.48);
    if (keys.has('ArrowDown')) w.aim = clamp(w.aim - 1.5 * dt, -1.48, 1.48);
  }
}

// ============================================================ state machine

const states = {
  TITLE() { /* waiting on menu buttons */ },

  TURN_START() {
    if (game.stateTime > 0.7) beginTurn();
  },

  AIMING(dt) {
    // a team wiped mid-turn (e.g. sudden-death water) must end the match
    // within 2 s (Req 1.3) — don't wait out the turn clock
    if (!teamAlive(game.teams[0]) || !teamAlive(game.teams[1])) { setState('SETTLING'); return; }
    if (activeTeamObj().isCpu) cpuUpdate(dt);
    const w = activeWorm();
    if (!w || !w.alive) { setState('SETTLING'); return; }   // Req 3.7
    game.turnTimer -= dt;
    if (game.turnTimer <= 0) setState('SETTLING');          // Req 3.3 expiry, nothing fired
  },

  CHARGING(dt) {
    if (!teamAlive(game.teams[0]) || !teamAlive(game.teams[1])) { setState('SETTLING'); return; }
    if (activeTeamObj().isCpu) cpuUpdate(dt);
    game.aimingCharge = Math.min(1, game.aimingCharge + dt / CHARGE_TIME);
    game.turnTimer -= dt;
    if (game.aimingCharge >= 1 || game.turnTimer <= 0) releaseFire();  // Req 3.3, 5.2
  },

  PROJECTILE(dt) {
    if (game.retreatTimer > 0) game.retreatTimer -= dt;
    if (game.projectiles.length === 0) setState('SETTLING');
  },

  SETTLING(dt) {
    if (game.retreatTimer > 0) game.retreatTimer -= dt;
    if (game.projectiles.length > 0) { setState('PROJECTILE'); return; }  // chain spawned more
    // retreat ends early once effects resolved & worm at rest (Req 3.4);
    // hard cap force-settles (Req 9.2)
    if (allSettled() || game.stateTime > SETTLE_CAP) {
      if (game.stateTime > SETTLE_CAP) {
        for (const w of livingWorms()) { w.vx = 0; w.vy = 0; w.airborne = false; }
      }
      setState('TURN_END');
    }
  },

  TURN_END() { endTurnCheck(); },

  GAME_OVER() {
    if (game.mode === 'demo' && game.stateTime > 5) startMatch('demo');  // continuous demo
  },
};

// ============================================================ fixed step

function fixedStep(dt) {
  game.stateTime += dt;
  handleHeldInput(dt);
  const simActive = game.state !== 'TITLE' && game.state !== 'GAME_OVER';
  if (simActive) {
    // dying worms are still alive=true until detonation, so one pass covers them
    for (const w of livingWorms()) stepWorm(w, dt);
    game.projectiles = game.projectiles.filter(p => stepProjectile(p, dt));
  }
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.life -= dt;
    if (p.life <= 0) { game.particles.splice(i, 1); continue; }
    if (p.grav) p.vy += GRAV * 0.6 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = game.texts.length - 1; i >= 0; i--) {
    const t = game.texts[i];
    t.life -= dt; t.y -= 26 * dt;
    if (t.life <= 0) game.texts.splice(i, 1);
  }
  if (game.shakeT > 0) game.shakeT -= dt;
  (states[game.state] || (() => {}))(dt);
}

// ============================================================ rendering

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

function render(time) {
  ctx.save();
  if (game.shakeT > 0) {
    const m = game.shakeMag * (game.shakeT / 0.35);
    ctx.translate(rand(-m, m), rand(-m, m));
  }
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#6ea7e0'); sky.addColorStop(0.7, '#a8cdf0'); sky.addColorStop(1, '#d5e9fa');
  ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);
  // drifting clouds
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  for (let i = 0; i < 5; i++) {
    const cx = ((time * 0.008 + i * 340) % (W + 300)) - 150;
    const cy = 90 + i * 55;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 70, 20, 0, 0, TAU);
    ctx.ellipse(cx + 45, cy - 10, 45, 16, 0, 0, TAU);
    ctx.fill();
  }
  // terrain
  if (terrain.cvs) ctx.drawImage(terrain.cvs, 0, 0);
  // graves
  for (const g of game.graves) {
    ctx.fillStyle = '#9aa2ad';
    ctx.beginPath();
    ctx.moveTo(g.x - 8, g.y + 8); ctx.lineTo(g.x - 8, g.y - 4);
    ctx.arc(g.x, g.y - 4, 8, Math.PI, 0);
    ctx.lineTo(g.x + 8, g.y + 8);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#59606a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - 8); ctx.lineTo(g.x, g.y + 2);
    ctx.moveTo(g.x - 4, g.y - 4); ctx.lineTo(g.x + 4, g.y - 4);
    ctx.stroke();
  }
  // worms
  for (const t of game.teams) for (const w of t.worms) {
    if (!w.alive && !w.dying) continue;
    ctx.save();
    if (w.dying && (w.dyingT * 10 | 0) % 2 === 0) ctx.globalAlpha = 0.5;
    // body
    ctx.fillStyle = '#f4b8c1';
    ctx.beginPath(); ctx.ellipse(w.x, w.y, WORM_R - 1, WORM_R + 1, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.ellipse(w.x, w.y + 3, WORM_R - 2, WORM_R * 0.55, 0, 0, TAU); ctx.fill();
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(w.x + w.facing * 3, w.y - 5, 3.2, 0, TAU); ctx.arc(w.x + w.facing * 7, w.y - 5, 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(w.x + w.facing * 4, w.y - 5, 1.4, 0, TAU); ctx.arc(w.x + w.facing * 8, w.y - 5, 1.4, 0, TAU); ctx.fill();
    ctx.restore();
    // HP label (Req 6.1)
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(Math.max(0, Math.ceil(w.hp)), w.x, w.y - 18);
    ctx.fillStyle = t.color;
    ctx.fillText(Math.max(0, Math.ceil(w.hp)), w.x, w.y - 18);
  }
  // active worm marker + crosshair
  const aw = activeWorm();
  if (aw && aw.alive && game.state !== 'TITLE' && game.state !== 'GAME_OVER') {
    const bob = Math.sin(time / 180) * 3;
    ctx.fillStyle = activeTeamObj().color;
    ctx.beginPath();
    ctx.moveTo(aw.x, aw.y - 34 + bob);
    ctx.lineTo(aw.x - 7, aw.y - 46 + bob);
    ctx.lineTo(aw.x + 7, aw.y - 46 + bob);
    ctx.closePath(); ctx.fill();
    if (game.state === 'AIMING' || game.state === 'CHARGING') {
      const d = aimDir(aw);
      const cxp = aw.x + d.x * 52, cyp = aw.y + d.y * 52;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(aw.x + d.x * 16, aw.y + d.y * 16); ctx.lineTo(cxp, cyp); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(cxp, cyp, 7, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxp - 10, cyp); ctx.lineTo(cxp + 10, cyp); ctx.moveTo(cxp, cyp - 10); ctx.lineTo(cxp, cyp + 10); ctx.stroke();
    }
  }
  // projectiles
  for (const p of game.projectiles) {
    if (p.wid === 'bazooka') {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillStyle = '#3a3f47';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff7a45'; ctx.fillRect(-11, -2, 4, 4);
      ctx.restore();
    } else if (p.wid === 'dynamite') {
      ctx.fillStyle = '#d8342a';
      ctx.fillRect(p.x - 4, p.y - 10, 8, 20);
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 10); ctx.quadraticCurveTo(p.x + 5, p.y - 17, p.x + 2, p.y - 20); ctx.stroke();
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(Math.ceil(p.fuse), p.x, p.y - 24);
    } else {
      ctx.fillStyle = p.wid === 'bomblet' ? '#ffb054' : (p.wid === 'cluster' ? '#e0b23d' : '#3f7a35');
      ctx.beginPath(); ctx.arc(p.x, p.y, p.wid === 'bomblet' ? 4 : 6, 0, TAU); ctx.fill();
      if (WEAPONS[p.wid] && WEAPONS[p.wid].fuse) {
        ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeText(Math.ceil(p.fuse), p.x, p.y - 12);
        ctx.fillText(Math.ceil(p.fuse), p.x, p.y - 12);
      }
    }
  }
  // particles
  for (const p of game.particles) {
    if (p.color === 'flash') {
      ctx.fillStyle = `rgba(255,236,180,${clamp(p.life / 0.22, 0, 1) * 0.8})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - p.life / 0.22), 0, TAU); ctx.fill();
    } else {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.globalAlpha = 1;
    }
  }
  // water (animated, translucent, over submerged terrain)
  const wy = terrain.waterY;
  ctx.fillStyle = 'rgba(38,110,190,0.55)';
  ctx.fillRect(-20, wy, W + 40, H - wy + 20);
  ctx.strokeStyle = 'rgba(190,230,255,0.8)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 16) {
    const yy = wy + Math.sin(x / 55 + time / 350) * 3;
    x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
  }
  ctx.stroke();
  // floating damage numbers (Req 6.6)
  for (const t of game.texts) {
    ctx.font = 'bold 16px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.globalAlpha = clamp(t.life, 0, 1);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(t.txt, t.x, t.y);
    ctx.fillStyle = t.color; ctx.fillText(t.txt, t.x, t.y);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ============================================================ HUD DOM (Req 8)

const $ = id => document.getElementById(id);
const hudCache = {};

function buildWeaponPanel() {
  const box = $('weapons');
  box.innerHTML = '';
  for (const wid of WEAPON_IDS) {
    const w = WEAPONS[wid];
    const b = document.createElement('button');
    b.className = 'wbtn';
    b.dataset.wid = wid;
    b.innerHTML = `<span class="icon">${w.icon}</span><span>${w.name} <kbd>${w.key}</kbd></span><span class="ammo"></span>`;
    b.addEventListener('click', () => { if (humanTurn()) selectWeapon(wid); });
    box.appendChild(b);
  }
  syncWeaponPanel();
}

function syncWeaponPanel() {
  const team = activeTeamObj();
  if (!team) return;
  for (const b of $('weapons').children) {
    const wid = b.dataset.wid;
    const ammo = teamAmmo(team, wid);
    b.querySelector('.ammo').textContent = ammo === Infinity ? '∞' : `×${ammo}`;
    b.classList.toggle('selected', wid === game.selectedWeapon);
    b.classList.toggle('depleted', ammo <= 0);
  }
}

function showBanner(txt, color) {
  const b = $('banner');
  b.textContent = txt;
  b.style.color = color || '#fff';
  b.classList.remove('hidden');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => b.classList.add('hidden'), 1600);
}

function syncHud() {
  $('hud').classList.toggle('hidden', game.state === 'TITLE');
  if (game.state === 'TITLE') return;
  const set = (key, el, val) => { if (hudCache[key] !== val) { hudCache[key] = val; el.textContent = val; } };
  const timer = $('timer');
  const showT = game.state === 'AIMING' || game.state === 'CHARGING';
  set('timer', timer, showT ? String(Math.max(0, Math.ceil(game.turnTimer))) : '–');
  timer.classList.toggle('low', showT && game.turnTimer < 10);
  // wind (Req 5.8)
  const wf = $('windfill');
  const pct = Math.abs(game.wind) * 50;
  wf.style.width = pct + '%';
  wf.style.left = game.wind < 0 ? (50 - pct) + '%' : '50%';
  set('windarrow', $('windarrow'), game.wind < -0.08 ? '←' : game.wind > 0.08 ? '→' : '·');
  // team panels
  game.teams.forEach((t, i) => {
    const panel = $(i === 0 ? 'panelA' : 'panelB');
    panel.style.setProperty('--team', t.color);
    panel.classList.toggle('active-team', i === game.activeTeam && game.state !== 'GAME_OVER');
    const total = t.worms.reduce((s, w) => s + (w.alive ? Math.max(0, w.hp) : 0), 0);
    set('name' + i, panel.querySelector('.team-name'), t.name);
    panel.querySelector('.team-health-fill').style.width = clamp(total / 4, 0, 100) + '%';
    set('worms' + i, panel.querySelector('.team-worms'),
      t.worms.filter(w => w.alive).length + ' worms · ' + total + ' hp');
  });
  // power gauge (Req 5.2)
  const pw = $('powerwrap');
  pw.classList.toggle('hidden', game.state !== 'CHARGING');
  if (game.state === 'CHARGING') $('powerfill').style.width = (game.aimingCharge * 100) + '%';
}

// ============================================================ main loop

let last = performance.now(), acc = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  acc += Math.min(dt, MAX_FRAME_DT);              // Req 9.4 delta clamp
  let steps = 0;
  while (acc >= FIXED_DT && steps < 8) { fixedStep(FIXED_DT); acc += -FIXED_DT; steps++; }
  if (steps === 8) acc = 0;                        // spiral-of-death guard
  render(now);
  syncHud();
  requestAnimationFrame(frame);
}

// ============================================================ boot

function boot() {
  $('btn2p').addEventListener('click', () => { audio.ensure(); audio.play('ui'); startMatch('pvp'); });
  $('btncpu').addEventListener('click', () => { audio.ensure(); audio.play('ui'); startMatch('cpu'); });
  $('btnrematch').addEventListener('click', () => { audio.ensure(); audio.play('ui'); startMatch(game.mode); });
  addEventListener('pointerdown', () => audio.ensure(), { once: true });
  if (new URLSearchParams(location.search).has('demo')) {  // Req 9.5
    startMatch('demo');
  }
  requestAnimationFrame(frame);
}

boot();

})();
