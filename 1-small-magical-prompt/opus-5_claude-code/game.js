/* ============================================================================
 * WORMS — HTML artillery game
 * Single-file engine: terrain, physics, weapons, turn machine, render, audio.
 * See spec/ for requirements, design and tasks.
 * ==========================================================================*/
(function () {
'use strict';

/* ---------------------------------------------------------------- constants */

const WORLD_W = 1800;
const WORLD_H = 900;
const WATER_Y = 820;

const STEP = 1 / 60;            // fixed simulation step, seconds
const GRAVITY = 0.32;           // px / step²
const WIND_ACC = 0.014;         // px / step² per unit of wind
const MAX_LAUNCH = 18;          // px / step
const MIN_LAUNCH = 4;
const CHARGE_TIME = 1.2;        // seconds to full power
const TURN_TIME = 45;
const RETREAT_TIME = 5;
const WORM_RX = 6, WORM_RY = 9;
const WALK_SPEED = 1.05;        // px / step
const MAX_CLIMB = 5;            // px of slope a worm can step up
const FALL_SAFE = 70;           // px of free fall before damage
const PROJ_MAX_LIFE = 12;       // seconds before a stuck projectile self-destructs

const TEAM_DEFS = [
  { name: 'RED',  color: '#ff5f4d', dark: '#a3241a' },
  { name: 'BLUE', color: '#4fb0ff', dark: '#12508f' }
];
const WORMS_PER_TEAM = 4;

const NAME_POOL = [
  'Boggy', 'Spadge', 'Clagnut', 'Wormald', 'Gribble', 'Snotty', 'Mange', 'Wiggles',
  'Grubby', 'Tumble', 'Squirm', 'Noodle', 'Pickles', 'Bosco', 'Whiffy', 'Nadger'
];

/* Weapon table — everything about the arsenal is data. */
const WEAPONS = [
  { id: 'bazooka',  name: 'BAZOOKA',  icon: '🚀', key: '1', ammo: Infinity,
    mode: 'launch', wind: true,  radius: 58, damage: 48, bounce: 0,    fuse: null, r: 3.5, color: '#e8e8e8' },
  { id: 'grenade',  name: 'GRENADE',  icon: '💣', key: '2', ammo: Infinity,
    mode: 'launch', wind: false, radius: 62, damage: 52, bounce: 0.55, fuse: 4,    r: 4,   color: '#5a6b4a' },
  { id: 'cluster',  name: 'CLUSTER',  icon: '☄️', key: '3', ammo: 3,
    mode: 'launch', wind: true,  radius: 46, damage: 30, bounce: 0.5,  fuse: 3,    r: 4.5, color: '#c8a24a', cluster: 5 },
  { id: 'shotgun',  name: 'SHOTGUN',  icon: '🔫', key: '4', ammo: 3,
    mode: 'hitscan', radius: 26, damage: 27, shots: 2 },
  { id: 'dynamite', name: 'DYNAMITE', icon: '🧨', key: '5', ammo: 2,
    mode: 'drop',   wind: false, radius: 88, damage: 78, bounce: 0.1,  fuse: 5,    r: 5,   color: '#c0392b' },
  { id: 'airstrike', name: 'AIRSTRIKE', icon: '✈️', key: '6', ammo: 1,
    mode: 'strike', wind: false, radius: 48, damage: 34, bounce: 0,    fuse: null, r: 3.5, color: '#dcdcdc' }
];
const BOMBLET = { id: 'bomblet', name: 'BOMBLET', mode: 'launch', wind: true,
                  radius: 40, damage: 26, bounce: 0, fuse: null, r: 2.6, color: '#c8a24a' };

/* ---------------------------------------------------------------- utilities */

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const TAU = Math.PI * 2;

/** Cheap deterministic per-pixel noise, avoids 1.6M Math.random() calls. */
function hashNoise(x, y) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) & 255) / 255 - 0.5;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* -------------------------------------------------------------------- audio */

const Audio = {
  ctx: null,
  muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch (e) { this.ctx = null; }
  },
  gainNode(vol, at) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.connect(this.ctx.destination);
    return g;
  },
  tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.gainNode(vol, t);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },
  noise(dur, vol, cutoff, sweepTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(cutoff, t);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    const g = this.gainNode(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g);
    src.start(t);
  },
  boom(scale) {
    const s = clamp(scale, 0.4, 1.6);
    this.noise(0.55 * s, 0.5, 1800 * s, 90);
    this.tone(150 * s, 0.45, 'sine', 0.35, 40);
  },
  fire()   { this.tone(220, 0.22, 'sawtooth', 0.16, 880); this.noise(0.16, 0.12, 2400, 400); },
  shot()   { this.noise(0.18, 0.32, 5200, 500); },
  jump()   { this.tone(420, 0.12, 'square', 0.07, 700); },
  stepSfx(){ this.tone(140 + Math.random() * 40, 0.05, 'square', 0.025); },
  bounce() { this.tone(300, 0.07, 'triangle', 0.05, 180); },
  splash() { this.noise(0.4, 0.24, 900, 200); this.tone(340, 0.3, 'sine', 0.1, 120); },
  select() { this.tone(660, 0.05, 'square', 0.05); },
  deny()   { this.tone(180, 0.12, 'square', 0.07, 110); },
  turn()   { this.tone(440, 0.1, 'triangle', 0.08); setTimeout(() => this.tone(660, 0.16, 'triangle', 0.08), 110); },
  win()    { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.28, 'triangle', 0.1), i * 130)); }
};

/* ------------------------------------------------------------------ terrain */

const terrain = {
  mask: null,
  canvas: null,
  ctx: null,

  generate() {
    const W = WORLD_W, H = WORLD_H;
    this.mask = new Uint8Array(W * H);

    // --- fractal height map (4 octaves of sine) -----------------------------
    const base = H * 0.5;
    const octaves = [
      { amp: rand(80, 130), len: rand(750, 1200), ph: rand(0, TAU) },
      { amp: rand(40, 70),  len: rand(300, 520),  ph: rand(0, TAU) },
      { amp: rand(14, 28),  len: rand(120, 210),  ph: rand(0, TAU) },
      { amp: rand(4, 9),    len: rand(38, 70),    ph: rand(0, TAU) }
    ];
    const hm = new Float32Array(W);
    const bm = new Float32Array(W);
    const EDGE = 260;                       // shoreline taper, makes it an island
    const smooth = t => t * t * (3 - 2 * t);
    const bBase = WATER_Y + 42, bAmp = rand(14, 30), bLen = rand(220, 460), bPh = rand(0, TAU);

    for (let x = 0; x < W; x++) {
      let h = base;
      for (let i = 0; i < octaves.length; i++) {
        const o = octaves[i];
        h += Math.sin((x / o.len) * TAU + o.ph) * o.amp;
      }
      h = clamp(h, 150, WATER_Y - 70);

      // sink the land into the sea at both ends
      const edge = Math.min(x, W - 1 - x);
      if (edge < EDGE) h = lerp(WATER_Y + 55, h, smooth(edge / EDGE));
      hm[x] = h;

      // submerged underside
      bm[x] = Math.min(H - 1, bBase + Math.sin((x / bLen) * TAU + bPh) * bAmp +
                              Math.sin(x * 0.0007) * 12);
    }

    for (let x = 0; x < W; x++) {
      const top = hm[x] | 0, bot = bm[x] | 0;
      for (let y = top; y <= bot; y++) this.mask[y * W + x] = 1;
    }

    // --- caves & overhangs --------------------------------------------------
    const caves = randInt(4, 7);
    for (let c = 0; c < caves; c++) {
      const cx = randInt(EDGE + 60, W - EDGE - 60);
      const cy = randInt((hm[cx] | 0) + 70, Math.max((hm[cx] | 0) + 80, WATER_Y - 30));
      const rx = rand(55, 150), ry = rand(28, 70);
      const wob = rand(0.004, 0.012), amp = rand(0.15, 0.35);
      for (let y = Math.max(0, cy - ry | 0); y < Math.min(H, cy + ry); y++) {
        for (let x = Math.max(0, cx - rx | 0); x < Math.min(W, cx + rx); x++) {
          const wr = rx * (1 + Math.sin(y * wob * 8) * amp);
          const dx = (x - cx) / wr, dy = (y - cy) / ry;
          if (dx * dx + dy * dy < 1) this.mask[y * W + x] = 0;
        }
      }
    }

    this.paint();
  },

  /** Rasterise the mask into an offscreen canvas with grass / soil strata. */
  paint() {
    const W = WORLD_W, H = WORLD_H;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = W;
      this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');
    }
    this.ctx.clearRect(0, 0, W, H);
    const img = this.ctx.createImageData(W, H);
    const d = img.data;

    for (let x = 0; x < W; x++) {
      // enclosed gaps (between the first and last solid pixel of a column) are
      // painted as cave interior instead of showing raw sky through the map
      let colBottom = -1;
      for (let y = H - 1; y >= 0; y--) if (this.mask[y * W + x]) { colBottom = y; break; }

      let depth = 0;        // pixels below the top of the current solid run
      let run = 0;          // which solid run down the column we are in
      let solidAbove = false;
      let columnTop = -1;   // first solid pixel: strata are measured from here
      let ceilDist = 0;     // pixels below the last ceiling, for cave shading
      for (let y = 0; y < H; y++) {
        const i = y * W + x;
        if (!this.mask[i]) {
          depth = 0;
          solidAbove = false;
          if (columnTop >= 0 && y < colBottom) {
            ceilDist++;
            const shade = clamp(ceilDist / 26, 0, 1);
            const cn = hashNoise(x, y) * 10;
            const o = i * 4;
            d[o]     = clamp(30 + 30 * shade + cn, 0, 255);
            d[o + 1] = clamp(22 + 22 * shade + cn, 0, 255);
            d[o + 2] = clamp(18 + 16 * shade + cn, 0, 255);
            d[o + 3] = 255;
          }
          continue;
        }
        ceilDist = 0;
        if (!solidAbove) { run++; solidAbove = true; }
        if (columnTop < 0) columnTop = y;
        depth++;

        const n = hashNoise(x, y) * 14;
        const dd = y - columnTop;                       // absolute depth
        const band = Math.sin(y * 0.055 + x * 0.004) * 7;
        const t = Math.min(1, Math.max(0, dd - 12) / 240);
        let r = 148 - 76 * t + band;
        let g = 100 - 52 * t + band * 0.7;
        let b = 62 - 34 * t + band * 0.4;

        if (run === 1 && depth <= 3)      { r = 126; g = 200; b = 78; }   // sunlit grass
        else if (run === 1 && depth <= 8) { r = 88;  g = 158; b = 56; }   // grass roots
        else if (depth <= 3)              { r *= 0.72; g *= 0.72; b *= 0.72; } // cave crust
        else if (run === 1 && depth <= 12){ r = 132; g = 108; b = 62; }
        const o = i * 4;
        d[o]     = clamp(r + n, 0, 255);
        d[o + 1] = clamp(g + n, 0, 255);
        d[o + 2] = clamp(b + n, 0, 255);
        d[o + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
  },

  solid(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    return this.mask[y * WORLD_W + x] === 1;
  },

  /** Topmost solid pixel in a column, or -1. */
  surfaceY(x) {
    x |= 0;
    if (x < 0 || x >= WORLD_W) return -1;
    for (let y = 0; y < WORLD_H; y++) if (this.mask[y * WORLD_W + x]) return y;
    return -1;
  },

  carve(cx, cy, r) {
    cx |= 0; cy |= 0;
    const x0 = Math.max(0, cx - r | 0), x1 = Math.min(WORLD_W - 1, cx + r | 0);
    const y0 = Math.max(0, cy - r | 0), y1 = Math.min(WORLD_H - 1, cy + r | 0);
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) this.mask[y * WORLD_W + x] = 0;
      }
    }
    const c = this.ctx;
    // scorch rim first: source-atop paints only where soil still exists
    c.save();
    c.globalCompositeOperation = 'source-atop';
    const grad = c.createRadialGradient(cx, cy, r * 0.8, cx, cy, r + 7);
    grad.addColorStop(0, 'rgba(28,14,6,0.85)');
    grad.addColorStop(1, 'rgba(28,14,6,0)');
    c.fillStyle = grad;
    c.beginPath(); c.arc(cx, cy, r + 7, 0, TAU); c.fill();
    c.restore();
    // then punch the hole
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    c.restore();
  }
};

/* -------------------------------------------------------------------- state */

const game = {
  state: 'TITLE',      // TITLE AIM TARGET FLIGHT SETTLE RETREAT GAMEOVER
  teams: [],
  turnTeam: 1,
  active: null,
  wind: 0,
  timeLeft: TURN_TIME,
  retreatLeft: 0,
  weaponIdx: 0,
  charging: false,
  charge: 0,
  hasFired: false,
  shotsLeft: 0,
  projectiles: [],
  particles: [],
  texts: [],
  tracers: [],
  clouds: [],
  shake: 0,
  time: 0,
  cam: { x: 0, y: 0, tx: 0, ty: 0 }
};

const keys = Object.create(null);
const mouse = { x: 0, y: 0, inside: false, moved: false };

/* --------------------------------------------------------------------- dom */

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const dom = {
  hud: document.getElementById('hud'),
  clock: document.getElementById('clock'),
  activeWorm: document.getElementById('active-worm'),
  windFill: document.getElementById('wind-fill'),
  windValue: document.getElementById('wind-value'),
  dock: document.getElementById('dock'),
  banner: document.getElementById('banner'),
  bannerText: document.querySelector('#banner span'),
  hint: document.getElementById('hint'),
  overlay: document.getElementById('overlay'),
  result: document.getElementById('result'),
  resultTitle: document.getElementById('result-title'),
  resultSub: document.getElementById('result-sub'),
  startBtn: document.getElementById('start-btn'),
  rematchBtn: document.getElementById('rematch-btn'),
  cards: [document.getElementById('team-0'), document.getElementById('team-1')]
};

const view = { w: 800, h: 600, dpr: 1 };

function resize() {
  const rect = canvas.getBoundingClientRect();
  view.w = Math.max(1, Math.round(rect.width));
  view.h = Math.max(1, Math.round(rect.height));
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(view.w * view.dpr));
  canvas.height = Math.max(1, Math.round(view.h * view.dpr));
}

function setText(el, value) {
  const s = String(value);
  if (el.textContent !== s) el.textContent = s;
}

/* --------------------------------------------------------------------- worm */

const WORM_HULL = [
  [0, -WORM_RY], [0, WORM_RY], [-WORM_RX, 0], [WORM_RX, 0],
  [-4, -6], [4, -6], [-4, 6], [4, 6], [0, 0]
];

function wormHits(x, y) {
  for (let i = 0; i < WORM_HULL.length; i++) {
    if (terrain.solid(x + WORM_HULL[i][0], y + WORM_HULL[i][1])) return true;
  }
  return false;
}

function grounded(w) {
  return terrain.solid(w.x, w.y + WORM_RY + 1) ||
         terrain.solid(w.x - 3, w.y + WORM_RY + 1) ||
         terrain.solid(w.x + 3, w.y + WORM_RY + 1);
}

function makeWorm(name, team) {
  return {
    name, team,
    x: 0, y: 0, vx: 0, vy: 0,
    health: 100, dead: false, dying: null,
    airborne: false, peakY: 0,
    facing: 1, aim: 0.45,
    stepPhase: 0, flash: 0
  };
}

/** Probe 0, -1..-MAX_CLIMB, +1..+MAX_CLIMB for a free slot: slope climbing. */
function tryWalk(w, dir) {
  const nx = w.x + dir * WALK_SPEED;
  const order = [0];
  for (let i = 1; i <= MAX_CLIMB; i++) order.push(-i);
  for (let i = 1; i <= MAX_CLIMB; i++) order.push(i);
  for (let i = 0; i < order.length; i++) {
    const ny = w.y + order[i];
    if (!wormHits(nx, ny)) { w.x = nx; w.y = ny; return true; }
  }
  return false;
}

function stepWorm(w) {
  if (w.dead) return;
  if (w.flash > 0) w.flash -= STEP;

  if (w.dying !== null) {
    w.dying -= STEP;
    if (w.dying <= 0) detonateWorm(w);
    return;
  }

  if (w.airborne) {
    w.vy += GRAVITY;
    w.vx *= 0.995;
    const speed = Math.max(Math.abs(w.vx), Math.abs(w.vy));
    const n = Math.max(1, Math.ceil(speed / 2));
    for (let i = 0; i < n; i++) {
      const sx = w.vx / n, sy = w.vy / n;
      if (!wormHits(w.x + sx, w.y)) w.x += sx;
      else w.vx *= -0.25;
      if (!wormHits(w.x, w.y + sy)) {
        w.y += sy;
        if (w.y < w.peakY) w.peakY = w.y;
      } else {
        if (sy > 0) { land(w); break; }
        w.vy = 0;
      }
    }
    if (w.y - WORM_RY > WATER_Y) { drown(w); return; }
    if (w.y > WORLD_H + 200) { drown(w); return; }
  } else {
    // resting: the sea may still have risen to meet it (submerged pockets)
    if (w.y - WORM_RY > WATER_Y) { drown(w); return; }
    if (!grounded(w)) {
      w.airborne = true;
      w.peakY = w.y;
      w.vy = 0.4;
    }
  }
}

function land(w) {
  const fall = w.y - w.peakY;
  w.airborne = false;
  w.vx = 0; w.vy = 0;
  if (fall > FALL_SAFE) {
    const dmg = Math.min(35, Math.round((fall - FALL_SAFE) / 5));
    if (dmg > 0) {
      damageWorm(w, dmg);
      puff(w.x, w.y + WORM_RY, 8, '#b9a06a');
    }
  }
}

function drown(w) {
  if (w.dead) return;
  w.dead = true;
  w.dying = null;
  w.health = 0;
  splash(w.x, WATER_Y);
  addText(w.x, WATER_Y - 26, 'GLUB!', '#9fe8ff');
  Audio.splash();
}

function damageWorm(w, amount) {
  if (w.dead || w.dying !== null) return;
  amount = Math.round(amount);
  if (amount <= 0) return;
  w.health = Math.max(0, w.health - amount);
  w.flash = 0.25;
  addText(w.x, w.y - 20, '-' + amount, '#ffd166');
  if (w.health === 0) w.dying = 0.55;
}

function detonateWorm(w) {
  w.dead = true;
  w.dying = null;
  addText(w.x, w.y - 26, 'BYE!', '#ff8b7a');
  explode(w.x, w.y, 45, 25);
}

/* -------------------------------------------------------------- explosions */

function explode(x, y, radius, damage) {
  terrain.carve(x, y, radius);

  for (let t = 0; t < game.teams.length; t++) {
    const worms = game.teams[t].worms;
    for (let i = 0; i < worms.length; i++) {
      const w = worms[i];
      if (w.dead) continue;
      const dx = w.x - x, dy = w.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + WORM_RY) continue;
      const falloff = clamp(1 - d / (radius + WORM_RY), 0, 1);
      damageWorm(w, damage * falloff);
      if (!w.dead) {
        const len = d || 1;
        const push = falloff * 9;
        w.airborne = true;
        w.peakY = w.y;
        w.vx += (dx / len) * push;
        w.vy += (dy / len) * push - falloff * 2.4;
      }
    }
  }

  // visuals
  const count = Math.round(radius * 0.75);
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU), sp = rand(1, 7) * (radius / 55);
    game.particles.push({
      type: i % 3 === 0 ? 'spark' : 'debris',
      x: x + Math.cos(a) * rand(0, radius * 0.5),
      y: y + Math.sin(a) * rand(0, radius * 0.5),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
      life: rand(0.5, 1.5), max: 1.5,
      size: rand(1.5, 4),
      color: i % 3 === 0 ? '#ffd166' : pick(['#8a5a33', '#6f4626', '#4e9c36', '#a9793f'])
    });
  }
  for (let i = 0; i < 16; i++) {
    game.particles.push({
      type: 'smoke',
      x: x + rand(-radius * 0.4, radius * 0.4),
      y: y + rand(-radius * 0.4, radius * 0.4),
      vx: rand(-0.6, 0.6), vy: rand(-1.4, -0.4),
      life: rand(0.8, 1.8), max: 1.8,
      size: rand(radius * 0.2, radius * 0.45),
      color: '#2b2b2b'
    });
  }
  game.particles.push({
    type: 'flash', x, y, vx: 0, vy: 0,
    life: 0.22, max: 0.22, size: radius * 1.15, color: '#fff3c4'
  });

  game.shake = Math.min(26, game.shake + radius * 0.28);
  Audio.boom(radius / 58);
}

function splash(x, y) {
  for (let i = 0; i < 26; i++) {
    const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
    const sp = rand(1.5, 5.5);
    game.particles.push({
      type: 'water', x: x + rand(-8, 8), y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.5, 1.1), max: 1.1, size: rand(1.5, 3.5),
      color: '#8fd8ff'
    });
  }
  Audio.splash();
}

function puff(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    game.particles.push({
      type: 'smoke', x: x + rand(-6, 6), y: y + rand(-3, 3),
      vx: rand(-0.5, 0.5), vy: rand(-0.8, -0.2),
      life: rand(0.3, 0.7), max: 0.7, size: rand(4, 10), color: color || '#7d6a4f'
    });
  }
}

function addText(x, y, text, color) {
  game.texts.push({ x, y, text, color, life: 1.2, max: 1.2 });
}

/* -------------------------------------------------------------- projectiles */

function spawnProjectile(def, x, y, vx, vy, owner) {
  game.projectiles.push({
    def, x, y, vx, vy, owner,
    fuse: def.fuse === null || def.fuse === undefined ? null : def.fuse,
    bounce: def.bounce || 0,
    life: 0, dead: false,
    trail: [],
    spin: 0
  });
}

function surfaceNormal(x, y) {
  let nx = 0, ny = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (terrain.solid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
    }
  }
  const len = Math.hypot(nx, ny);
  if (len < 0.0001) return { x: 0, y: -1 };
  return { x: nx / len, y: ny / len };
}

function wormAt(x, y, owner, life) {
  for (let t = 0; t < game.teams.length; t++) {
    const worms = game.teams[t].worms;
    for (let i = 0; i < worms.length; i++) {
      const w = worms[i];
      if (w.dead) continue;
      if (w === owner && life < 0.12) continue;
      if (Math.abs(x - w.x) < WORM_RX + 2 && Math.abs(y - w.y) < WORM_RY + 2) return w;
    }
  }
  return null;
}

function detonateProjectile(p) {
  if (p.dead) return;
  p.dead = true;
  const d = p.def;
  explode(p.x, p.y, d.radius, d.damage);
  if (d.cluster) {
    for (let i = 0; i < d.cluster; i++) {
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const sp = rand(3, 6.5);
      spawnProjectile(BOMBLET, p.x, p.y - 6, Math.cos(a) * sp + p.vx * 0.2,
                      Math.sin(a) * sp, p.owner);
    }
  }
}

function stepProjectile(p) {
  p.life += STEP;
  p.spin += 0.25;

  if (p.fuse !== null) {
    p.fuse -= STEP;
    if (p.fuse <= 0) { detonateProjectile(p); return; }
  }
  if (p.life > PROJ_MAX_LIFE) { detonateProjectile(p); return; }

  if (p.def.wind) p.vx += game.wind * WIND_ACC;
  p.vy += GRAVITY;

  const speed = Math.hypot(p.vx, p.vy);
  const n = Math.max(1, Math.ceil(speed / 2.5));
  for (let i = 0; i < n; i++) {
    const nx = p.x + p.vx / n, ny = p.y + p.vy / n;

    if (ny > WATER_Y) { splash(nx, WATER_Y); p.dead = true; return; }

    const hit = wormAt(nx, ny, p.owner, p.life);
    if (hit && p.bounce === 0) { p.x = nx; p.y = ny; detonateProjectile(p); return; }

    if (terrain.solid(nx, ny)) {
      if (p.bounce > 0) {
        const nrm = surfaceNormal(nx, ny);
        const dot = p.vx * nrm.x + p.vy * nrm.y;
        p.vx = (p.vx - 2 * dot * nrm.x) * p.bounce;
        p.vy = (p.vy - 2 * dot * nrm.y) * p.bounce;
        p.x += nrm.x * 1.5; p.y += nrm.y * 1.5;
        if (Math.abs(nrm.y) > 0.5) p.vx *= 0.72;               // rolling friction
        if (Math.hypot(p.vx, p.vy) < 0.5) { p.vx = 0; p.vy = 0; }
        else if (speed > 1.5) Audio.bounce();
        return;
      }
      p.x = nx; p.y = ny;
      detonateProjectile(p);
      return;
    }
    p.x = nx; p.y = ny;
  }

  if (p.x < -400 || p.x > WORLD_W + 400 || p.y > WORLD_H + 300) p.dead = true;

  p.trail.push({ x: p.x, y: p.y, life: 0.55 });
  if (p.trail.length > 44) p.trail.shift();
}

/* ------------------------------------------------------------------ weapons */

function currentWeapon() { return WEAPONS[game.weaponIdx]; }
function currentTeam() { return game.teams[game.turnTeam]; }

function ammoOf(team, def) {
  const a = team.ammo[def.id];
  return a === undefined ? 0 : a;
}

function selectWeapon(idx) {
  if (idx < 0 || idx >= WEAPONS.length) return;
  if (game.state !== 'AIM' && game.state !== 'TARGET') return;
  if (game.charging) return;
  if (game.shotsLeft > 0) { Audio.deny(); return; }   // finish the shotgun first
  const def = WEAPONS[idx];
  if (ammoOf(currentTeam(), def) <= 0) { Audio.deny(); return; }
  game.weaponIdx = idx;
  game.state = 'AIM';
  Audio.select();
  setHint(def.mode === 'strike' ? 'PRESS SPACE, THEN CLICK THE TARGET' : '');
  syncDock();
}

function consumeAmmo(def) {
  const team = currentTeam();
  if (team.ammo[def.id] !== Infinity) {
    team.ammo[def.id] = Math.max(0, team.ammo[def.id] - 1);
    syncDock();
  }
}

function muzzle(w, dist) {
  const dx = Math.cos(w.aim) * w.facing;
  const dy = -Math.sin(w.aim);
  return { x: w.x + dx * dist, y: w.y - 2 + dy * dist, dx, dy };
}

function releaseFire() {
  const w = game.active;
  if (!w || w.dead) { game.charging = false; game.charge = 0; return; }
  const power = clamp(game.charge / CHARGE_TIME, 0.06, 1);
  game.charging = false;
  game.charge = 0;
  const def = currentWeapon();

  if (def.mode === 'strike') {          // power is irrelevant; pick a target
    game.state = 'TARGET';
    setHint('CLICK TO CALL THE STRIKE');
    return;
  }

  game.hasFired = true;
  const speed = MIN_LAUNCH + power * (MAX_LAUNCH - MIN_LAUNCH);
  const m = muzzle(w, 15);

  if (def.mode === 'hitscan') {
    if (game.shotsLeft === 0) { consumeAmmo(def); game.shotsLeft = def.shots; }
    game.shotsLeft--;
    fireHitscan(w, m, def);
    game.state = 'SETTLE';
    return;
  }

  consumeAmmo(def);
  if (def.mode === 'drop') {
    spawnProjectile(def, w.x + w.facing * 8, w.y + 2, w.facing * 0.6, -1, w);
  } else {
    spawnProjectile(def, m.x, m.y, m.dx * speed, m.dy * speed, w);
    puff(m.x, m.y, 5, '#cfcfcf');
  }
  Audio.fire();
  game.state = 'FLIGHT';
}

function fireHitscan(w, m, def) {
  let x = m.x, y = m.y;
  let hx = x, hy = y;
  for (let i = 0; i < 400; i++) {
    x += m.dx * 3; y += m.dy * 3;
    hx = x; hy = y;
    if (x < -50 || x > WORLD_W + 50 || y > WATER_Y || y < -400) break;
    if (terrain.solid(x, y)) break;
    const hit = wormAt(x, y, w, 1);
    if (hit) break;
  }
  game.tracers.push({ x1: m.x, y1: m.y, x2: hx, y2: hy, life: 0.16, max: 0.16 });
  Audio.shot();
  if (hy <= WATER_Y) explode(hx, hy, def.radius, def.damage);
  else splash(hx, WATER_Y);
}

function callAirstrike(tx) {
  const def = WEAPONS.find(d => d.id === 'airstrike');
  consumeAmmo(def);
  game.hasFired = true;
  const dir = tx < WORLD_W / 2 ? 1 : -1;
  for (let i = 0; i < 5; i++) {
    const x = tx + (i - 2) * 34 * dir;
    spawnProjectile(def, x - dir * 240, -60 - i * 12, dir * 3.2, 1.5, game.active);
  }
  game.state = 'FLIGHT';
  setHint('');
  Audio.fire();
}

/* ------------------------------------------------------------- turn machine */

function canControl() {
  return (game.state === 'AIM' || game.state === 'RETREAT') &&
         game.active && !game.active.dead && game.active.dying === null;
}

function handleControl() {
  const w = game.active;
  if (!w) return;

  if (keys.ArrowLeft || keys.KeyA)  { walk(w, -1); }
  if (keys.ArrowRight || keys.KeyD) { walk(w, 1); }

  if (game.state === 'AIM' && !w.airborne) {
    const aimSpeed = 0.028;
    if (keys.ArrowUp || keys.KeyW)   w.aim = clamp(w.aim + aimSpeed, -1.48, 1.48);
    if (keys.ArrowDown || keys.KeyS) w.aim = clamp(w.aim - aimSpeed, -1.48, 1.48);
  }
}

function walk(w, dir) {
  if (w.airborne || w.dying !== null) return;
  w.facing = dir;
  if (tryWalk(w, dir)) {
    w.stepPhase += 0.22;
    if (w.stepPhase > 1) { w.stepPhase = 0; Audio.stepSfx(); }
  }
}

function jump() {
  const w = game.active;
  if (!canControl() || !w || w.airborne) return;
  w.airborne = true;
  w.peakY = w.y;
  w.vx = w.facing * 3.1;
  w.vy = -6.3;
  Audio.jump();
}

function isSettled() {
  if (game.projectiles.length > 0) return false;
  for (let t = 0; t < game.teams.length; t++) {
    const worms = game.teams[t].worms;
    for (let i = 0; i < worms.length; i++) {
      const w = worms[i];
      if (w.dead) continue;
      if (w.dying !== null || w.airborne) return false;
    }
  }
  return true;
}

function onTimeout() {
  if (game.charging) { releaseFire(); return; }
  if (game.state === 'TARGET') { setHint(''); }
  game.state = 'SETTLE';
}

function afterSettle() {
  if (checkGameOver()) return;
  const w = game.active;
  if (game.shotsLeft > 0 && w && !w.dead) {
    game.state = 'AIM';
    setHint('ONE SHOT LEFT');
    return;
  }
  if (game.hasFired && w && !w.dead) {
    game.state = 'RETREAT';
    game.retreatLeft = RETREAT_TIME;
    setHint('RETREAT!');
    return;
  }
  endTurn();
}

function endTurn() {
  setHint('');
  if (checkGameOver()) return;
  nextTurn();
}

function nextTurn() {
  game.turnTeam = 1 - game.turnTeam;
  const team = currentTeam();
  let chosen = null;
  for (let i = 1; i <= team.worms.length; i++) {
    const idx = (team.cursor + i) % team.worms.length;
    if (!team.worms[idx].dead) { team.cursor = idx; chosen = team.worms[idx]; break; }
  }
  if (!chosen) { checkGameOver(); return; }

  game.active = chosen;
  game.wind = rand(-1, 1);
  game.timeLeft = TURN_TIME;
  game.retreatLeft = 0;
  game.charging = false;
  game.charge = 0;
  game.hasFired = false;
  game.shotsLeft = 0;
  game.state = 'AIM';

  if (ammoOf(team, currentWeapon()) <= 0) game.weaponIdx = 0;

  dom.cards[0].classList.toggle('active', game.turnTeam === 0);
  dom.cards[1].classList.toggle('active', game.turnTeam === 1);
  showBanner(team.name + ' — ' + chosen.name, team.color);
  Audio.turn();
  syncDock();
  focusCamera(chosen.x, chosen.y, true);
}

function aliveCount(team) {
  let n = 0;
  for (let i = 0; i < team.worms.length; i++) if (!team.worms[i].dead) n++;
  return n;
}

function checkGameOver() {
  const a = aliveCount(game.teams[0]);
  const b = aliveCount(game.teams[1]);
  if (a > 0 && b > 0) return false;

  game.state = 'GAMEOVER';
  setHint('');
  let title, sub, color;
  if (a === 0 && b === 0) {
    title = 'MUTUAL DESTRUCTION';
    sub = 'Nobody walks away from this one.';
    color = '#ffd166';
  } else {
    const winner = a > 0 ? game.teams[0] : game.teams[1];
    title = winner.name + ' TEAM WINS';
    sub = aliveCount(winner) + ' worm' + (aliveCount(winner) === 1 ? '' : 's') + ' left standing.';
    color = winner.color;
  }
  dom.resultTitle.textContent = title;
  dom.resultTitle.style.setProperty('--wc', color);
  dom.resultSub.textContent = sub;
  dom.result.classList.add('show');
  Audio.win();
  return true;
}

/* ------------------------------------------------------------------- banner */

let hintText = '';
function setHint(text) {
  hintText = text;
  setText(dom.hint, text);
  dom.hint.classList.toggle('show', !!text);
}

function showBanner(text, color) {
  dom.bannerText.textContent = text;
  dom.banner.style.setProperty('--bc', color);
  dom.banner.classList.remove('show');
  void dom.banner.offsetWidth;   // restart the animation
  dom.banner.classList.add('show');
}

/* -------------------------------------------------------------- match setup */

function buildTeams() {
  const names = shuffled(NAME_POOL);
  game.teams = TEAM_DEFS.map((def, ti) => {
    const ammo = {};
    WEAPONS.forEach(wd => { ammo[wd.id] = wd.ammo; });
    const worms = [];
    for (let i = 0; i < WORMS_PER_TEAM; i++) {
      worms.push(makeWorm(names[ti * WORMS_PER_TEAM + i].toUpperCase(), ti));
    }
    return { name: def.name, color: def.color, dark: def.dark, worms, cursor: -1, ammo };
  });
}

function placeWorms() {
  const placed = [];
  const all = [];
  // interleave the teams so neither gets a whole side of the map
  for (let i = 0; i < WORMS_PER_TEAM; i++) {
    all.push(game.teams[0].worms[i]);
    all.push(game.teams[1].worms[i]);
  }
  for (let i = 0; i < all.length; i++) {
    let ok = false;
    for (let attempt = 0; attempt < 400 && !ok; attempt++) {
      const x = randInt(70, WORLD_W - 70);
      const sy = terrain.surfaceY(x);
      if (sy < 0 || sy > WATER_Y - 60) continue;
      const y = sy - WORM_RY - 1;
      if (y < 30) continue;
      if (wormHits(x, y)) continue;
      let clear = true;
      for (let j = 0; j < placed.length; j++) {
        if (Math.abs(placed[j].x - x) < 95) { clear = false; break; }
      }
      if (!clear) continue;
      all[i].x = x; all[i].y = y;
      placed.push(all[i]);
      ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

function startMatch() {
  for (let attempt = 0; attempt < 8; attempt++) {
    terrain.generate();
    buildTeams();
    if (placeWorms()) break;
  }

  game.projectiles.length = 0;
  game.particles.length = 0;
  game.texts.length = 0;
  game.tracers.length = 0;
  game.shake = 0;
  game.weaponIdx = 0;
  game.turnTeam = randInt(0, 1);

  game.clouds = [];
  for (let i = 0; i < 12; i++) {
    game.clouds.push({
      x: rand(-200, WORLD_W + 200), y: rand(30, 300),
      s: rand(0.5, 1.5), v: rand(0.08, 0.3)
    });
  }

  dom.cards.forEach((card, i) => {
    card.style.setProperty('--tc', game.teams[i].color);
    card.querySelector('.team-name').textContent = game.teams[i].name;
    const ul = card.querySelector('.team-worms');
    ul.innerHTML = '';
    game.teams[i].worms.forEach(w => {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><b></b>';
      ul.appendChild(li);
    });
  });

  buildDock();
  dom.result.classList.remove('show');
  dom.overlay.classList.remove('show');
  document.body.classList.add('playing');

  game.turnTeam = 1 - game.turnTeam;   // nextTurn flips it back
  nextTurn();
  const w = game.active;
  game.cam.x = clampCamX(w.x - view.w / 2);
  game.cam.y = clampCamY(w.y - view.h / 2);
}

/* ---------------------------------------------------------------- HUD sync */

function buildDock() {
  dom.dock.innerHTML = '';
  WEAPONS.forEach((def, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.idx = String(i);
    el.innerHTML =
      '<span class="key">' + def.key + '</span>' +
      '<span class="ammo"></span>' +
      '<span class="icon">' + def.icon + '</span>' +
      '<span class="name">' + def.name + '</span>';
    el.addEventListener('click', () => { Audio.init(); selectWeapon(i); });
    dom.dock.appendChild(el);
  });
  syncDock();
}

function syncDock() {
  if (!game.teams.length) return;
  const team = currentTeam();
  const slots = dom.dock.children;
  for (let i = 0; i < slots.length; i++) {
    const def = WEAPONS[i];
    const ammo = ammoOf(team, def);
    const el = slots[i];
    el.classList.toggle('selected', i === game.weaponIdx);
    el.classList.toggle('empty', ammo <= 0);
    setText(el.querySelector('.ammo'), ammo === Infinity ? '∞' : ammo);
  }
}

function syncHud() {
  if (!game.teams.length) return;

  const showRetreat = game.state === 'RETREAT';
  const t = showRetreat ? game.retreatLeft : game.timeLeft;
  setText(dom.clock, Math.max(0, Math.ceil(t)));
  dom.clock.classList.toggle('urgent', !showRetreat && t <= 10);
  dom.clock.classList.toggle('retreat', showRetreat);

  setText(dom.activeWorm, game.active ? game.active.name : '—');

  const wind = game.wind;
  const pct = Math.abs(wind) * 50;
  dom.windFill.style.width = pct + '%';
  dom.windFill.style.left = wind >= 0 ? '50%' : (50 - pct) + '%';
  setText(dom.windValue, (wind >= 0 ? '→' : '←') + Math.round(Math.abs(wind) * 10));

  for (let i = 0; i < game.teams.length; i++) {
    const team = game.teams[i];
    const card = dom.cards[i];
    let total = 0;
    team.worms.forEach(w => { total += w.health; });
    setText(card.querySelector('.team-total'), total);
    card.querySelector('.team-bar > i').style.width =
      (total / (WORMS_PER_TEAM * 100) * 100) + '%';
    const lis = card.querySelectorAll('.team-worms li');
    for (let j = 0; j < lis.length; j++) {
      const w = team.worms[j];
      const li = lis[j];
      setText(li.querySelector('span'), w.name);
      setText(li.querySelector('b'), w.dead ? '✝' : w.health);
      li.classList.toggle('dead', w.dead);
      li.classList.toggle('current', w === game.active && !w.dead);
    }
  }
}

/* ------------------------------------------------------------------- camera */

function clampCamX(x) {
  if (view.w >= WORLD_W) return (WORLD_W - view.w) / 2;
  return clamp(x, 0, WORLD_W - view.w);
}
function clampCamY(y) {
  if (view.h >= WORLD_H) return (WORLD_H - view.h) / 2;
  return clamp(y, 0, WORLD_H - view.h);
}

function focusCamera(x, y, snap) {
  game.cam.tx = clampCamX(x - view.w / 2);
  game.cam.ty = clampCamY(y - view.h / 2);
  if (snap) { game.cam.x = game.cam.tx; game.cam.y = game.cam.ty; }
}

function updateCamera() {
  let target = game.active;
  if (game.projectiles.length) target = game.projectiles[game.projectiles.length - 1];
  if (target) focusCamera(target.x, target.y, false);
  game.cam.x = lerp(game.cam.x, game.cam.tx, 0.09);
  game.cam.y = lerp(game.cam.y, game.cam.ty, 0.09);
  if (game.shake > 0) game.shake = Math.max(0, game.shake - 0.9);
}

function screenToWorld(sx, sy) {
  return { x: sx + game.cam.x, y: sy + game.cam.y };
}

/* -------------------------------------------------------------- simulation */

function fixedStep() {
  game.time += STEP;

  if (game.state === 'AIM' || game.state === 'TARGET') {
    game.timeLeft -= STEP;
    if (game.timeLeft <= 0) { game.timeLeft = 0; onTimeout(); }
  } else if (game.state === 'RETREAT') {
    game.retreatLeft -= STEP;
    if (game.retreatLeft <= 0) { endTurn(); }
  }

  if (canControl()) handleControl();

  if (game.charging && game.state === 'AIM') {
    game.charge += STEP;
    if (game.charge >= CHARGE_TIME) releaseFire();
  }

  // aim with the mouse while it is being moved
  if (game.state === 'AIM' && mouse.moved && mouse.inside && game.active && !game.active.airborne) {
    const w = screenToWorld(mouse.x, mouse.y);
    const dx = w.x - game.active.x, dy = w.y - game.active.y;
    if (Math.hypot(dx, dy) > 24) {
      game.active.facing = dx >= 0 ? 1 : -1;
      game.active.aim = clamp(Math.atan2(-dy, Math.abs(dx)), -1.48, 1.48);
    }
    mouse.moved = false;
  }

  for (let t = 0; t < game.teams.length; t++) {
    const worms = game.teams[t].worms;
    for (let i = 0; i < worms.length; i++) stepWorm(worms[i]);
  }

  for (let i = 0; i < game.projectiles.length; i++) stepProjectile(game.projectiles[i]);
  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    if (game.projectiles[i].dead) game.projectiles.splice(i, 1);
  }

  stepParticles();

  if (game.state === 'FLIGHT' && game.projectiles.length === 0) game.state = 'SETTLE';
  if (game.state === 'SETTLE' && isSettled()) afterSettle();
  if (game.state === 'RETREAT' && game.active && game.active.dead) endTurn();

  updateCamera();
}

function stepParticles() {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.life -= STEP;
    if (p.life <= 0) { game.particles.splice(i, 1); continue; }
    if (p.type === 'smoke') {
      p.x += p.vx; p.y += p.vy;
      p.vy *= 0.985; p.vx *= 0.99;
      p.size += 0.35;
    } else if (p.type === 'flash') {
      p.size *= 1.03;
    } else {
      p.vy += GRAVITY * 0.75;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.995;
      if (p.type !== 'water' && terrain.solid(p.x, p.y)) {
        p.vy *= -0.32; p.vx *= 0.5;
        p.y -= 2;
        if (Math.abs(p.vy) < 0.5) p.life = Math.min(p.life, 0.15);
      }
      if (p.y > WATER_Y) p.life = Math.min(p.life, 0.08);
    }
  }
  for (let i = game.texts.length - 1; i >= 0; i--) {
    const t = game.texts[i];
    t.life -= STEP;
    t.y -= 0.42;
    if (t.life <= 0) game.texts.splice(i, 1);
  }
  for (let i = game.tracers.length - 1; i >= 0; i--) {
    game.tracers[i].life -= STEP;
    if (game.tracers[i].life <= 0) game.tracers.splice(i, 1);
  }
  for (let i = 0; i < game.clouds.length; i++) {
    const c = game.clouds[i];
    c.x += c.v;
    if (c.x > WORLD_W + 260) c.x = -260;
  }
}

/* ---------------------------------------------------------------- rendering */

function render() {
  const shakeX = game.shake ? rand(-game.shake, game.shake) * 0.4 : 0;
  const shakeY = game.shake ? rand(-game.shake, game.shake) * 0.4 : 0;
  const camX = game.cam.x + shakeX;
  const camY = game.cam.y + shakeY;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);

  drawSky();
  drawParallax(camX, camY);

  ctx.save();
  ctx.translate(-camX, -camY);

  if (terrain.canvas) ctx.drawImage(terrain.canvas, 0, 0);

  drawTracers();
  drawProjectiles();
  drawWorms();
  drawParticles();
  drawAim();
  drawWater();
  drawTexts();

  ctx.restore();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, view.h);
  g.addColorStop(0, '#123a5e');
  g.addColorStop(0.45, '#3a7ba8');
  g.addColorStop(0.82, '#8cc0d6');
  g.addColorStop(1, '#cfe4ea');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

function drawParallax(camX, camY) {
  // clouds
  ctx.save();
  ctx.translate(-camX * 0.25, -camY * 0.25);
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  for (let i = 0; i < game.clouds.length; i++) {
    const c = game.clouds[i];
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 60 * c.s, 18 * c.s, 0, 0, TAU);
    ctx.ellipse(c.x + 34 * c.s, c.y - 8 * c.s, 40 * c.s, 15 * c.s, 0, 0, TAU);
    ctx.ellipse(c.x - 38 * c.s, c.y + 4 * c.s, 34 * c.s, 12 * c.s, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // two hill layers
  const layers = [
    { off: 0.32, base: 700, amp: 66, len: 620, color: 'rgba(96,140,158,0.45)' },
    { off: 0.5,  base: 772, amp: 44, len: 380, color: 'rgba(64,104,124,0.6)' }
  ];
  for (let l = 0; l < layers.length; l++) {
    const L = layers[l];
    ctx.save();
    ctx.translate(-camX * L.off, -camY * L.off);
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.moveTo(-300, WORLD_H + 200);
    for (let x = -300; x <= WORLD_W + 300; x += 24) {
      const y = L.base + Math.sin(x / L.len * TAU) * L.amp + Math.sin(x / (L.len * 0.37)) * L.amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WORLD_W + 300, WORLD_H + 200);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawWater() {
  const g = ctx.createLinearGradient(0, WATER_Y, 0, WORLD_H);
  g.addColorStop(0, 'rgba(46,138,196,0.68)');
  g.addColorStop(1, 'rgba(10,48,92,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(-400, WATER_Y, WORLD_W + 800, WORLD_H - WATER_Y + 200);

  ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = 'rgba(190,235,255,' + (0.30 - k * 0.08) + ')';
    ctx.beginPath();
    for (let x = -400; x <= WORLD_W + 400; x += 12) {
      const y = WATER_Y + 3 + k * 7 +
        Math.sin(x * 0.014 + game.time * (1.6 + k * 0.5)) * (4 - k) +
        Math.sin(x * 0.005 - game.time * 0.8) * 3;
      if (x === -400) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawWorms() {
  for (let t = 0; t < game.teams.length; t++) {
    const team = game.teams[t];
    for (let i = 0; i < team.worms.length; i++) {
      const w = team.worms[i];
      if (w.dead) continue;
      drawWorm(w, team);
    }
  }
}

function drawWorm(w, team) {
  const isActive = w === game.active;
  ctx.save();
  ctx.translate(w.x, w.y);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, WORM_RY + 2, WORM_RX + 1, 2.6, 0, 0, TAU);
  ctx.fill();

  // body
  const grd = ctx.createLinearGradient(-WORM_RX, -WORM_RY, WORM_RX, WORM_RY);
  const hurt = w.flash > 0 && Math.floor(w.flash * 20) % 2 === 0;
  grd.addColorStop(0, hurt ? '#ffffff' : '#f2d6a8');
  grd.addColorStop(1, hurt ? '#ffd6c8' : '#d9ab74');
  ctx.fillStyle = grd;
  ctx.strokeStyle = 'rgba(60,38,20,0.75)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, WORM_RX, WORM_RY, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // team band
  ctx.fillStyle = team.color;
  ctx.beginPath();
  ctx.ellipse(0, -WORM_RY + 3.5, WORM_RX * 0.86, 2.6, 0, 0, TAU);
  ctx.fill();

  // eyes, tracking the aim direction
  const lookX = Math.cos(w.aim) * w.facing * 1.7;
  const lookY = -Math.sin(w.aim) * 1.7;
  for (let s = -1; s <= 1; s += 2) {
    const ex = 2.1 * s * (w.facing > 0 ? 1 : -1) + w.facing * 1.2;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, -3.4, 2.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(ex + lookX * 0.5, -3.4 + lookY * 0.5, 1.05, 0, TAU); ctx.fill();
  }

  // mouth
  ctx.strokeStyle = 'rgba(70,40,22,0.8)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(w.facing * 1.4, 1.2, 2.1, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.restore();

  // name plate + health
  const barW = 34;
  const y = w.y - WORM_RY - 20;
  ctx.font = '600 10px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(w.x - barW / 2 - 1, y - 11, barW + 2, 10);
  ctx.fillStyle = team.color;
  ctx.fillText(w.name, w.x, y - 3);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(w.x - barW / 2, y + 1, barW, 4);
  ctx.fillStyle = w.health > 50 ? '#7ee0a1' : w.health > 25 ? '#ffd166' : '#ff6b5a';
  ctx.fillRect(w.x - barW / 2, y + 1, barW * (w.health / 100), 4);

  if (isActive && (game.state === 'AIM' || game.state === 'RETREAT' || game.state === 'TARGET')) {
    const bob = Math.sin(game.time * 5) * 3;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(w.x, y - 15 + bob);
    ctx.lineTo(w.x - 6, y - 24 + bob);
    ctx.lineTo(w.x + 6, y - 24 + bob);
    ctx.closePath();
    ctx.fill();
  }
}

function drawAim() {
  const w = game.active;
  if (!w || w.dead) return;
  if (game.state !== 'AIM' && game.state !== 'TARGET') return;

  const dx = Math.cos(w.aim) * w.facing, dy = -Math.sin(w.aim);

  if (game.state === 'AIM') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let d = 26; d <= 40; d += 7) {
      ctx.beginPath();
      ctx.arc(w.x + dx * d, w.y - 2 + dy * d, 1.4, 0, TAU);
      ctx.fill();
    }
    const cx = w.x + dx * 52, cy = w.y - 2 + dy * 52;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy); ctx.lineTo(cx - 3, cy);
    ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy - 3);
    ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 9);
    ctx.stroke();
    ctx.restore();
  }

  if (game.charging) {
    const p = clamp(game.charge / CHARGE_TIME, 0, 1);
    const bw = 46, bx = w.x - bw / 2, by = w.y + WORM_RY + 7;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#7ee0a1');
    g.addColorStop(0.55, '#ffd166');
    g.addColorStop(1, '#ff5f4d');
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw * p, 5);
  }

  if (game.state === 'TARGET' && mouse.inside) {
    const m = screenToWorld(mouse.x, mouse.y);
    ctx.save();
    ctx.strokeStyle = '#ff5f4d';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(m.x, m.y, 16, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(m.x - 24, m.y); ctx.lineTo(m.x + 24, m.y);
    ctx.moveTo(m.x, m.y - 24); ctx.lineTo(m.x, m.y + 24);
    ctx.stroke();
    ctx.restore();
  }
}

function drawProjectiles() {
  for (let i = 0; i < game.projectiles.length; i++) {
    const p = game.projectiles[i];
    const def = p.def;

    // smoke trail
    for (let j = 0; j < p.trail.length; j++) {
      const t = p.trail[j];
      const a = (j / p.trail.length) * 0.35;
      ctx.fillStyle = 'rgba(220,220,220,' + a + ')';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 1 + (j / p.trail.length) * 3, 0, TAU);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    const ang = def.bounce ? p.spin : Math.atan2(p.vy, p.vx);
    ctx.rotate(ang);
    ctx.fillStyle = def.color || '#ddd';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    if (def.id === 'bazooka' || def.id === 'airstrike') {
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-4, -3.2); ctx.lineTo(-6, 0); ctx.lineTo(-4, 3.2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff5f4d';
      ctx.fillRect(-6, -1.4, 2.4, 2.8);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, def.r || 4, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#f7d97a';
      ctx.beginPath();
      ctx.moveTo(0, -(def.r || 4));
      ctx.lineTo(2.5, -(def.r || 4) - 3.5);
      ctx.stroke();
      // fuse spark
      if (p.fuse !== null) {
        ctx.fillStyle = Math.floor(game.time * 14) % 2 ? '#fff2a8' : '#ff9d4d';
        ctx.beginPath(); ctx.arc(2.8, -(def.r || 4) - 4, 1.5, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawTracers() {
  for (let i = 0; i < game.tracers.length; i++) {
    const t = game.tracers[i];
    const a = t.life / t.max;
    ctx.strokeStyle = 'rgba(255,240,180,' + a + ')';
    ctx.lineWidth = 1 + a * 2;
    ctx.beginPath();
    ctx.moveTo(t.x1, t.y1);
    ctx.lineTo(t.x2, t.y2);
    ctx.stroke();
  }
}

function drawParticles() {
  for (let i = 0; i < game.particles.length; i++) {
    const p = game.particles[i];
    const a = clamp(p.life / p.max, 0, 1);
    if (p.type === 'smoke') {
      ctx.fillStyle = 'rgba(58,52,48,' + (a * 0.42) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    } else if (p.type === 'flash') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, 'rgba(255,255,220,' + a + ')');
      g.addColorStop(0.4, 'rgba(255,180,60,' + (a * 0.7) + ')');
      g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    } else if (p.type === 'water') {
      ctx.fillStyle = 'rgba(143,216,255,' + a + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    } else if (p.type === 'spark') {
      ctx.fillStyle = 'rgba(255,209,102,' + a + ')';
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.globalAlpha = 1;
    }
  }
}

function drawTexts() {
  ctx.textAlign = 'center';
  ctx.font = '700 15px Trebuchet MS, sans-serif';
  for (let i = 0; i < game.texts.length; i++) {
    const t = game.texts[i];
    const a = clamp(t.life / t.max, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,' + (a * 0.6) + ')';
    ctx.fillText(t.text, t.x + 1, t.y + 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------- main loop */

let last = 0, acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;                 // backgrounded tab guard

  if (game.state !== 'TITLE') {
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 8) { fixedStep(); acc -= STEP; }
    syncHud();
  } else {
    game.time += dt;
  }
  render();
}

/* -------------------------------------------------------------------- input */

function onKeyDown(e) {
  if (e.repeat) {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    return;
  }
  if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Enter') e.preventDefault();
  keys[e.code] = true;
  Audio.init();

  if (game.state === 'TITLE') {
    if (e.code === 'Space' || e.code === 'Enter') startMatch();
    return;
  }
  if (game.state === 'GAMEOVER') {
    if (e.code === 'Space' || e.code === 'Enter') startMatch();
    return;
  }

  if (e.code === 'KeyM') {
    Audio.muted = !Audio.muted;
    showBanner(Audio.muted ? 'SOUND OFF' : 'SOUND ON', '#ffd166');
    return;
  }
  if (e.code === 'Enter') { jump(); return; }
  if (e.code === 'KeyN' && (game.state === 'AIM' || game.state === 'RETREAT')) {
    game.charging = false;
    game.charge = 0;
    endTurn();
    return;
  }

  const num = WEAPONS.findIndex(d => d.key === e.key);
  if (num >= 0) { selectWeapon(num); return; }

  if (e.code === 'Space' && game.state === 'AIM' && canControl() && !game.active.airborne) {
    game.charging = true;
    game.charge = 0;
  }
}

function onKeyUp(e) {
  keys[e.code] = false;
  if (e.code === 'Space' && game.charging) releaseFire();
}

function onMouseMove(e) {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  mouse.inside = true;
  mouse.moved = true;
}

function onMouseDown(e) {
  Audio.init();
  if (e.button !== 0) return;
  if (game.state === 'TARGET') {
    const w = screenToWorld(mouse.x, mouse.y);
    callAirstrike(clamp(w.x, 60, WORLD_W - 60));
    return;
  }
  if (game.state === 'AIM' && canControl() && !game.active.airborne) {
    game.charging = true;
    game.charge = 0;
  }
}

function onMouseUp() {
  if (game.charging) releaseFire();
}

/* --------------------------------------------------------------------- boot */

window.addEventListener('resize', resize);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });
canvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('contextmenu', e => e.preventDefault());

dom.startBtn.addEventListener('click', () => { dom.startBtn.blur(); Audio.init(); startMatch(); });
dom.rematchBtn.addEventListener('click', () => { dom.rematchBtn.blur(); Audio.init(); startMatch(); });

resize();
// A quiet title-screen battlefield to look at behind the menu.
terrain.generate();
game.clouds = [];
for (let i = 0; i < 12; i++) {
  game.clouds.push({ x: rand(-200, WORLD_W + 200), y: rand(30, 300), s: rand(0.5, 1.5), v: rand(0.08, 0.3) });
}
game.cam.x = clampCamX(WORLD_W / 2 - view.w / 2);
game.cam.y = clampCamY(WORLD_H * 0.45 - view.h / 2);
requestAnimationFrame(frame);

// Exposed for the Playwright smoke test.
window.__worms = {
  game, terrain, startMatch, WEAPONS,
  /** Place a projectile directly, bypassing aim and power. Test hook. */
  spawn(id, x, y, vx, vy, fuse) {
    const def = WEAPONS.find(d => d.id === id) || BOMBLET;
    spawnProjectile(def, x, y, vx || 0, vy || 0, game.active);
    const p = game.projectiles[game.projectiles.length - 1];
    if (fuse !== undefined) p.fuse = fuse;
    return p;
  }
};

})();
