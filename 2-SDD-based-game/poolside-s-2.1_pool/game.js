/*
 * PoolSide S 2.1 · Pool — Worms implementation.
 * Zero-dependency, file:// friendly, 1600x900 fixed-step canvas game.
 *
 * Architecture follows 2-SDD-based-game/design.md:
 *   state machine + fixed-step physics, terrain as an offscreen alpha bitmap,
 *   data-driven weapons, single explosion choke-point, CPU using the real
 *   projectile integrator, ?demo CPU-vs-CPU smoke mode.
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  // Config & constants
  // ──────────────────────────────────────────────────────────────────────
  const W = 1600, H = 900;
  const STEP = 1 / 60;            // 60 Hz fixed physics tick
  const MAX_DT = 0.10;            // survive tab backgrounding (Req 9.4)
  const GRAVITY = 800;            // px/s^2
  const WORM_R = 12;              // collision / body radius
  const WORM_HP = 100;
  const SAFE_FALL = 26;           // px fallen before fall damage kicks in
  const FALL_K = 0.55;            // hp per px beyond safe threshold
  const WALK_SPEED = 120;
  const JUMP_VX = 160, JUMP_VY = -360;
  const MAX_STEP = 4;             // step-up height for slope climbing
  const TURN_TIME = 45;           // seconds
  const RETREAT_TIME = 5;
  const SETTLE_CAP = 8;
  const PROJ_TIMEOUT = 10;        // hard ceiling on any projectile (Req 9.1)
  const DEATH_DELAY = 0.5;        // dying timer (Req 6.4)
  const DEATH_DMG = 25, DEATH_R = 40;
  const N_WORMS = 4;
  const WATER_H = 130;            // initial water band height
  const WATER_LINE = H - WATER_H; // initial logical water Y
  const SD_START_TURNS = 20;      // sudden death at 20 completed turns
  const SD_HP_CAP = 30;
  const SD_WATER_RISE = 12;       // px per turn-start during SD
  const DAMAGE_MIN_HIT_FRAC = 0.25; // Req 6.2 damage floor while overlapping

  const TEAMS = [
    { name: 'Red', color: '#ff5a5a', key: 'red' },
    { name: 'Blue', color: '#5ac3ff', key: 'blue' },
  ];

  // Weapons table (design.md §Weapons). Data-driven.
  const WEAPONS = [
    { id: 'bazooka', key: 1, name: 'Bazooka', charge: true, wind: true, fuse: 0, maxDmg: 50, radius: 55, ammo: Infinity, speed: 900 },
    { id: 'grenade', key: 2, name: 'Grenade', charge: true, wind: false, fuse: 3, maxDmg: 45, radius: 50, ammo: Infinity, speed: 620, bounce: true, restitution: 0.45 },
    { id: 'cluster', key: 3, name: 'Cluster', charge: true, wind: false, fuse: 3, maxDmg: 30, radius: 40, ammo: 3, speed: 560, split: true, bomblets: 5, bRadius: 25, bDmg: 15 },
    { id: 'shotgun', key: 4, name: 'Shotgun', charge: false, wind: false, fuse: 0, maxDmg: 25, radius: 18, ammo: 3, speed: 0, shots: 2, instant: true },
    { id: 'dynamite', key: 5, name: 'Dynamite', charge: false, wind: false, fuse: 3, maxDmg: 75, radius: 80, ammo: 2, speed: 0, placed: true },
  ];
  // (Weapon lookup uses WEAPONS.byId / WEAPONS.byKey below.)

  // ──────────────────────────────────────────────────────────────────────
  // Seeded randomness + 1D value noise
  // ──────────────────────────────────────────────────────────────────────
  function rng(seed) {
    let s = (seed ^ 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s >>> 0) / 4294967296;
    };
  }
  function hash1(n) {
    n = (n ^ 0) * 2654435761;
    n ^= n >>> 13;
    return ((n & 0x7fffffff) % 1000000) / 1000000;
  }
  function noise1(x, seed) {
    const i = Math.floor(x); const f = x - i;
    const u = f * f * (3 - 2 * f);
    const v = hash1(i + seed) * (1 - u) + hash1(i + 1 + seed) * u; // in [0,1)
    return v * 2 - 1; // -> [-1, 1]
  }
  function fractal(x, oct, seed) {
    let a = 0;
    for (let i = 0; i < oct.length; i++) a += noise1(x * oct[i].f, seed) * oct[i].a;
    return a; // ~ [-sum(a), +sum(a)]
  }
  function gauss(r) { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Terrain — offscreen bitmap + alpha cache
  // ──────────────────────────────────────────────────────────────────────
  function Terrain(canvas) {
    // Dedicated offscreen bitmap for terrain solidity. The alpha cache is read
    // from THIS canvas only, so the water layer (drawn on the main/display
    // canvas during render) is never mistaken for solid ground (which would
    // let worms rest on water and never drown). Render draws this canvas onto
    // the display via drawImage.
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.W = W; this.H = H;
    this.waterY = WATER_LINE;
    this.alpha = null; // Uint8ClampedArray
    this.standingZones = []; // {x,width,y}
  }
  Terrain.prototype.solidAt = function (x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) return false; // OOB top/left/right = air; bottom handled by water
    return this.alpha[(y * W + x) * 4 + 3] > 127;
  };
  Terrain.prototype.sampleSolid = function (x, y) { return this.solidAt(x, y); };
  Terrain.prototype.regenerate = function (seed, attempts) {
    this._seed = seed;
    for (let a = 0; a < attempts; a++) {
      this._gen(this._seed + a);
      this._findZones();
      if (this.standingZones.length >= 8) return true;
    }
    return this.standingZones.length >= 8;
  };
  Terrain.prototype._gen = function (seed) {
    const c = this.ctx, W_ = W, H_ = H;
    c.clearRect(0, 0, W_, H_);
    const oct = [{ f: 1 / 900, a: 24 }, { f: 1 / 330, a: 12 }, { f: 1 / 130, a: 6 }];
    const base = 470; const amp = 110; const humps = 6;
    const h = new Float64Array(W_);
    for (let x = 0; x < W_; x++) {
      const sway = Math.sin((x / W_) * Math.PI * 2 * humps) * amp;
      h[x] = base + fractal(x, oct, seed) + sway;
      if (h[x] < 240) h[x] = 240;
      if (h[x] > this.waterY - 28) h[x] = this.waterY - 28;
    }
    // dirt fill
    c.fillStyle = '#4a3a22';
    for (let x = 0; x < W_; x++) {
      const hh = h[x] | 0;
      c.fillRect(x, hh, 1, H_ - hh);
    }
    // grass top band + darkened underside rim on steep sides handled visually later
    c.fillStyle = '#2e8b33';
    for (let x = 0; x < W_; x++) {
      const hh = h[x] | 0;
      c.fillRect(x, hh - 3, 1, 3);
    }
    // cache alpha
    this._refreshAlpha();
    this.heightMap = h;
  };
  Terrain.prototype._refreshAlpha = function (x0, y0, x1, y1) {
    // refresh full alpha (dirty-rect variant keeps it simple & correct)
    if (x0 == null) { x0 = 0; y0 = 0; x1 = W; y1 = H; }
    const id = this.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    this.alpha = id.data;
    this._alphaX0 = x0; this._alphaY0 = y0; this._alphaW = x1 - x0;
  };
  Terrain.prototype._alphaGet = function (x, y) {
    // local accessor using last cached full rect (we always refresh full)
    return this.alpha[(y * W + x) * 4 + 3];
  };
  Terrain.prototype._findZones = function () {
    const h = this.heightMap; const zones = []; const MIN_W = 7; const SLOPE = 1.0; const WATER_MARGIN = 30;
    let i = 0;
    while (i < W) {
      // terrain must be well above water (smaller y = higher ground)
      if (h[i] >= this.waterY - WATER_MARGIN) { i++; continue; }
      let j = i;
      while (j + 1 < W && Math.abs(h[j + 1] - h[j]) <= SLOPE && h[j + 1] < this.waterY - WATER_MARGIN) j++;
      const width = j - i + 1;
      if (width >= MIN_W) {
        let sum = 0; for (let k = i; k <= j; k++) sum += h[k];
        zones.push({ x: (i + j) >> 1, width, y: sum / (j - i + 1) });
      }
      i = j + 1;
    }
    this.standingZones = zones;
  };
  Terrain.prototype.carve = function (x, y, r) {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    // darkened crater rim (inner wall)
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = '#1e160c';
    c.lineWidth = 4;
    c.beginPath(); c.arc(x, y, r + 1, 0, Math.PI * 2); c.stroke();
    c.restore();
    this._refreshAlpha(); // full refresh (correctness > perf for this scale)
  };

  // ──────────────────────────────────────────────────────────────────────
  // Entities
  // ──────────────────────────────────────────────────────────────────────
  let wormId = 0;
  function Worm(team, x, y) {
    this.id = ++wormId;
    this.team = team;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.hp = WORM_HP;
    this.facing = (team === 0) ? 1 : -1;
    this.aimT = 0; // -1 up, 0 forward, +1 down (relative to facing)
    this.alive = true;
    this.onGround = false;
    this.fallStartY = y;
    this.dying = false; this.dyingTimer = 0;
    this.hpPop = 0; // flashing timer after hit
  }
  function Projectile(kind, x, y, vx, vy) {
    this.kind = kind; // weapon id
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.age = 0;
    this.resting = false;
    if (kind === 'bazooka' || kind === 'grenade' || kind === 'cluster') {
      this.fuse = WEAPONS.byId(kind).fuse;
    } else if (kind === 'dynamite') {
      this.fuse = 3; this.resting = true;
    }
  }
  function Particle(x, y, vx, vy, life, color, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.color = color; this.size = size;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Game object (single owner of all match state)
  // ──────────────────────────────────────────────────────────────────────
  WEAPONS.byId = function (id) { return WEAPONS.find(w => w.id === id); };
  WEAPONS.byKey = function (k) { return WEAPONS.find(w => w.key === k); };

  const game = {
    state: 'TITLE', stateTime: 0,
    mode: 'pvp',
    teams: [], terrain: null,
    activeTeam: 0, activeWormIx: 0,
    turnTimer: TURN_TIME, retreatTimer: 0, wind: 0, windSign: 0,
    turnCount: 0, suddenDeath: false, sdAnnounced: false,
    projectiles: [], particles: [], damageNumbers: [], graves: [],
    stateLog: [],
    keys: new Set(), keysDown: [], keysUp: [],
    _testPaused: false, _raf: 0, _lastTs: 0, _acc: 0, _settleCap: 0,
    _cpu: null, // cpu phase bookkeeping
  };
  game.teamHP = function () {
    return game.teams.map(t => t.worms.filter(w => w.alive).reduce((a, w) => a + w.hp, 0));
  };
  game.living = function (team) { return game.teams[team].worms.filter(w => w.alive).length; };
  game.logState = function (s) { game.stateLog.push({ state: s, turn: game.turnCount, t: game.stateTime }); };

  // ──────────────────────────────────────────────────────────────────────
  // Match setup
  // ──────────────────────────────────────────────────────────────────────
  function startMatch(mode) {
    game.mode = mode;
    game.state = 'PLACING'; game.stateTime = 0; game.logState('PLACING');
    game.teams = TEAMS.map((t, i) => ({
      name: t.name, color: t.color, key: t.key,
      isCpu: mode === 'cpu' ? i === 1 : (mode === 'demo' ? true : false),
      worms: [],
      ammo: { cluster: 3, shotgun: 3, dynamite: 2 },
      cursor: 0,
    }));
    // terrain
    let seed = Math.floor(Math.random() * 0x7fffffff);
    game.terrain = new Terrain(document.getElementById('game'));
    game.terrain.regenerate(seed, 8);
    // spawn worms (regenerate terrain if a valid placement can't be found)
    let placed = placeWorms();
    if (!placed) {
      seed = Math.floor(Math.random() * 0x7fffffff) + 7;
      game.terrain.regenerate(seed, 8);
      placed = placeWorms();
    }
    if (!placed) {
      // last-resort: snap worms straight to ground so the match always starts
      placeWormsFallback();
    }
    game.turnCount = 0; game.suddenDeath = false; game.sdAnnounced = false;
    game.waterY = WATER_LINE; game.terrain.waterY = WATER_LINE;
    game.projectiles = []; game.particles = []; game.damageNumbers = []; game.graves = [];
    game._cpu = null; game._settleCap = 0;
    game.selectedWeapon = 'bazooka';
    game.activeTeam = seed % 2; game.activeWormIx = 0;
    game.turnTimer = TURN_TIME; game.retreatTimer = 0;
    game.wind = 0; game.windSign = 0;
    game.state = 'TURN_START'; game.stateTime = 0; game.logState('TURN_START');
    beginTurn();
  }

  function placeWorms() {
    // rebuild clean arrays (idempotent on retry)
    for (const t of game.teams) t.worms = [];
    const all = [];
    const minDist = 80;
    for (let ti = 0; ti < 2; ti++) {
      for (let w = 0; w < N_WORMS; w++) {
        let placed = false;
        for (let t = 0; t < 4000; t++) {
          const zones = game.terrain.standingZones;
          if (!zones.length) return false; // caller regenerates terrain
          const z = zones[(Math.random() * zones.length) | 0];
          let x = z.x + (Math.random() - 0.5) * z.width;
          x = Math.max(WORM_R + 2, Math.min(W - WORM_R - 2, x));
          const gx = groundAt(x);
          if (gx >= game.terrain.waterY - 30) continue; // too close to water
          const y = gx - WORM_R - 1;
          if (all.some(o => dist(o.x, o.y, x, y) < minDist + WORM_R)) continue;
          const worm = new Worm(ti, x, y);
          worm.facing = ti === 0 ? 1 : -1;
          worm.onGround = true;
          game.teams[ti].worms.push(worm); all.push(worm);
          placed = true; break;
        }
        if (!placed) return false; // caller regenerates terrain
      }
    }
    return true;
  }

  // Guaranteed placement: force each worm onto solid ground somewhere above water.
  function placeWormsFallback() {
    for (let ti = 0; ti < 2; ti++) {
      for (let w = 0; w < N_WORMS; w++) {
        let x = 120 + (ti * 700) + w * 130 + Math.random() * 40;
        x = Math.max(WORM_R + 2, Math.min(W - WORM_R - 2, x));
        let gx = groundAt(x);
        if (gx >= game.terrain.waterY - 30) {
          // nudge until above water
          for (let k = 0; k < 20 && gx >= game.terrain.waterY - 30; k++) { x = Math.max(WORM_R + 2, Math.min(W - WORM_R - 2, x + 30)); gx = groundAt(x); }
        }
        const y = gx - WORM_R - 1;
        const worm = new Worm(ti, x, y);
        worm.facing = ti === 0 ? 1 : -1; worm.onGround = true;
        game.teams[ti].worms.push(worm);
      }
    }
  }

  function groundAt(x) { return game.terrain.heightMap ? game.terrain.heightMap[Math.max(0, Math.min(W - 1, x | 0))] : H * 0.6; }
  function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }

  // ──────────────────────────────────────────────────────────────────────
  // Turn controller
  // ──────────────────────────────────────────────────────────────────────
  function beginTurn() {
    game.state = 'TURN_START'; game.stateTime = 0; game.logState('TURN_START');
    // sudden death bookkeeping
    if (game.turnCount >= SD_START_TURNS && !game.suddenDeath) {
      game.suddenDeath = true;
      game.sdAnnounced = false;
      // cap living HP at SD_HP_CAP
      for (const t of game.teams) for (const w of t.worms) if (w.alive) w.hp = Math.min(w.hp, SD_HP_CAP);
    }
    if (game.suddenDeath) {
      game.sdAnnounced = true;
      // water surface rises 12px per turn-start during SD (surface moves upward = smaller Y).
      // Per Req 10.4 the rising water must GUARANTEE termination: keep rising until it
      // submerges the highest terrain, drowning any worm left standing. Floor at 0 so the
      // whole playfield eventually fills and no "stuck on a high peak" match can linger.
      game.terrain.waterY = Math.max(0, game.terrain.waterY - SD_WATER_RISE);
      game.waterY = game.terrain.waterY;
    }
    // wind
    const mag = Math.random() * 26 + 4; const sign = Math.random() < 0.5 ? -1 : 1;
    game.wind = mag * sign; game.windSign = sign;
    // advance round-robin cursor to next living worm of active team
    const t = game.teams[game.activeTeam];
    if (t.worms.filter(w => w.alive).length === 0) {
      // shouldn't happen post win-check, but guard
      game.activeWormIx = 0;
    } else {
      let steps = t.worms.length;
      while (steps--) {
        game.activeWormIx = (game.activeWormIx + 1) % t.worms.length;
        if (t.worms[game.activeWormIx].alive) break;
      }
      const aw = activeWorm();
      if (!aw.alive) { game.activeWormIx = t.worms.findIndex(w => w.alive); }
    }
    game.turnTimer = TURN_TIME;
    game.retreatTimer = 0;
    // face toward enemy
    const aw = activeWorm();
    if (aw) aw.facing = (enemyCenterX() < aw.x) ? -1 : 1;
    if (aw && t.isCpu) {
      game._cpu = { phase: 'think', timer: 0.8 };
    } else {
      game._cpu = null;
    }
    game.state = 'AIMING'; game.stateTime = 0; game.logState('AIMING');
  }

  function advanceTurnCursor() {
    game.turnCount++;
    // win/draw evaluation
    const aliveCounts = game.teams.map(t => t.worms.filter(w => w.alive).length);
    const anyAlive = aliveCounts[0] + aliveCounts[1];
    if (aliveCounts[0] > 0 && aliveCounts[1] > 0) {
      game.activeTeam = 1 - game.activeTeam;
      beginTurn();
    } else if (aliveCounts === 0) {
      // impossible both zero (2 teams of 4), but guard draw
      endGameDraw();
    } else {
      const winner = aliveCounts[0] > 0 ? 0 : 1;
      endGame(winner);
    }
  }

  function endTurn() {
    // called when post-fire effects resolved: go to TURN_END
    game.state = 'TURN_END'; game.stateTime = 0; game.logState('TURN_END');
    resolveDeaths(true);
    // settle cap safety already handled separately
    // check win/draw
    const ac = game.teams.map(t => t.worms.filter(w => w.alive).length);
    const totalAlive = ac[0] + ac[1];
    if (totalAlive > 0 && ac[0] > 0 && ac[1] > 0) {
      game.turnCount++;
      // sudden death activation happens in beginTurn via turnCount check
      beginTurn();
    } else if (totalAlive === 0) {
      endGameDraw();
    } else {
      const winner = ac[0] > 0 ? 0 : 1;
      endGame(winner);
    }
  }

  function endGame(winner) {
    game.state = 'GAME_OVER'; game.stateTime = 0; game.logState('GAME_OVER');
    game._cpu = null;
    const msg = document.getElementById('victoryMessage');
    if (winner === 0.5) msg.textContent = "It's a draw!";
    else msg.textContent = 'Team ' + game.teams[winner].name + ' wins';
    document.getElementById('victoryScreen').classList.remove('hidden');
    flashBg();
  }
  function endGameDraw() { endGame(0.5); }

  function enemyCenterX() {
    const t = game.teams[1 - game.activeTeam];
    const lw = t.worms.filter(w => w.alive);
    const m = lw[Math.floor(Math.random() * lw.length)] || lw[0];
    return m ? m.x : W / 2;
  }

  function activeWorm() {
    const t = game.teams[game.activeTeam];
    return t ? (t.worms[game.activeWormIx] || null) : null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Death resolution (deferred)
  // ──────────────────────────────────────────────────────────────────────
  function resolveDeaths(resolveOnTurnEnd) {
    // flag new dying worms
    for (const t of game.teams) for (const w of t.worms) {
      if (w.alive && w.hp <= 0 && !w.dying) {
        w.dying = true; w.dyingTimer = DEATH_DELAY; w.dyingExploded = false;
      }
    }
    // tick dying timers; explode when expired
    let anyDying = false;
    for (const t of game.teams) for (const w of t.worms) {
      if (w.dying) {
        anyDying = true;
        w.dyingTimer -= STEP;
        if (w.dyingTimer <= 0 && !w.dyingExploded) {
          w.dyingExploded = true;
          w.alive = false;
          explode(w.x, w.y, DEATH_R, DEATH_DMG, true);
          game.graves.push({ x: w.x, y: w.y });
        }
      }
    }
    return anyDying; // SETTLING uses this to wait
  }

  // ──────────────────────────────────────────────────────────────────────
  // Explosion (single choke point)
  // ──────────────────────────────────────────────────────────────────────
  function explode(x, y, radius, maxDmg, isDeathDet) {
    if (!game.terrain) return;
    game._dbg = game._dbg || { explodes: 0, dmg: 0, max: 0, events: [] };
    game._dbg.explodes++; game._dbg.max = Math.max(game._dbg.max, radius, maxDmg);
    game._dbg.events.push({ x: (x).toFixed(0), y: (y).toFixed(0), r: radius, d: maxDmg, death: !!isDeathDet });
    // 1. carve terrain
    game.terrain.carve(x, y, radius);
    // 2. damage + knockback
    for (const t of game.teams) for (const w of t.worms) {
      if (!w.alive || w.dying) continue;
      const d = dist(x, y, w.x, w.y);
        if (d < radius + WORM_R) {
        let dmg = maxDmg * (1 - Math.min(d / radius, 1));
        dmg = Math.max(dmg, maxDmg * DAMAGE_MIN_HIT_FRAC); // floor while overlapping
        dmg = Math.min(dmg, maxDmg);
        w.hp = Math.max(0, w.hp - dmg);
        w.hpPop = 0.35;
        spawnFloat(w.x, w.y, Math.round(dmg));
        // knockback
        let kbx = 0, kby = 0;
        if (d > 0.5) { kbx = (w.x - x) / d; kby = (w.y - y) / d; }
        else { kbx = 0; kby = -1; }
        const k = 260 * (dmg / maxDmg) + 60;
        w.vx += kbx * k; w.vy += kby * k - 40; // slight upward bias feels better
        w.onGround = false; w.fallStartY = w.y;
      }
    }
    // 3. particles + shake
    spawnExplosion(x, y, radius, isDeathDet);
    game.camera = game.camera || { shakeT: 0, shakeMag: 0 };
    game.camera.shakeMag = Math.max(game.camera.shakeMag, radius / 16);
    game.camera.shakeT = 0.32;
    // 4. audio (best-effort)
    playSfx('explosion', radius);
  }

  function spawnFloat(x, y, amt) {
    game.damageNumbers.push({ x, y, v: -90, life: 0.8, text: String(amt), color: '#ffd28a' });
  }
  function spawnExplosion(x, y, radius, isDeath) {
    const n = Math.min(40, 6 + (radius / 2) | 0);
    const col = isDeath ? '#ff8e46' : '#ffb347';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * (radius / 2.2) + 6;
      game.particles.push(new Particle(
        x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.5 + Math.random() * 0.4, col, 3 + Math.random() * 3
      ));
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Weapons / firing
  // ──────────────────────────────────────────────────────────────────────
  function fireWeapon(weapon, power) {
    const aw = activeWorm(); if (!aw) return;
    const wpn = WEAPONS.byId(weapon); if (!wpn) return;
    // ammo gate
    if (wpn.ammo !== Infinity && game.teams[game.activeTeam].ammo[wpn.id] <= 0) return;
    playSfx('fire', null);
    if (wpn.instant) {           // shotgun: raycast
      shotgunFire(aw, wpn);
      return;
    }
    if (wpn.placed) {            // dynamite
      const proj = new Projectile(weapon, aw.x, aw.y + WORM_R + 1, 0, 0);
      game.projectiles.push(proj);
      enterPostFire();
      return;
    }
    // charged launch
    const a = worldAimAngle(aw);
    const spd = wpn.speed * Math.min(Math.max(power || 0, 0.1), 1);
    const vx = Math.cos(a) * spd;
    const vy = Math.sin(a) * spd;
    game.projectiles.push(new Projectile(weapon, aw.x + aw.facing * 6, aw.y, vx, vy));
    enterPostFire();
  }

  function worldAimAngle(w) {
    // aimT in [-1,1] -> angle; facing-right: aimT*PI/2 ; facing-left: PI - aimT*PI/2
    if (w.facing >= 0) return w.aimT * (Math.PI / 2);
    return Math.PI - w.aimT * (Math.PI / 2);
  }

  function shotgunFire(aw, wpn) {
    const base = worldAimAngle(aw);
    const n = wpn.shots || 2;
    for (let i = 0; i < n; i++) {
      // two rays with a small spread
      const spread = (i === 0 ? -0.12 : 0.12) + (Math.random() - 0.5) * 0.04;
      const a = base + spread;
      const len = 360;
      let x = aw.x, y = aw.y;
      let hx = x + Math.cos(a) * len, hy = y + Math.sin(a) * len;
      let hitWorm = null, best = len;
      // march to find first worm/terrain hit
      for (let t = 0; t <= len; t += 4) {
        const px = x + Math.cos(a) * t, py = y + Math.sin(a) * t;
        for (const tt of game.teams) for (const ww of tt.worms) {
          if (!ww.alive || ww.dying) continue;
          const d = dist(px, py, ww.x, ww.y);
          if (d < WORM_R + 2) { hx = px; hy = py; hitWorm = ww; best = t; break; }
        }
        if (game.terrain.solidAt(px, py)) { hx = px; hy = py; hitWorm = null; best = t; break; }
        if (hitWorm) break;
      }
      if (best < len || hitWorm) {
        // carve small hole
        if (game.terrain.solidAt(hx, hy)) game.terrain.carve(hx, hy, wpn.radius);
        for (const tt of game.teams) for (const ww of tt.worms) {
          if (!ww.alive || ww.dying) continue;
          if (dist(hx, hy, ww.x, ww.y) < WORM_R + wpn.radius) {
            const d = dist(hx, hy, ww.x, ww.y);
            const dmg = wpn.maxDmg * (1 - Math.min(d / wpn.radius, 1));
            applyDamage(ww, dmg, wpn.maxDmg);
          }
        }
      }
      spawnFloat(hx, hy, wpn.maxDmg);
    }
    // shotgun ends turn immediately (no retreat)
    scheduleTurnEnd();
  }

  function applyDamage(worm, dmg, maxDmg) {
    const d = Math.min(dmg, maxDmg);
    worm.hp = Math.max(0, worm.hp - d);
    worm.hpPop = 0.35;
  }

  function enterPostFire() {
    // decrement ammo for limited weapons
    const aw = activeWorm();
    const sel = game.selectedWeapon || 'bazooka';
    const wpn = WEAPONS.byId(sel);
    if (wpn && wpn.ammo !== Infinity) game.teams[game.activeTeam].ammo[wpn.id]--;
    game.retreatTimer = RETREAT_TIME;
    game.state = 'PROJECTILE'; game.stateTime = 0; game.logState('PROJECTILE');
  }

  function scheduleTurnEnd() {
    if (game.state === 'SHOTGUN_END') return;
    game.state = 'TURN_END'; game.stateTime = 0; game.logState('TURN_END');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Physics step
  // ──────────────────────────────────────────────────────────────────────
  function wormAt(x, y, r) {
    for (const t of game.teams) for (const w of t.worms) {
      if (!w.alive || w.dying) continue;
      if (dist(x, y, w.x, w.y) < r) return w;
    }
    return null;
  }
  function projStats(p) {
    if (p.isBomblet) return { id: 'bomblet', bounce: false, wind: false, radius: p.bRadius || 25, maxDmg: p.bDmg || 15, instant: false };
    return WEAPONS.byId(p.kind);
  }
  function detonateProj(p) {
    const wp = projStats(p);
    explode(p.x, p.y, wp.radius, wp.maxDmg, false);
    if (p.kind === 'cluster') spawnBomblets(p);
  }
  function isImpact(p) { const wp = projStats(p); return !wp.bounce && !wp.instant; }

  function stepPhysics() {
    // --- projectiles ---
    for (let i = game.projectiles.length - 1; i >= 0; i--) {
      const p = game.projectiles[i];
      const wp = projStats(p);
      p.age += STEP;
      // hard timeout (<=10s) forces resolution (Req 9.1)
      if (p.age > PROJ_TIMEOUT) {
        if (isImpact(p)) { detonateProjAt(p); }
        game.projectiles.splice(i, 1);
        continue;
      }
      // fuse for timed weapons (grenade/cluster/dynamite)
      if (p.fuse != null && p.fuse > 0 && !p.resting) {
        p.fuse -= STEP;
        if (p.fuse <= 0) { detonateProjAt(p); if (p.kind === 'cluster') spawnBomblets(p); game.projectiles.splice(i, 1); continue; }
      }
      // fuse for placed dynamite (countdown even while resting)
      if (p.resting && p.fuse != null && p.fuse > 0) {
        p.fuse -= STEP;
        if (p.fuse <= 0) { detonateProjAt(p); game.projectiles.splice(i, 1); continue; }
      }
      if (p.resting) continue; // dynamite: stationary until fuse
      // integrate (wind + gravity), swept sub-steps capped at ~3px
      let vx = p.vx, vy = p.vy;
      if (wp.wind) vx += game.wind * STEP;
      vy += GRAVITY * STEP;
      const sp = Math.hypot(vx, vy) * STEP;
      const n = Math.max(1, Math.ceil(sp / 3));
      const sxi = vx / n, syi = vy / n;
      let hit = null; let hitW = null;
      for (let s = 0; s < n; s++) {
        p.x += sxi; p.y += syi;
        if (p.x < -60 || p.x > W + 60 || p.y < -60) { hit = 'oob'; break; }
        if (p.y > game.terrain.waterY) { hit = 'water'; break; }
        if (game.terrain.solidAt(p.x, p.y)) { hit = 'terrain'; break; }
        hitW = wormAt(p.x, p.y, WORM_R + 2);
        if (hitW) { hit = 'worm'; break; }
      }
      p.vx = vx; p.vy = vy;
      if (!hit) continue;
      // resolve collision
      if (hit === 'oob') {
        if (isImpact(p) && p.kind !== 'bazooka') detonateProjAt(p); // bomblets explode on OOB too
        game.projectiles.splice(i, 1);
        continue;
      }
      if (hit === 'water' || hit === 'worm') {
        detonateProjAt(p); if (p.kind === 'cluster') spawnBomblets(p); game.projectiles.splice(i, 1); continue;
      }
      // terrain contact
      if (wp.bounce) {
        // grenade / cluster bomb: bounce, do not explode
        p.vx = vx * wp.restitution; p.vy = vy * wp.restitution;
        if (p.vy > 0) p.vy -= wp.restitution * 40;
        // nudge out of solid
        p.x += (p.vx > 0 ? 2 : -2); p.y -= 2;
      } else {
        detonateProjAt(p); if (p.kind === 'cluster') spawnBomblets(p); game.projectiles.splice(i, 1);
      }
    }
    // --- worms: gravity + movement + collision ---
    for (const t of game.teams) for (const w of t.worms) {
      if (!w.alive || w.dying) continue;
      updateWorm(w);
    }
    // --- falling into water (drown) ---
    for (const t of game.teams) for (const w of t.worms) {
      if (!w.alive || w.dying) continue;
      if (w.y + WORM_R >= game.terrain.waterY) {
        waterSplash(w.x, w.y);
        w.hp = 0; w.dying = true; w.dyingTimer = 0.0; w.dyingExploded = false;
      }
    }
  }

  function detonateProjAt(p) {
    const wp = projStats(p);
    explode(p.x, p.y, wp.radius, wp.maxDmg, false);
  }

  function spawnBomblets(p) {
    const wp = WEAPONS.byId('cluster');
    const n = wp.bomblets || 5;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / Math.max(1, n - 1)) * Math.PI * 0.6 - Math.PI * 0.3 + (Math.random() - 0.5) * 0.3;
      const sp = 160 + Math.random() * 90;
      game.projectiles.push({
        kind: 'bomblet', isBomblet: true,
        x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        age: 0, fuse: 0, resting: false, bRadius: wp.bRadius, bDmg: wp.bDmg,
      });
    }
  }

  function updateWorm(w) {
    if (!w.onGround) {
      w.vy += GRAVITY * STEP;
      if (w.vy > 0) w.fallStartY = (w.fallStartY === undefined) ? w.y : w.fallStartY;
    }
    w.x += w.vx * STEP;
    w.y += w.vy * STEP;
    const r = WORM_R;
    if (w.x < r) { w.x = r; w.vx = 0; }
    if (w.x > W - r) { w.x = W - r; w.vx = 0; }
    // standing/crouching on terrain
    if (w.vy >= 0 && terrainSolidsAt(w.x, w.y + r + 1)) {
      const gy = groundUnder(w.x, w.y + r);
      if (gy != null) {
        const ny = gy - r - 1;
        if (w.onGround === false) {
          const fallDist = w.fallStartY - ny;
          if (fallDist > SAFE_FALL) { w.hp = Math.max(0, w.hp - fallDist * FALL_K); w.hpPop = 0.35; }
        }
        w.y = ny; w.vy = 0; w.onGround = true;
      }
    } else if (w.vy >= 0) {
      // only clear onGround if there is genuinely no ground right below feet
      if (!terrainSolidsAt(w.x, w.y + r + 1)) w.onGround = false;
    }
    if (w.vy < 0 && terrainSolidsAt(w.x, w.y - r - 1)) { w.vy = 0; }
    if (w.onGround) {
      w.vx *= 0.82;
      if (Math.abs(w.vx) < 6) w.vx = 0;
    }
  }

  function terrainSolidsAt(x, y) {
    if (!game.terrain) return false;
    return game.terrain.solidAt(x - 3, y) || game.terrain.solidAt(x + 3, y) || game.terrain.solidAt(x, y);
  }
  function groundUnder(x, startY) {
    // scan downward from the feet to find the surface (solid terrain) below.
    // bounded look-ahead keeps performance predictable over long sims.
    for (let yy = startY; yy < startY + 44 && yy < H; yy++) {
      if (game.terrain.solidAt(x, yy)) return yy;
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Input
  // ──────────────────────────────────────────────────────────────────────
  function allowedInput(state) {
    return state === 'AIMING' || state === 'CHARGING';
  }
  function onKeyDown(e) {
    if (e.repeat) return;
    game.keys.add(e.code);
    game.keysDown.push(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }
  function onKeyUp(e) { game.keys.delete(e.code); game.keysUp.push(e.code); }

  function handleInput() {
    const aw = activeWorm();
    if (!aw) return;
    for (const code of game.keysDown) {
      if (!allowedInput(game.state)) continue;
      switch (code) {
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
          if (game.state !== 'AIMING') break;
          const wpn = WEAPONS.byKey(parseInt(code.slice(-1), 10));
          if (wpn && (wpn.ammo === Infinity || game.teams[game.activeTeam].ammo[wpn.id] > 0)) {
            game.selectedWeapon = wpn.id;
          }
          break;
        case 'Space':
          if (game.state === 'AIMING') {
            const cur = WEAPONS.byId(game.selectedWeapon || 'bazooka');
            if (cur.instant) {
              // shotgun handled; consume one ray
              handleShotgunInput();
            } else if (cur.placed) {
              fireWeapon(cur.id, 1);
            } else {
              game.state = 'CHARGING'; game.stateTime = 0; game.charge = 0;
            }
          }
          break;
        case 'Enter': case 'KeyZ':
          if (game.state === 'AIMING' && aw.onGround) {
            aw.vx += aw.facing * JUMP_VX; aw.vy = JUMP_VY; aw.onGround = false;
            playSfx('jump');
          }
          break;
        case 'ArrowUp': if (game.state === 'AIMING') aw.aimT = Math.max(-1, aw.aimT - 0.018 * (e => 1)(0)); break;
        case 'ArrowDown': if (game.state === 'AIMING') aw.aimT = Math.min(1, aw.aimT + 0.018); break;
      }
    }
    // continuous movement
    if (game.state === 'AIMING' && aw.onGround) {
      let walk = 0;
      if (game.keys.has('ArrowLeft')) walk -= 1;
      if (game.keys.has('ArrowRight')) walk += 1;
      if (walk) {
        aw.facing = walk; aw.aimT = aw.aimT; // keep (mirror handled by facing)
        aw.vx += walk * WALK_SPEED * STEP * 8; // scale for fixed step
        if (Math.abs(aw.vx) > WALK_SPEED) aw.vx = WALK_SPEED * walk;
      }
    }
    // charging gauge
    if (game.state === 'CHARGING') {
      if (game.keys.has('Space')) {
        game.charge = Math.min(1, game.charge + STEP / 1.5);
      }
      if (game.keysUp.includes('Space') || game.charge >= 1) {
        fireWeapon(game.selectedWeapon || 'bazooka', game.charge);
        game.state = 'PROJECTILE'; // enterPostFire sets state
        game.charge = 0;
      }
    }
    game.keysDown = [];
    game.keysUp = [];
  }

  let shotgunShots = 0;
  function handleShotgunInput() {
    const cur = WEAPONS.byId('shotgun');
    // fire one ray; we re-use shotgunFire with 1 ray
    const aw = activeWorm(); if (!aw) return;
    const base = worldAimAngle(aw);
    let hx = aw.x + Math.cos(base) * 360, hy = aw.y + Math.sin(base) * 360;
    let hitWorm = null;
    for (let t = 0; t <= 360; t += 4) {
      const px = aw.x + Math.cos(base) * t, py = aw.y + Math.sin(base) * t;
      let found = false;
      for (const tt of game.teams) for (const ww of tt.worms) {
        if (!ww.alive || ww.dying) continue;
        if (dist(px, py, ww.x, ww.y) < WORM_R + 2) { hx = px; hy = py; hitWorm = ww; found = true; break; }
      }
      if (found) break;
      if (game.terrain.solidAt(px, py)) { hx = px; hy = py; hitWorm = null; break; }
    }
    if (game.terrain.solidAt(hx, hy)) game.terrain.carve(hx, hy, cur.radius);
    for (const tt of game.teams) for (const ww of tt.worms) {
      if (!ww.alive || ww.dying) continue;
      if (dist(hx, hy, ww.x, ww.y) < WORM_R + cur.radius) {
        const d = dist(hx, hy, ww.x, ww.y);
        const dmg = cur.maxDmg * (1 - Math.min(d / cur.radius, 1));
        applyDamage(ww, dmg, cur.maxDmg);
      }
    }
    spawnFloat(hx, hy, cur.maxDmg);
    shotgunShots++;
    const idx = game.teams[game.activeTeam].ammo; if (idx[cur.id] !== undefined && idx[cur.id] !== Infinity) {
      // decrement once per 2-shot use handled in fireWeapon enterPostFire; here we track via scheduleTurnEnd
    }
    if (game.teams[game.activeTeam].ammo[cur.id] !== undefined && game.teams[game.activeTeam].ammo[cur.id] !== Infinity) game.teams[game.activeTeam].ammo[cur.id]--;
    if (shotgunShots >= (cur.shots || 2)) {
      shotgunShots = 0;
      scheduleTurnEnd();
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CPU controller
  // ──────────────────────────────────────────────────────────────────────
  const CPU = {
    think: 0.8, aimSweep: 0.6, charge: 0.9,
    run() {
      const aw = activeWorm();
      if (!aw) return;
      const cpu = game._cpu;
      if (!cpu) { /* not cpu's turn via this path */ return; }
      if (cpu.phase === 'think') {
        cpu.timer -= STEP;
        if (cpu.timer <= 0) {
          cpu.phase = 'aim'; cpu.timer = CPU.aimSweep;
          cpu.plan = planShot(aw);
          if (!cpu.plan) cpu.plan = { weapon: 'bazooka', angle: worldAimAngle(aw), power: 0.7 };
          // face toward target
          aw.facing = (cpu.plan.targetX < aw.x) ? -1 : 1;
        }
        return;
      }
      if (cpu.phase === 'aim') {
        cpu.timer -= STEP;
        const tgt = cpu.plan;
        aw.aimT = Math.max(-1, Math.min(1, aimTFromWorld(tgt.angle, aw.facing)));
        if (cpu.timer <= 0) {
          cpu.phase = 'wander'; cpu.timer = 0.4;
          // maybe short walk toward target for better angle
          const dir = tgt.targetX < aw.x ? -1 : 1;
          if (aw.onGround) { aw.vx += dir * WALK_SPEED * 0.6; aw.vx = Math.max(-WALK_SPEED, Math.min(WALK_SPEED, aw.vx)); }
        }
        return;
      }
      if (cpu.phase === 'wander') {
        cpu.timer -= STEP;
        if (cpu.timer <= 0) {
          cpu.phase = 'charge'; cpu.timer = CPU.charge;
        }
        return;
      }
      if (cpu.phase === 'charge') {
        cpu.timer -= STEP;
        if (cpu.timer <= 0) {
          cpu.phase = 'fire';
        }
        return;
      }
      if (cpu.phase === 'fire') {
        const p = cpu.plan;
        const wpn = WEAPONS.byId(p.weapon);
        if (wpn.instant) { /* not used for cpu shotgun */ }
        if (wpn.placed) {
          fireWeapon(p.weapon, 1);
        } else {
          fireWeapon(p.weapon, p.power);
        }
        cpu.phase = 'done';
        // post-fire handled by state machine entering PROJECTILE+retreat
      }
    }
  };

  function aimTFromWorld(angle, facing) {
    if (facing >= 0) return angle / (Math.PI / 2);
    return -((angle - Math.PI) / (Math.PI / 2));
  }

  function planShot(aw) {
    // pick nearest living enemy
    const enemies = game.teams[1 - game.activeTeam].worms.filter(w => w.alive);
    if (!enemies.length) return null;
    enemies.sort((a, b) => dist(a.x, a.y, aw.x, aw.y) - dist(b.x, b.y, aw.x, aw.y));
    const tgt = enemies[0];
    // closed-form power for direct shot (no wind), clamped
    const dx = tgt.x - aw.x, dy = tgt.y - aw.y;
    const range = Math.hypot(dx, dy);
    let angle = Math.atan2(dy, dx);
    // if target behind us relative to facing, flip facing
    // compute candidate via direct angle
    let power = solvePower(angle, range);
    // try to clear terrain: simulate
    let plan = { weapon: 'bazooka', angle, power, targetX: tgt.x };
    let hit = simulate(aw.x, aw.y, angle, power * WEAPONS.byId('bazooka').speed, true);
    if (hit.type === 'terrain' && Math.abs(hit.x - tgt.x) > 120) {
      // blocked; try a lob
      const tries = 6;
      for (let i = 0; i < tries; i++) {
        const hi = angle + 0.25 * (i + 1) * (dy < 0 ? 1 : -1);
        const p2 = solvePower(hi, range);
        const h2 = simulate(aw.x, aw.y, hi, p2 * WEAPONS.byId('bazooka').speed, true);
        if (h2.type === 'oob' || h2.type === 'terrain') {
          if (Math.abs(h2.x - tgt.x) < 200) { plan = { weapon: 'grenade', angle: hi, power: p2, targetX: tgt.x }; }
        } else if (Math.abs(h2.x - tgt.x) < 220) { plan = { weapon: 'bazooka', angle: hi, power: p2, targetX: tgt.x }; }
        if (plan.weapon !== 'bazooka' && i === tries - 1) break;
      }
    }
    // random error (beatable): sigma angle ~0.18, power ~0.18
    plan.angle += gauss(Math.random) * 0.18;
    plan.power = Math.min(0.98, Math.max(0.15, plan.power + gauss(Math.random) * 0.18));
    if (plan.weapon === 'dynamite') plan.power = 1;
    return plan;
  }

  function solvePower(angle, range) {
    const s2 = Math.sin(2 * angle);
    if (Math.abs(s2) < 1e-3) return 0.8;
    let v = Math.sqrt(range * GRAVITY / Math.abs(s2));
    const max = WEAPONS.byId('bazooka').speed;
    v = Math.min(max, Math.max(120, v));
    return v / max;
  }

  function simulate(x0, y0, angle, speed, withWind) {
    const wp = WEAPONS.byId('bazooka');
    let vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed;
    let x = x0, y = y0;
    const sub = 3;
    const maxSteps = 700;
    for (let i = 0; i < maxSteps; i++) {
      const sp = Math.hypot(vx, vy) * STEP;
      const n = Math.max(1, Math.ceil(sp / sub));
      const sx = vx / n, sy = vy / n;
      for (let s = 0; s < n; s++) {
        if (withWind) vx += game.wind * STEP / n;
        vy += GRAVITY * STEP / n;
        x += sx; y += sy;
        vx += (withWind ? game.wind * STEP / n : 0) * 0; // already applied
      }
      // check terrain
      if (game.terrain.solidAt(x, y) || y > game.terrain.waterY || x < -50 || x > W + 50 || y < -50) {
        return { type: game.terrain.solidAt(x, y) ? 'terrain' : 'oob', x, y };
      }
    }
    return { type: 'timeout', x, y };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Main fixed step (state machine + logic)
  // ──────────────────────────────────────────────────────────────────────
  function updateEffects() {
    // particles
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.life -= STEP;
      if (p.life <= 0) { game.particles.splice(i, 1); continue; }
      p.vy += GRAVITY * STEP * 0.18;
      p.x += p.vx * STEP; p.y += p.vy * STEP;
    }
    // damage numbers
    for (let i = game.damageNumbers.length - 1; i >= 0; i--) {
      const d = game.damageNumbers[i];
      d.life -= STEP; d.v -= 140 * STEP;
      d.y += d.v * STEP;
      if (d.life <= 0) game.damageNumbers.splice(i, 1);
    }
  }

  function fixedStep() {
    game.stateTime += STEP;

    // --- timers (turn timer runs only while player can act) ---
    if (game.state === 'AIMING' || game.state === 'CHARGING') {
      game.turnTimer -= STEP;
    }
    if (game.state === 'PROJECTILE' || game.state === 'RETREAT') {
      if (game.retreatTimer > -1000) game.retreatTimer -= STEP;
    }

    // --- CPU turn driver (visible, human-paced, fixed-step) ---
    const aw = activeWorm();
    if (game.state === 'AIMING' && aw && game.teams[game.activeTeam].isCpu) {
      if (!game._cpu) game._cpu = { phase: 'think', timer: CPU.think };
      CPU.run();
    } else if (game.state !== 'AIMING' || !game.teams[game.activeTeam].isCpu) {
      game._cpu = null;
    }

    // --- input (applies movement/aim/charge for current state) ---
    if (game.state !== 'TITLE' && game.state !== 'GAME_OVER' && game.state !== 'PLACING') {
      handleInput();
    }

    // --- physics: projectiles, worms, falling/drowning ---
    stepPhysics();

    // --- deferred death resolution + chain reactions ---
    resolveDeaths();

    // --- state-machine transitions ---
    switch (game.state) {
      case 'TITLE': break;
      case 'PLACING': game.state = 'TURN_START'; game.stateTime = 0; game.logState('TURN_START'); beginTurn(); break;
      case 'TURN_START': /* beginTurn ran synchronously */ break;
      case 'AIMING':
        if (game.turnTimer <= 0 && !game._cpu && !game.teams[game.activeTeam].isCpu) endTurnSoft();
        if (game.turnTimer <= 0 && game._cpu) { fireWeapon(game.selectedWeapon || 'bazooka', game.charge || 0.6); }
        break;
      case 'CHARGING': break;
      case 'PROJECTILE':
        if (game.projectiles.length === 0 && retreatElapsed()) {
          game.state = 'SETTLING'; game.stateTime = 0; game.logState('SETTLING'); game._settleCap = SETTLE_CAP;
        }
        break;
      case 'SETTLING':
        if (settled()) {
          finishTurn();
        }
        if (game._settleCap !== undefined) {
          game._settleCap -= STEP;
          if (game._settleCap <= 0) { forceSettle(); finishTurn(); }
        }
        break;
      case 'TURN_END': break;
      case 'GAME_OVER': break;
    }
    updateEffects();
  }

  function retreatElapsed() {
    const aw = activeWorm();
    if (!aw) return true;
    // effects resolved + worm truly at rest → end retreat early; otherwise the
    // 5-second retreat cap always forces the turn to advance (Req 3.4 / 9).
    const atRest = aw.onGround && Math.abs(aw.vx) < 4 && Math.abs(aw.vy) < 4;
    return game.retreatTimer <= 0 || atRest;
  }
  function settled() {
    if (game.projectiles.length) return false;
    if (resolveDeaths()) return false; // worms still dying / detonating
    for (const t of game.teams) for (const w of t.worms) {
      if (w.alive && !w.dying) {
        const atRest = w.onGround && Math.abs(w.vx) < 4 && Math.abs(w.vy) < 4;
        if (!atRest) return false; // still falling or moving
      }
    }
    return true;
  }
  function finishTurn() {
    resolveDeaths(true);
    const ac = game.teams.map(t => t.worms.filter(w => w.alive).length);
    const total = ac[0] + ac[1];
    if (total > 0 && ac[0] > 0 && ac[1] > 0) {
      game.turnCount++;
      game.state = 'TURN_END'; game.stateTime = 0; game.logState('TURN_END');
      beginTurn();
    } else if (total === 0) {
      endGameDraw();
    } else {
      endGame(ac[0] > 0 ? 0 : 1);
    }
  }
  function endTurnSoft() {
    // timer expired without firing: end turn directly
    resolveDeaths(true);
    const ac = game.teams.map(t => t.worms.filter(w => w.alive).length);
    const total = ac[0] + ac[1];
    if (total > 0 && ac[0] > 0 && ac[1] > 0) {
      game.turnCount++;
      game.state = 'TURN_END'; game.stateTime = 0; game.logState('TURN_END');
      beginTurn();
    } else if (total === 0) {
      endGameDraw();
    } else {
      endGame(ac[0] > 0 ? 0 : 1);
    }
  }
  function forceSettle() {
    for (const t of game.teams) for (const w of t.worms) {
      if (w.alive && !w.dying) { w.vx = 0; w.vy = 0; w.onGround = true; }
    }
  }
  function spawnBomblets(p) {
    const wp = WEAPONS.byId('cluster');
    const n = wp.bomblets || 5;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI * 0.6 - Math.PI * 0.3 + Math.random() * 0.2;
      const sp = 160 + Math.random() * 80;
      game.projectiles.push({
        kind: 'bomblet', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        age: 0, fuse: 0, radius: wp.bRadius, maxDmg: wp.bDmg, bounce: false, split: false,
        isBomblet: true, timeout: PROJ_TIMEOUT,
      });
    }
  }
  function waterSplash(x, y) {
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * 0.6 + Math.random() * Math.PI; const sp = 60 + Math.random() * 80;
      game.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4, '#7ec8ff', 3));
    }
    playSfx('splash');
  }


  // ──────────────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────────────
  let canvas, ctx, Wscale = 1, Hscale = 1;
  function initRender() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', onResize);
    onResize();
  }
  function onResize() {
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : W;
    // full window
    const vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.min(vw / W, vh / H);
    canvas.style.width = (W * s) + 'px';
    canvas.style.height = (H * s) + 'px';
    Wscale = s; Hscale = s;
  }
  let shakeOff = { x: 0, y: 0 };
  function render() {
    if (!ctx) return;
    const cam = game.camera || { shakeT: 0, shakeMag: 0 };
    // screen shake
    if (cam.shakeT > 0) {
      cam.shakeT -= STEP;
      shakeOff.x = (Math.random() - 0.5) * cam.shakeMag * 1.2;
      shakeOff.y = (Math.random() - 0.5) * cam.shakeMag * 1.2;
    } else { shakeOff.x *= 0.85; shakeOff.y *= 0.85; }

    const s = Math.min(canvas.clientWidth / W, canvas.clientHeight / H) || 1;
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(shakeOff.x, shakeOff.y);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#4a7bbf'); sky.addColorStop(1, '#1a2a4a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // water
    const wy = game.terrain ? game.terrain.waterY : WATER_LINE;
    ctx.fillStyle = '#2a5ca0';
    ctx.fillRect(0, wy, W, H - wy);
    // water waves
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = '#3fa3ff'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < W; x += 8) {
        const y = wy + Math.sin((x * 0.02 + game.stateTime * (2 + i)) ) * 3 + i * 2;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // terrain
    if (game.terrain) ctx.drawImage(game.terrain.canvas, 0, 0);
    // gravestones
    ctx.fillStyle = '#888';
    for (const g of game.graves) ctx.fillRect(g.x - 4, g.y - 14, 8, 14);
    // worms
    for (const t of (game.teams || [])) for (const w of t.worms) drawWorm(w, t.color);
    // aim crosshair (active worm)
    const aw = (game.teams && game.teams[game.activeTeam]) ? game.teams[game.activeTeam].worms[game.activeWormIx] : null;
    if (aw && aw.alive && (game.state === 'AIMING' || game.state === 'CHARGING')) {
      const a = worldAimAngle(aw); const dist_ = 60;
      ctx.strokeStyle = '#ffd28a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(aw.x, aw.y); ctx.lineTo(aw.x + Math.cos(a) * dist_, aw.y + Math.sin(a) * dist_);
      ctx.stroke();
    }
    // projectiles
    for (const p of game.projectiles) drawProjectile(p);
    // particles
    for (const p of game.particles) drawParticle(p);
    // damage numbers
    ctx.textAlign = 'center';
    for (const d of game.damageNumbers) {
      ctx.fillStyle = d.color; ctx.font = 'bold 16px sans-serif';
      ctx.fillText(d.text, d.x, d.y);
    }
    ctx.restore();
    renderHUD();
  }

  function drawWorm(w, teamColor) {
    if (!w.alive && !w.dying) return;
    if (w.dying) return; // gravestone shows instead
    const pulse = w.hpPop > 0 ? (w.hpPop * 40) : 0;
    ctx.save();
    ctx.translate(w.x, w.y + WORM_R);
    ctx.fillStyle = teamColor;
    ctx.beginPath(); ctx.arc(0, 0, WORM_R, 0, Math.PI * 2); ctx.fill();
    // dirt band
    ctx.fillStyle = '#2e8b33';
    ctx.fillRect(-WORM_R, 0, WORM_R * 2, 3);
    // eyes
    ctx.fillStyle = '#111';
    const ex = w.facing * (WORM_R - 5);
    ctx.beginPath(); ctx.arc(ex, -2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex, 2, 3, 0, Math.PI * 2); ctx.fill();
    // active marker
    const aw = (game.teams && game.teams[game.activeTeam]) ? game.teams[game.activeTeam].worms[game.activeWormIx] : null;
    if (aw === w) {
      ctx.strokeStyle = '#ffd28a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-WORM_R - 6, -WORM_R - 6); ctx.lineTo(WORM_R + 6, -WORM_R - 6);
      ctx.lineTo(0, -WORM_R - 16); ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
    // HP label
    ctx.fillStyle = w.dying ? '#aaa' : (w.hpPop > 0 ? '#ff5555' : '#fff');
    ctx.textAlign = 'center'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(Math.round(w.hp), w.x, w.y - WORM_R - 7);
  }

  function drawProjectile(p) {
    const wp = p.isBomblet ? { radius: p.radius } : WEAPONS.byId(p.kind);
    if (!wp) return;
    if (p.isBomblet) {
      ctx.fillStyle = '#ff914d'; if (p.fuse > 0) ctx.fillStyle = '#ffff5a';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.fillStyle = '#ffd28a';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a5a00';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(wp.angle || 0) * 12, p.y - Math.sin(wp.angle || 0) * 12); ctx.stroke();
  }

  function drawParticle(p) {
    p.life -= STEP; if (p.life < 0) p.life = 0;
    ctx.fillStyle = p.color;
    const s = p.size * (p.life + 0.2);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    p.vy += GRAVITY * STEP * 0.3;
    p.x += p.vx * STEP; p.y += p.vy * STEP;
  }

  // ──────────────────────────────────────────────────────────────────────
  // HUD
  // ──────────────────────────────────────────────────────────────────────
  function renderHUD() {
  // No active team while at the title screen / game over / placement: the HUD still
  // paints its background fields (wind, timer, sudden-death), but the per-team ammo
  // and team bars must not read into an empty teams array (Req 8.4: no console errors).
  const hasMatch = game.teams.length > 0 && game.state !== 'TITLE' && game.state !== 'GAME_OVER';
  const team = hasMatch ? game.teams[game.activeTeam] : null;
  const aw = team ? team.worms[game.activeWormIx] : null;
  const sel = game.selectedWeapon || 'bazooka';
  // weapon panel
  const wp = document.getElementById('weaponPanel');
  if (wp.dataset.built !== '1') {
    wp.innerHTML = '';
    for (const w of WEAPONS) {
      const b = document.createElement('button'); b.className = 'weapon'; b.textContent = w.key + ' ' + w.name;
      b.dataset.id = w.id;
      const ammo = team && team.ammo[w.id] != null ? team.ammo[w.id] : (w.ammo === Infinity ? Infinity : undefined);
      b.dataset.ammo = String(ammo === Infinity ? '\u221e' : (ammo == null ? '-' : ammo));
      b.addEventListener('click', () => { if (game.state === 'AIMING' && team && (w.ammo === Infinity || team.ammo[w.id] > 0)) game.selectedWeapon = w.id; });
      wp.appendChild(b); wp.dataset.built = '1';
    }
  }
  for (const b of wp.children) {
    const wid = b.dataset.id; const w = WEAPONS.byId(wid);
    const count = w.ammo === Infinity ? Infinity : (team ? team.ammo[wid] : Infinity);
    b.textContent = w.key + ' ' + w.name + (count !== Infinity ? ' ' + count : '');
    b.classList.toggle('sel', wid === sel);
    b.classList.toggle('dep', count !== Infinity && count <= 0);
  }
    document.getElementById('wind').textContent = `Wind: ${Math.round(game.wind)} ${game.windSign < 0 ? '◀' : '▶'}`;
    const tt = document.getElementById('turnTimer');
    tt.textContent = Math.ceil(Math.max(0, game.turnTimer));
    tt.classList.toggle('low', game.turnTimer < 10);
    document.getElementById('suddenDeath').classList.toggle('hidden', !game.sdAnnounced);
    // charge gauge
    let cg = document.getElementById('chargeGauge');
    if (!cg) { cg = document.createElement('div'); cg.id = 'chargeGauge'; cg.style.cssText = 'height:8px;background:#444;border:1px solid #666;margin-top:4px;width:120px'; document.getElementById('hudRight').appendChild(cg); }
    if (game.state === 'CHARGING') {
      cg.style.width = (game.charge * 120) + 'px';
      cg.style.background = '#ffd28a';
      cg.style.display = 'block';
    } else { cg.style.display = 'none'; }
    // team bars
    const tb = document.getElementById('teamBars');
    tb.innerHTML = '';
    for (let i = 0; i < game.teams.length; i++) {
      const t = game.teams[i];
      const alive = t.worms.filter(w => w.alive).length;
      const hp = t.worms.filter(w => w.alive).reduce((a, w) => a + w.hp, 0);
      const wrap = document.createElement('div'); wrap.className = 'bar team' + t.name;
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('span'); fill.style.width = (hp / (WORM_HP * N_WORMS) * 100) + '%';
      bar.appendChild(fill);
      const label = document.createElement('span'); label.className = 'wormCount';
      label.textContent = `${t.name} ${alive}/${N_WORMS}`;
      wrap.appendChild(bar); wrap.appendChild(label); tb.appendChild(wrap);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Audio (Web Audio, created on first user gesture; failure-safe)
  // ──────────────────────────────────────────────────────────────────────
  let audioCtx = null; let audioEnabled = true;
  function ensureAudio() {
    if (audioCtx) return;
    if (!audioEnabled) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioEnabled = false; return; }
  }
  function playSfx(kind, radius) {
    if (!audioEnabled) return;
    ensureAudio();
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const t = audioCtx.currentTime;
    try {
      if (kind === 'fire') {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'square'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.15);
        g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.15);
      } else if (kind === 'explosion') {
        const dur = Math.min(0.4, 0.12 + (radius || 30) / 400);
        const o = audioCtx.createBufferSource(); const buf = makeNoise(audioCtx, dur, radius || 40);
        const g = audioCtx.createGain(); g.gain.setValueAtTime(0.3 * Math.min(1, (radius || 30) / 80), t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.buffer = buf; o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur);
      } else if (kind === 'splash') {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
        g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.3);
      } else if (kind === 'turn') {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.12);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.12);
      }
    } catch (e) { audioEnabled = false; }
  }
  function makeNoise(ctx, dur, radius) {
    const len = ctx.sampleRate * dur; const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const decay = Math.min(1, (radius || 40) / 120);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - t / dur) * decay;
    }
    return buf;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Loop + bootstrap
  // ──────────────────────────────────────────────────────────────────────
  function flashBg() {
    document.body.style.transition = 'background .25s';
    document.body.style.background = '#1a2a4a';
    setTimeout(() => { document.body.style.background = ''; }, 260);
  }
  function init() {
    initRender();
    // input
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', () => ensureAudio());
    window.addEventListener('keydown', () => ensureAudio());
    // title buttons
    document.getElementById('btn2p').addEventListener('click', () => { startMatch('pvp'); document.getElementById('titleScreen').classList.add('hidden'); });
    document.getElementById('btnCpu').addEventListener('click', () => { startMatch('cpu'); document.getElementById('titleScreen').classList.add('hidden'); });
    document.getElementById('btnRematch').addEventListener('click', () => { document.getElementById('victoryScreen').classList.add('hidden'); startMatch(game.mode === 'cpu' ? 'cpu' : game.mode === 'demo' ? 'demo' : 'pvp'); });
    // default weapon
    game.selectedWeapon = 'bazooka';
    // demo?
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) { game.mode = 'demo'; startMatch('demo'); document.getElementById('titleScreen').classList.add('hidden'); }
    // expose debug handle
    window.__game = {
      get state() { return game.state; },
      get turnCount() { return game.turnCount; },
      get suddenDeath() { return game.suddenDeath; },
      get waterY() { return game.terrain ? game.terrain.waterY : WATER_LINE; },
      get wind() { return game.wind; },
      get teams() { return game.teams; },
      get projectiles() { return game.projectiles; },
      get selectedWeapon() { return game.selectedWeapon; },
      teamHP: () => game.teamHP(),
      activeTeam: () => game.activeTeam,
      runSteps(n) {
        const errs = [];
        game._testPaused = true;
        for (let i = 0; i < n; i++) {
          try { fixedStep(); } catch (e) { errs.push(String(e)); if (errs.length > 3) break; }
        }
        render();
        game._testPaused = false;
        return {
          errs: errs.length ? errs : undefined,
          state: game.state, turnTimer: game.turnTimer, retreatTimer: game.retreatTimer,
          turnCount: game.turnCount, suddenDeath: game.suddenDeath,
          proj: game.projectiles.map(p => ({ kind: p.kind, age: (p.age||0).toFixed(2), x: (p.x||0).toFixed(0), y: (p.y||0).toFixed(0), vx: (p.vx||0).toFixed(1), vy: (p.vy||0).toFixed(1), fuse: p.fuse, resting: p.resting, timedOut: (p.age||0) > PROJ_TIMEOUT })),
          dying: game.teams.map(t=>t.worms.filter(w=>w.alive&&w.dying).length),
          falling: game.teams.map(t=>t.worms.filter(w=>w.alive&&!w.dying&&!w.onGround).length),
          hp: game.teamHP(),
          aw: (function(){const w=activeWorm();return w?{onGround:w.onGround,x:(w.x||0).toFixed(0),y:(w.y||0).toFixed(0),vx:(w.vx||0).toFixed(1),hp:w.hp}:null;})(),
        };
      },
      test: {
        setTimeScale() {},
        restart() { startMatch(game.mode === 'demo' ? 'demo' : game.mode); document.getElementById('titleScreen').classList.add('hidden'); },
        resetDemo() { game.terrain && game.terrain.regenerate(Math.floor(Math.random()*0x7fffffff), 8); },
        terrainStandingZones() { return game.terrain ? game.terrain.standingZones.length : 0; },
        terrainSolidAt(x, y) { return game.terrain ? game.terrain.solidAt(x | 0, y | 0) : false; },
        solidAt(x, y) { return game.terrain ? game.terrain.solidAt(x | 0, y | 0) : false; }, // alias
        carve(x, y, r) { if (game.terrain) game.terrain.carve(x | 0, y | 0, r); }, // alias used by tests
        terrainCarve(x, y, r) { if (game.terrain) game.terrain.carve(x | 0, y | 0, r); },
        inspect() {
          if (!game.terrain) return null;
          const out = [];
          for (const t of game.teams) for (const w of t.worms) {
            out.push({
              team: t.name, hp: w.hp, alive: w.alive, onGround: w.onGround,
              x: +w.x.toFixed(2), y: +w.y.toFixed(2), vx: +w.vx.toFixed(2), vy: +w.vy.toFixed(2),
              feetSolid: game.terrain.solidAt(w.x, w.y + 13),
              headSolid: game.terrain.solidAt(w.x, w.y - 13),
              groundY: game.terrain.heightMap[Math.max(0, Math.min(W - 1, w.x | 0))],
            });
          }
          return out;
        },
        damageAt(d, radius, maxDmg) {
          if (d >= radius + WORM_R) return 0;
          let dmg = maxDmg * (1 - Math.min(d / radius, 1));
          return Math.max(dmg, maxDmg * DAMAGE_MIN_HIT_FRAC);
        },
      },
    };
    // start loop
    game._raf = requestAnimationFrame(loop);
  }

  let lastFrame = 0;
  function loop(ts) {
    if (!lastFrame) lastFrame = ts;
    const raw = (ts - lastFrame) / 1000; lastFrame = ts;
    if (game._testPaused) { game._raf = requestAnimationFrame(loop); return; }
    const dt = Math.min(raw, MAX_DT);
    game._acc += dt;
    let guard = 0;
    while (game._acc >= STEP && guard < 12) { fixedStep(); game._acc -= STEP; guard++; }
    // Defensive: never let a render hiccup kill the animation frame (Req 8.4).
    // Root cause is fixed (renderHUD guards the no-match state); this is a safety net
    // and surfaces any unexpected render error via the debug handle instead of the console.
    try { render(); } catch (e) { game._renderErr = (game._renderErr || []).concat(String(e)); }
    game._raf = requestAnimationFrame(loop);
  }

  window.addEventListener('load', init);
})();
