'use strict';
/*
 * Worms Duel - single-file implementation.
 * Sections below are ordered: constants -> pure math -> Terrain -> physics ->
 * explosion resolver -> weapons -> entities/game factory -> turn/state
 * machine -> CPU controller -> rendering -> audio -> input -> bootstrap.
 *
 * The pure simulation logic (everything before "BROWSER BOOTSTRAP") has no
 * dependency on `document`/`window`/canvas so it can run under Node for
 * headless unit tests. A CommonJS export guard at the bottom exposes it.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const WORLD_W = 1600;
const WORLD_H = 900;
const GRAVITY = 720; // px/s^2
const WORM_RADIUS = 10;
const MAX_STEP = 4; // px a worm can step up without being blocked
const WALK_SPEED = 90; // px/s
const SAFE_FALL_DIST = 90; // px of fall before damage starts
const FALL_DAMAGE_K = 0.28; // damage per px beyond safe fall distance
const MIN_STANDING_ZONES = 8;
const MIN_SPAWN_SPACING = 80;
const TURN_SECONDS = 45;
const RETREAT_SECONDS = 5;
const SETTLE_CAP_SECONDS = 8;
const PROJECTILE_TIMEOUT_SECONDS = 10;
const SUDDEN_DEATH_TURN = 20; // total turns across both teams
const SUDDEN_DEATH_HP_CAP = 30;
const SUDDEN_DEATH_WATER_RISE = 12; // px per turn during sudden death
const WORM_START_HP = 100;
const DEATH_FUSE_SECONDS = 0.5;
const DEATH_EXPLOSION_DAMAGE = 25;
const DEATH_EXPLOSION_RADIUS = 40;
const CHARGE_SECONDS = 1.5;
const FIXED_DT = 1 / 60;
const JUMP_VX = 130; // px/s forward arc jump
const JUMP_VY = 280; // px/s upward arc jump

const STATE = Object.freeze({
  TITLE: 'TITLE',
  TURN_START: 'TURN_START',
  AIMING: 'AIMING',
  CHARGING: 'CHARGING',
  PROJECTILE: 'PROJECTILE',
  RETREAT: 'RETREAT',
  SETTLING: 'SETTLING',
  TURN_END: 'TURN_END',
  GAME_OVER: 'GAME_OVER',
});

// ============================================================================
// PURE MATH / UTIL
// ============================================================================

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Deterministic PRNG (mulberry32) so terrain generation is seedable/testable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// TERRAIN
// ============================================================================

/**
 * Terrain is a pixel-accurate destructible heightmap.
 * `solid` is a Uint8Array (0/1) of width*height, row-major, air=0 solid=1.
 * `color` is a Uint8ClampedArray RGBA buffer used for rendering; kept in
 * lockstep with `solid` so drawing is a single putImageData per dirty rect.
 */
class Terrain {
  constructor(width = WORLD_W, height = WORLD_H) {
    this.width = width;
    this.height = height;
    this.solid = new Uint8Array(width * height);
    this.color = new Uint8ClampedArray(width * height * 4);
    this.heights = new Int32Array(width); // surface y per column (first solid row)
    this.waterHeight = 90;
    this.waterY = height - this.waterHeight;
    this.rand = mulberry32(1);
  }

  idx(x, y) {
    return y * this.width + x;
  }

  heightAt(x) {
    const xi = clamp(Math.floor(x), 0, this.width - 1);
    return this.heights[xi];
  }

  // --- generation -----------------------------------------------------

  generate(seed) {
    const MAX_ATTEMPTS = 8;
    let attempt = 0;
    let zones = [];
    let usedSeed = seed;
    do {
      usedSeed = seed + attempt * 104729;
      this._generateOnce(usedSeed);
      zones = this.findStandingZones();
      attempt++;
    } while (zones.length < MIN_STANDING_ZONES && attempt < MAX_ATTEMPTS);
    this._zones = zones;
    return zones;
  }

  _generateOnce(seed) {
    const rand = mulberry32(seed);
    this.rand = rand;
    const W = this.width;
    const H = this.height;

    // Layered value noise (few gentle octaves) for the height profile, then
    // a smoothing pass so the map naturally has many flat-enough standing
    // zones instead of relying on luck across regeneration attempts.
    const baseline = H * 0.42;
    const octaves = [
      { wavelength: W / 3, amp: H * 0.05 },
      { wavelength: W / 7, amp: H * 0.025 },
      { wavelength: W / 15, amp: H * 0.012 },
    ];
    // Random phase offsets per octave so every seed differs meaningfully.
    const phases = octaves.map(() => rand() * 1000);

    const rawHeights = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let y = baseline;
      for (let o = 0; o < octaves.length; o++) {
        const { wavelength, amp } = octaves[o];
        y += Math.sin((x / wavelength) * Math.PI * 2 + phases[o]) * amp;
      }
      rawHeights[x] = y;
    }

    const smoothWin = 21;
    const half = Math.floor(smoothWin / 2);
    const heights = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let sum = 0, count = 0;
      for (let k = -half; k <= half; k++) {
        const xi = x + k;
        if (xi >= 0 && xi < W) { sum += rawHeights[xi]; count++; }
      }
      heights[x] = sum / count;
    }

    // Clear buffers.
    this.solid.fill(0);
    const color = this.color;
    color.fill(0);

    const grassBand = 6;
    const dirtTop = [90, 62, 40];
    const dirtBottom = [58, 38, 24];
    const grassColor = [86, 168, 64];

    for (let x = 0; x < W; x++) {
      const surfaceY = Math.round(clamp(heights[x], 40, H - this.waterHeight - 10));
      this.heights[x] = surfaceY;
      for (let y = surfaceY; y < H; y++) {
        const i = this.idx(x, y);
        this.solid[i] = 1;
        const depthT = clamp((y - surfaceY) / 220, 0, 1);
        const ci = i * 4;
        if (y < surfaceY + grassBand) {
          color[ci] = grassColor[0];
          color[ci + 1] = grassColor[1];
          color[ci + 2] = grassColor[2];
        } else {
          color[ci] = lerp(dirtTop[0], dirtBottom[0], depthT);
          color[ci + 1] = lerp(dirtTop[1], dirtBottom[1], depthT);
          color[ci + 2] = lerp(dirtTop[2], dirtBottom[2], depthT);
        }
        color[ci + 3] = 255;
      }
    }
  }

  // --- queries ---------------------------------------------------------

  solidAt(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return false;
    return this.solid[this.idx(xi, yi)] === 1;
  }

  // A "standing zone" is a run of columns whose surface height is roughly
  // flat (within a few px) over at least MIN_SPAWN_SPACING width, and above
  // the water line. Spawnability is a property of the terrain (Req 1.7/2.1).
  findStandingZones() {
    const zones = [];
    const W = this.width;
    const flatTolerance = 10;
    const minRun = 40;

    // A column x is "flat" if the height range across [x, x+minRun) stays
    // within tolerance. Brute-force window min/max (W*minRun is small).
    const flat = new Uint8Array(W);
    for (let x = 0; x + minRun <= W; x++) {
      let mn = Infinity, mx = -Infinity;
      for (let k = 0; k < minRun; k++) {
        const h = this.heights[x + k];
        if (h < mn) mn = h;
        if (h > mx) mx = h;
      }
      if (mx - mn <= flatTolerance) flat[x] = 1;
    }

    // Merge contiguous flat starting-points into zones spanning
    // [runStart, runStart_last + minRun).
    let runStart = -1;
    for (let x = 0; x <= W; x++) {
      const isFlat = x < W && flat[x] === 1;
      if (isFlat && runStart === -1) {
        runStart = x;
      } else if (!isFlat && runStart !== -1) {
        const runEnd = x - 1 + minRun; // exclusive end of the zone
        const clampedEnd = Math.min(runEnd, W);
        let sum = 0, count = 0;
        for (let cx = runStart; cx < clampedEnd; cx++) { sum += this.heights[cx]; count++; }
        const y = sum / count;
        if (y < this.waterY - 20) {
          zones.push({ startX: runStart, endX: clampedEnd, y });
        }
        runStart = -1;
      }
    }
    return zones;
  }

  findSpawnPoints(count) {
    const zones = this._zones && this._zones.length ? this._zones : this.findStandingZones();
    const candidates = [];
    // Sample the *actual* surface height at each candidate x rather than the
    // zone's average height: long merged zones can drift gradually within
    // tolerance, so the average can be several px off at any single column.
    for (const z of zones) {
      const cx = Math.round((z.startX + z.endX) / 2);
      candidates.push({ x: cx, y: this.heightAt(cx) - WORM_RADIUS - 1 });
      // also offer the two quarter points on wide zones for more diversity
      if (z.endX - z.startX > MIN_SPAWN_SPACING * 2) {
        const qx1 = Math.round(lerp(z.startX, z.endX, 0.25));
        const qx2 = Math.round(lerp(z.startX, z.endX, 0.75));
        candidates.push({ x: qx1, y: this.heightAt(qx1) - WORM_RADIUS - 1 });
        candidates.push({ x: qx2, y: this.heightAt(qx2) - WORM_RADIUS - 1 });
      }
    }
    // shuffle deterministically using this.rand, then greedily pick points
    // that satisfy the minimum spacing constraint.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const chosen = [];
    for (const c of candidates) {
      if (chosen.length >= count) break;
      let ok = true;
      for (const p of chosen) {
        if (dist(c.x, c.y, p.x, p.y) < MIN_SPAWN_SPACING) { ok = false; break; }
      }
      if (ok) chosen.push(c);
    }
    // If we still don't have enough (very narrow terrain), relax spacing
    // progressively rather than fail outright.
    let spacing = MIN_SPAWN_SPACING;
    while (chosen.length < count && spacing > 20) {
      spacing -= 10;
      for (const c of candidates) {
        if (chosen.length >= count) break;
        if (chosen.some((p) => dist(c.x, c.y, p.x, p.y) < spacing)) continue;
        if (chosen.some((p) => p.x === c.x && p.y === c.y)) continue;
        chosen.push(c);
      }
    }
    return chosen.slice(0, count);
  }

  // --- mutation ----------------------------------------------------------

  carve(cx, cy, r) {
    const W = this.width;
    const H = this.height;
    const minX = clamp(Math.floor(cx - r), 0, W - 1);
    const maxX = clamp(Math.ceil(cx + r), 0, W - 1);
    const minY = clamp(Math.floor(cy - r), 0, H - 1);
    const maxY = clamp(Math.ceil(cy + r), 0, H - 1);
    const r2 = r * r;
    const rimR = r + 3;
    const rimR2 = rimR * rimR;
    const rimColor = [40, 26, 16];

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        const i = this.idx(x, y);
        if (d2 <= r2) {
          this.solid[i] = 0;
          const ci = i * 4;
          this.color[ci + 3] = 0;
        } else if (d2 <= rimR2 && this.solid[i] === 1) {
          const ci = i * 4;
          this.color[ci] = rimColor[0];
          this.color[ci + 1] = rimColor[1];
          this.color[ci + 2] = rimColor[2];
        }
      }
    }

    // Recompute heights for affected columns (first solid row from top).
    for (let x = minX; x <= maxX; x++) {
      let y = 0;
      while (y < H && this.solid[this.idx(x, y)] === 0) y++;
      this.heights[x] = y < H ? y : H;
    }
  }
}

// ============================================================================
// WORMS: entity factory, physics step, fall damage, team spawning
// ============================================================================

function fallDamage(distance) {
  if (distance <= SAFE_FALL_DIST) return 0;
  return (distance - SAFE_FALL_DIST) * FALL_DAMAGE_K;
}

function createWorm({ id, team, x, y }) {
  return {
    id, team, x, y,
    vx: 0, vy: 0,
    hp: WORM_START_HP,
    facing: 1,
    localAim: -0.35, // angle in [-PI/2, PI/2] relative to the facing direction
    aimAngle: -0.35, // absolute world-space angle, mirrored from localAim by facing
    alive: true,
    atRest: false,
    fallStartY: y,
    dying: false,
    deathTimer: 0,
    drowned: false,
  };
}

// input: { left, right, jump } — `jump` is expected to be a one-frame edge
// (true only on the frame the key was pressed), the caller's input layer is
// responsible for that debouncing.
function stepWormPhysics(worm, terrain, dt, input = {}) {
  if (!worm.alive) return;

  const dir = input.right ? 1 : input.left ? -1 : 0;
  if (dir !== 0) worm.facing = dir;

  if (worm.atRest) {
    if (input.jump) {
      worm.vx = worm.facing * JUMP_VX;
      worm.vy = -JUMP_VY;
      worm.atRest = false;
      worm.fallStartY = worm.y;
    } else if (dir !== 0) {
      const newX = clamp(worm.x + dir * WALK_SPEED * dt, WORM_RADIUS, terrain.width - WORM_RADIUS);
      const curSurface = terrain.heightAt(worm.x);
      const targetSurface = terrain.heightAt(newX);
      const step = targetSurface - curSurface; // positive = downhill, negative = uphill
      if (step < -MAX_STEP) {
        // wall too steep to climb: stop rather than pass through terrain
      } else if (step <= MAX_STEP) {
        worm.x = newX;
        worm.y = targetSurface - WORM_RADIUS;
      } else {
        // ground drops away faster than a climbable step: walk off the edge
        worm.x = newX;
        worm.atRest = false;
        worm.vx = 0;
        worm.vy = 0;
        worm.fallStartY = worm.y;
      }
    }
  }

  if (!worm.atRest) {
    worm.vy += GRAVITY * dt;
    worm.x = clamp(worm.x + worm.vx * dt, WORM_RADIUS, terrain.width - WORM_RADIUS);
    worm.y += worm.vy * dt;
    if (worm.y < worm.fallStartY) worm.fallStartY = worm.y; // track apex

    const groundY = terrain.heightAt(worm.x);
    if (worm.vy >= 0 && worm.y + WORM_RADIUS >= groundY) {
      const landedY = groundY - WORM_RADIUS;
      const fallDist = landedY - worm.fallStartY;
      worm.y = landedY;
      worm.vx = 0;
      worm.vy = 0;
      worm.atRest = true;
      if (fallDist > 0) {
        const dmg = fallDamage(fallDist);
        if (dmg > 0) worm.hp = Math.max(0, worm.hp - dmg);
      }
    }
  }

  if (worm.alive && worm.y + WORM_RADIUS >= terrain.waterY) {
    worm.alive = false;
    worm.atRest = true;
    worm.vx = 0;
    worm.vy = 0;
    worm.drowned = true;
  }
}

const TEAM_COLORS = ['#e6524a', '#3f8ef0'];

function spawnTeams(terrain, names = ['Red Team', 'Blue Team'], options = {}) {
  const points = terrain.findSpawnPoints(8);
  const cpuTeams = options.cpuTeams || [];
  const teams = [];
  for (let t = 0; t < 2; t++) {
    const worms = [];
    for (let w = 0; w < 4; w++) {
      const p = points[t * 4 + w];
      const worm = createWorm({ id: t * 4 + w, team: t, x: p.x, y: p.y });
      worm.atRest = true; // spawn points are already resolved onto the surface
      worms.push(worm);
    }
    teams.push({
      name: names[t] || `Team ${t + 1}`,
      color: TEAM_COLORS[t],
      worms,
      isCpu: cpuTeams.includes(t),
      ammo: { cluster: 3, shotgun: 3, dynamite: 2 },
      activeWormCursor: 0,
    });
  }
  return teams;
}

// ============================================================================
// EXPLOSION RESOLVER — the single choke point for all blast damage
// ============================================================================

const KNOCKBACK_FACTOR = 5.5; // px/s of velocity per point of damage
const SHAKE_FACTOR = 0.006; // screen-shake seconds per px of blast radius

function allWorms(game) {
  const worms = [];
  for (const team of game.teams) {
    for (const w of team.worms) worms.push(w);
  }
  return worms;
}

/**
 * explode(game, x, y, radius, maxDmg)
 * Carves terrain, damages every living worm whose body circle overlaps the
 * blast circle (proximity falloff with a 25%-of-max floor), applies
 * knockback, and records particles/shake/floating damage numbers.
 * No team filtering anywhere in this path — friendly fire is unconditional.
 */
function explode(game, x, y, radius, maxDmg) {
  game.terrain.carve(x, y, radius);

  for (const worm of allWorms(game)) {
    if (!worm.alive) continue;
    const d = dist(worm.x, worm.y, x, y);
    if (d >= radius + WORM_RADIUS) continue; // no body-circle overlap

    const falloff = clamp(1 - d / radius, 0, 1);
    const dmg = Math.max(maxDmg * falloff, 0.25 * maxDmg);
    worm.hp = Math.max(0, worm.hp - dmg);

    if (game.damageNumbers) {
      game.damageNumbers.push({ x: worm.x, y: worm.y, value: Math.round(dmg), age: 0 });
    }

    // Knockback away from the blast center, proportional to damage dealt.
    let dx = worm.x - x;
    let dy = worm.y - y;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= mag;
    dy /= mag;
    const impulse = dmg * KNOCKBACK_FACTOR;
    worm.vx += dx * impulse;
    worm.vy += dy * impulse - impulse * 0.35; // upward bias so blasts loft worms
    worm.atRest = false;
    // fallStartY is recorded AFTER knockback so a knockback-induced fall
    // is measured from here, not from wherever the worm was resting before.
    worm.fallStartY = worm.y;
  }

  if (game.particles) {
    const particleCount = clamp(Math.round(radius / 3), 6, 28);
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * radius * 2.2;
      game.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - radius * 0.5,
        life: 0.4 + Math.random() * 0.5,
        age: 0,
        size: 2 + Math.random() * 3,
        color: Math.random() < 0.5 ? '#ffb347' : '#5a3a24',
      });
    }
  }

  if (game.camera) {
    game.camera.shakeT = Math.max(game.camera.shakeT, radius * SHAKE_FACTOR);
    game.camera.shakeMag = Math.max(game.camera.shakeMag, clamp(radius * 0.18, 2, 22));
  }

  if (typeof playSound === 'function') playSound('explosion', radius);
}

// ============================================================================
// WEAPONS TABLE (data-driven) + PROJECTILE SIMULATION
// ============================================================================

const WEAPONS = Object.freeze({
  bazooka: { key: '1', name: 'Bazooka', ammo: Infinity, charge: true, wind: true, maxDmg: 50, radius: 55, speed: 900 },
  grenade: { key: '2', name: 'Grenade', ammo: Infinity, charge: true, wind: false, fuse: 3, maxDmg: 45, radius: 50, restitution: 0.45, speed: 700 },
  cluster: { key: '3', name: 'Cluster Bomb', ammo: 3, charge: true, wind: false, fuse: 3, maxDmg: 30, radius: 40, restitution: 0.45, speed: 700, bomblets: 5, bombletDmg: 15, bombletRadius: 25 },
  shotgun: { key: '4', name: 'Shotgun', ammo: 3, charge: false, wind: false, dmgPerShot: 25, shots: 2, radius: 18 },
  dynamite: { key: '5', name: 'Dynamite', ammo: 2, charge: false, wind: false, fuse: 3, maxDmg: 75, radius: 80, restitution: 0, speed: 0 },
});

const WEAPON_ORDER = ['bazooka', 'grenade', 'cluster', 'shotgun', 'dynamite'];
const PROJECTILE_HIT_RADIUS = 6; // point-ish collision radius vs worm bodies
const WIND_ACCEL = 1; // wind is stored directly in px/s^2 units
const ARM_DELAY = 0.12; // seconds before a projectile can hit its own firer

function canSelectWeapon(team, kind) {
  const w = WEAPONS[kind];
  if (!w) return false;
  if (!Number.isFinite(w.ammo)) return true;
  return (team.ammo[kind] || 0) > 0;
}

function spawnProjectile(game, kind, worm, power = 1, team) {
  const w = WEAPONS[kind];
  const resolvedTeam = team || (game.teams && worm.team != null ? game.teams[worm.team] : null);
  if (resolvedTeam && Number.isFinite(w.ammo)) {
    if ((resolvedTeam.ammo[kind] || 0) <= 0) return null;
    resolvedTeam.ammo[kind]--;
  }
  const angle = worm.aimAngle || 0;
  const speed = kind === 'dynamite' ? 0 : (w.speed || 700) * clamp(power, 0.05, 1);
  const spawnOffset = WORM_RADIUS + 8;
  const x = worm.x + Math.cos(angle) * spawnOffset;
  const y = worm.y + Math.sin(angle) * spawnOffset;
  const proj = {
    kind,
    x, y, lastX: x, lastY: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: w.radius,
    maxDmg: w.maxDmg,
    impactType: w.fuse != null ? 'fuse' : 'impact',
    affectedByWind: !!w.wind,
    restitution: w.restitution != null ? w.restitution : 0.45,
    fuseRemaining: w.fuse != null ? w.fuse : null,
    age: 0,
    ownerWormId: worm.id,
    ownerTeam: worm.team,
    armed: false,
  };
  game.projectiles.push(proj);
  if (typeof playSound === 'function') playSound('fire');
  return proj;
}

function removeProjectile(game, proj) {
  const i = game.projectiles.indexOf(proj);
  if (i !== -1) game.projectiles.splice(i, 1);
}

function resolveExplosion(game, proj, x, y) {
  explode(game, x, y, proj.radius, proj.maxDmg);
  removeProjectile(game, proj);
}

function resolveFuseExplosion(game, proj) {
  if (proj.kind === 'cluster') {
    explode(game, proj.x, proj.y, proj.radius, proj.maxDmg);
    const w = WEAPONS.cluster;
    for (let i = 0; i < w.bomblets; i++) {
      const spread = (i - (w.bomblets - 1) / 2) * 0.28 + (Math.random() - 0.5) * 0.08;
      const angle = -Math.PI / 2 + spread;
      const speed = 250 + Math.random() * 150;
      game.projectiles.push({
        kind: 'bomblet',
        x: proj.x, y: proj.y, lastX: proj.x, lastY: proj.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        radius: w.bombletRadius, maxDmg: w.bombletDmg,
        impactType: 'impact', affectedByWind: false, restitution: 0.3,
        fuseRemaining: null, age: 0,
        ownerWormId: proj.ownerWormId, ownerTeam: proj.ownerTeam, armed: true,
      });
    }
    removeProjectile(game, proj);
  } else {
    explode(game, proj.x, proj.y, proj.radius, proj.maxDmg);
    removeProjectile(game, proj);
  }
}

function resolveTimeout(game, proj) {
  if (proj.kind === 'cluster') { resolveFuseExplosion(game, proj); return; }
  explode(game, proj.x, proj.y, proj.radius, proj.maxDmg);
  removeProjectile(game, proj);
}

function bounceProjectile(proj) {
  proj.vy = -proj.vy * proj.restitution;
  proj.vx *= 0.82;
  if (Math.abs(proj.vy) < 30) proj.vy = 0;
}

function stepOneProjectile(game, proj, dt) {
  proj.age += dt;
  if (!proj.armed && proj.age > ARM_DELAY) proj.armed = true;

  if (proj.affectedByWind) proj.vx += (game.wind || 0) * WIND_ACCEL * dt;
  proj.vy += GRAVITY * dt;

  const dx = proj.vx * dt;
  const dy = proj.vy * dt;
  const moveDist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(moveDist / 3));

  for (let s = 0; s < steps; s++) {
    const nx = proj.x + dx / steps;
    const ny = proj.y + dy / steps;

    if (nx < -60 || nx > game.terrain.width + 60 || ny < -60 || ny > game.terrain.height + 60) {
      removeProjectile(game, proj);
      return;
    }

    let hitWorm = null;
    if (proj.armed) {
      for (const w of allWorms(game)) {
        if (!w.alive) continue;
        if (w.id === proj.ownerWormId && proj.age < ARM_DELAY) continue;
        if (dist(nx, ny, w.x, w.y) < WORM_RADIUS + PROJECTILE_HIT_RADIUS) { hitWorm = w; break; }
      }
    }
    const hitTerrain = game.terrain.solidAt(nx, ny);

    if (hitWorm && proj.impactType === 'impact') {
      resolveExplosion(game, proj, nx, ny);
      return;
    }
    if (hitTerrain) {
      if (proj.impactType === 'impact') {
        resolveExplosion(game, proj, nx, ny);
        return;
      }
      // fuse-type projectiles bounce off terrain instead of exploding on contact.
      bounceProjectile(proj);
      break;
    }

    proj.lastX = nx; proj.lastY = ny;
    proj.x = nx; proj.y = ny;
  }

  if (proj.fuseRemaining != null) {
    proj.fuseRemaining -= dt;
    if (proj.fuseRemaining <= 0) { resolveFuseExplosion(game, proj); return; }
  }

  if (proj.age >= PROJECTILE_TIMEOUT_SECONDS) {
    resolveTimeout(game, proj);
  }
}

function stepProjectiles(game, dt) {
  for (const proj of [...game.projectiles]) {
    if (game.projectiles.includes(proj)) stepOneProjectile(game, proj, dt);
  }
}

// Shotgun is not a projectile: instant hitscan ray, 2 per turn (Req 5.6).
function fireShotgun(game, worm) {
  const w = WEAPONS.shotgun;
  const angle = worm.aimAngle || 0;
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  let x = worm.x + dirX * (WORM_RADIUS + 2);
  let y = worm.y + dirY * (WORM_RADIUS + 2);
  const step = 2;
  const maxSteps = 1200;
  let hit = null;
  let hitX = x, hitY = y;

  for (let i = 0; i < maxSteps; i++) {
    x += dirX * step;
    y += dirY * step;
    if (x < 0 || x > game.terrain.width || y < 0 || y > game.terrain.height) break;
    let wormHit = null;
    for (const other of allWorms(game)) {
      if (!other.alive || other === worm) continue;
      if (dist(x, y, other.x, other.y) < WORM_RADIUS) { wormHit = other; break; }
    }
    if (wormHit) { hit = { type: 'worm', worm: wormHit }; hitX = x; hitY = y; break; }
    if (game.terrain.solidAt(x, y)) { hit = { type: 'terrain' }; hitX = x; hitY = y; break; }
  }

  if (hit) {
    if (hit.type === 'worm') {
      hit.worm.hp = Math.max(0, hit.worm.hp - w.dmgPerShot);
      if (game.damageNumbers) game.damageNumbers.push({ x: hit.worm.x, y: hit.worm.y, value: w.dmgPerShot, age: 0 });
      game.terrain.carve(hitX, hitY, 6);
    } else {
      game.terrain.carve(hitX, hitY, 10);
    }
  }
  if (typeof playSound === 'function') playSound('shotgun');
  return hit;
}

// ============================================================================
// GAME FACTORY + TURN / STATE MACHINE
// ============================================================================

const MAX_WIND = 120; // px/s^2, HUD shows direction/strength (Req 5.8)

function createGame(mode, options = {}) {
  const terrain = new Terrain();
  const seed = options.seed != null ? options.seed : Math.floor(Math.random() * 1e9);
  terrain.generate(seed);
  // A dedicated RNG stream (distinct from terrain's) drives all gameplay
  // randomness (wind, CPU aim error) so a given seed reproduces a whole
  // match deterministically - important for the CPU aim tests and for
  // debugging a specific reported match.
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const cpuTeams = mode === 'demo' ? [0, 1] : mode === 'cpu' ? [1] : [];
  const teams = spawnTeams(terrain, options.names || ['Red Team', 'Blue Team'], { cpuTeams });

  return {
    state: STATE.TURN_START,
    stateTime: 0,
    mode,
    rng,
    teams,
    activeTeam: options.firstTeam != null ? options.firstTeam : (rng() < 0.5 ? 0 : 1),
    activeWorm: null,
    turnTimer: TURN_SECONDS,
    retreatTimer: 0,
    wind: 0,
    shotsLeft: 0,
    turnCount: 0,
    suddenDeath: false,
    projectiles: [],
    particles: [],
    damageNumbers: [],
    graves: [],
    terrain,
    camera: { shakeT: 0, shakeMag: 0 },
    winner: null,
    draw: false,
    selectedWeapon: 'bazooka',
    chargePower: 0,
    charging: false,
    cpuPhase: null,
    cpuLastTargetByTeam: {},
  };
}

// Persistent per-team cursor that advances past dead worms so every worm
// gets used in turn (Req 3.2) rather than always picking "first living".
function advanceRoundRobin(team) {
  const n = team.worms.length;
  if (!team.worms.some((w) => w.alive)) return null;
  let idx = team.activeWormCursor;
  for (let i = 0; i < n; i++) {
    const w = team.worms[idx];
    if (w.alive) {
      team.activeWormCursor = (idx + 1) % n;
      return w;
    }
    idx = (idx + 1) % n;
  }
  return null;
}

function checkWinDraw(teams) {
  const aliveTeamIdx = [];
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].worms.some((w) => w.alive)) aliveTeamIdx.push(i);
  }
  if (aliveTeamIdx.length === teams.length) return { over: false, draw: false, winner: null };
  if (aliveTeamIdx.length === 0) return { over: true, draw: true, winner: null };
  if (aliveTeamIdx.length === 1) return { over: true, draw: false, winner: aliveTeamIdx[0] };
  return { over: false, draw: false, winner: null };
}

function startTurn(game) {
  if (game.turnCount >= SUDDEN_DEATH_TURN) {
    if (!game.suddenDeath) {
      game.suddenDeath = true;
      for (const team of game.teams) {
        for (const w of team.worms) {
          if (w.alive && w.hp > SUDDEN_DEATH_HP_CAP) w.hp = SUDDEN_DEATH_HP_CAP;
        }
      }
    }
    // y grows downward: rising water means the surface climbs toward
    // smaller y, so waterY decreases each turn while sudden death runs.
    game.terrain.waterY -= SUDDEN_DEATH_WATER_RISE;
  }

  game.stateTime = 0;
  game.turnTimer = TURN_SECONDS;
  game.retreatTimer = 0;
  game.wind = ((game.rng ? game.rng() : Math.random()) * 2 - 1) * MAX_WIND;
  game.shotsLeft = 0;
  game.chargePower = 0;
  game.charging = false;
  game.cpuPhase = null;
  game.activeWorm = advanceRoundRobin(game.teams[game.activeTeam]);
  game.state = STATE.AIMING;
}

function endTurn(game) {
  game.turnCount++;
  const result = checkWinDraw(game.teams);
  if (result.over) {
    game.state = STATE.GAME_OVER;
    game.winner = result.winner;
    game.draw = result.draw;
    return;
  }
  game.activeTeam = (game.activeTeam + 1) % game.teams.length;
  startTurn(game);
}

// ============================================================================
// AIMING (Req 4.5, 4.6)
// ============================================================================

const AIM_SPEED = Math.PI * 0.6; // rad/s

// Local aim is kept in [-PI/2 (up), +PI/2 (down)] relative to the worm's
// facing side; the world-space aimAngle mirrors it when facing is -1 so
// "up" always stays up and "down" always stays down (Req 4.6).
function updateAim(worm, input, dt) {
  if (input.aimUp) worm.localAim -= AIM_SPEED * dt;
  if (input.aimDown) worm.localAim += AIM_SPEED * dt;
  worm.localAim = clamp(worm.localAim, -Math.PI / 2, Math.PI / 2);
  worm.aimAngle = worm.facing === 1 ? worm.localAim : (Math.PI - worm.localAim);
}

// ============================================================================
// TOP-LEVEL PER-TICK GAME STEP (state machine transitions, Req 3, 9)
// ============================================================================

function enterSettling(game) {
  game.state = STATE.SETTLING;
  game.settleTimer = 0;
}

function processDeaths(game, dt) {
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (w.alive && w.hp <= 0 && !w.dying) {
        w.dying = true;
        w.deathTimer = DEATH_FUSE_SECONDS;
      }
    }
  }
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (w.dying) {
        w.deathTimer -= dt;
        if (w.deathTimer <= 0) {
          w.dying = false;
          w.alive = false;
          explode(game, w.x, w.y, DEATH_EXPLOSION_RADIUS, DEATH_EXPLOSION_DAMAGE);
          game.graves.push({ x: w.x, y: w.y });
        }
      }
    }
  }
  let anyDying = false;
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (w.dying || (w.alive && w.hp <= 0)) anyDying = true;
    }
  }
  return anyDying;
}

// Req 9.2: after the settle cap, force positions to a sane resting state
// (snap to ground, or drown) rather than stalling forever.
function forceSettleAll(game) {
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (!w.alive || w.atRest) continue;
      w.vx = 0;
      w.vy = 0;
      const groundY = game.terrain.heightAt(w.x);
      w.y = groundY - WORM_RADIUS;
      w.atRest = true;
      if (w.y + WORM_RADIUS >= game.terrain.waterY) {
        w.alive = false;
        w.drowned = true;
      }
    }
  }
}

function beginFire(game, worm, kind) {
  const team = game.teams[game.activeTeam];
  if (!canSelectWeapon(team, kind)) return false;

  if (kind === 'shotgun') {
    team.ammo.shotgun--;
    game.isShotgunTurn = true;
    game.shotsLeft = WEAPONS.shotgun.shots - 1;
    game.retreatTimer = 0; // hitscan leaves nothing to retreat from (Req 5.6)
    fireShotgun(game, worm);
    game.state = STATE.PROJECTILE;
    return true;
  }

  if (kind === 'dynamite') {
    spawnProjectile(game, 'dynamite', worm, 1, team);
    game.isShotgunTurn = false;
    game.retreatTimer = RETREAT_SECONDS;
    game.state = STATE.PROJECTILE;
    return true;
  }

  // Chargeable weapons: bazooka, grenade, cluster.
  game.state = STATE.CHARGING;
  game.charging = true;
  game.chargePower = 0;
  return true;
}

function releaseCharge(game, worm) {
  const team = game.teams[game.activeTeam];
  const kind = game.selectedWeapon;
  spawnProjectile(game, kind, worm, Math.max(game.chargePower, 0.05), team);
  game.charging = false;
  game.isShotgunTurn = false;
  game.retreatTimer = RETREAT_SECONDS;
  game.state = STATE.PROJECTILE;
}

function stepAiming(game, dt, input) {
  game.turnTimer -= dt;
  const worm = game.activeWorm;

  if (worm && worm.alive) {
    stepWormPhysics(worm, game.terrain, dt, input);
    updateAim(worm, input, dt);
    if (input.weaponSelect && canSelectWeapon(game.teams[game.activeTeam], input.weaponSelect)) {
      game.selectedWeapon = input.weaponSelect;
    }
  }

  // Req 3.7: active worm dies during its own turn (self-damage, drowning) ->
  // end the turn immediately after effects resolve. hp<=0 is the trigger;
  // the alive flag itself flips later once the death-fuse detonation
  // (processDeaths, run during SETTLING) actually resolves it.
  if (worm && (!worm.alive || worm.hp <= 0)) { enterSettling(game); return; }

  if (game.turnTimer <= 0) { enterSettling(game); return; } // Req 3.3 (no charge held)

  if (input.fire && worm && worm.alive) {
    beginFire(game, worm, game.selectedWeapon);
  }
}

function stepCharging(game, dt, input) {
  game.turnTimer -= dt;
  game.chargePower = clamp(game.chargePower + dt / CHARGE_SECONDS, 0, 1);
  const worm = game.activeWorm;

  const timedOut = game.turnTimer <= 0;
  const released = !input.fireHeld;
  const full = game.chargePower >= 1;

  if (timedOut || released || full) {
    releaseCharge(game, worm); // Req 3.3: expiry mid-charge still fires
  }
}

function stepProjectilePhase(game, dt, input) {
  stepProjectiles(game, dt);
  const worm = game.activeWorm;

  if (game.isShotgunTurn) {
    game.turnTimer -= dt; // timer keeps running between the two shots (Req 5.6)
    if (input.fire && game.shotsLeft > 0 && worm && worm.alive) {
      fireShotgun(game, worm);
      game.shotsLeft--;
    }
    if (game.shotsLeft <= 0 || game.turnTimer <= 0) enterSettling(game);
    return;
  }

  if (worm && worm.alive) stepWormPhysics(worm, game.terrain, dt, input); // retreat movement only
  game.retreatTimer -= dt;

  const shotEffectsResolved = game.projectiles.length === 0;
  const wormSettled = !worm || !worm.alive || worm.atRest;
  if ((shotEffectsResolved && wormSettled) || game.retreatTimer <= 0) {
    enterSettling(game);
  }
}

function stepSettlingPhase(game, dt) {
  stepProjectiles(game, dt);
  for (const team of game.teams) {
    for (const w of team.worms) {
      if (w.alive) stepWormPhysics(w, game.terrain, dt, {});
    }
  }
  const anyDying = processDeaths(game, dt);
  game.settleTimer = (game.settleTimer || 0) + dt;

  const allSettled = game.projectiles.length === 0 && !anyDying
    && game.teams.every((t) => t.worms.every((w) => !w.alive || w.atRest));

  if (allSettled || game.settleTimer >= SETTLE_CAP_SECONDS) {
    if (!allSettled) forceSettleAll(game);
    endTurn(game);
  }
}

function stepGame(game, dt, input = {}) {
  game.stateTime += dt;
  const activeTeam = game.teams && game.teams[game.activeTeam];
  const isCpuDeciding = activeTeam && activeTeam.isCpu
    && (game.state === STATE.AIMING || game.state === STATE.CHARGING);
  if (isCpuDeciding) { stepCpuTurn(game, dt); return; }

  switch (game.state) {
    case STATE.AIMING: stepAiming(game, dt, input); break;
    case STATE.CHARGING: stepCharging(game, dt, input); break;
    case STATE.PROJECTILE: stepProjectilePhase(game, dt, input); break;
    case STATE.SETTLING: stepSettlingPhase(game, dt); break;
    default: break; // TITLE / GAME_OVER: driven by menu input, not the sim step
  }
}

// ============================================================================
// CPU OPPONENT (Req 7)
// ============================================================================

const CPU_THINK_SECONDS = 0.8;
const CPU_SIMS_PER_FRAME = 8;
const CPU_SIM_MAX_STEPS = 600; // 10s of simulated flight time, matches the projectile hard timeout
const CPU_SIM_DT = 1 / 60;

// A lightweight, allocation-light re-implementation of projectile flight
// (gravity + optional wind + terrain collision) used only for scoring
// candidate shots. It never mutates real game state.
// Impact weapons (bazooka) explode on first contact, so "closest approach
// during flight" is what matters. Fuse weapons (grenade) bounce and roll
// for the *entire* fuse duration before exploding wherever they end up, so
// scoring by in-flight closest-approach would be wrong - it must simulate
// the full bounce sequence and score the final (explosion) position, or a
// lobbed grenade that merely swings near the target on the way down would
// look "good" even though it then rolls off downhill for 3 more seconds.
function simulateShot(terrain, wind, startX, startY, angle, power, targetX, targetY, weapon) {
  let x = startX, y = startY;
  let vx = Math.cos(angle) * weapon.speed * power;
  let vy = Math.sin(angle) * weapon.speed * power;
  let closest = dist(x, y, targetX, targetY);
  const hasFuse = weapon.fuse != null;
  const totalSteps = hasFuse ? Math.max(1, Math.round(weapon.fuse / CPU_SIM_DT)) : CPU_SIM_MAX_STEPS;
  const restitution = weapon.restitution != null ? weapon.restitution : 0.45;

  for (let i = 0; i < totalSteps; i++) {
    if (weapon.wind) vx += wind * CPU_SIM_DT;
    vy += GRAVITY * CPU_SIM_DT;
    const nx = x + vx * CPU_SIM_DT;
    const ny = y + vy * CPU_SIM_DT;

    if (nx < -20 || nx > terrain.width + 20 || ny > terrain.height + 20) {
      if (!hasFuse) break;
      return Infinity; // sailed off the map before the fuse ran out: a bad shot
    }

    if (ny >= 0 && terrain.solidAt(nx, ny)) {
      if (!hasFuse) {
        const d = dist(nx, ny, targetX, targetY);
        if (d < closest) closest = d;
        break;
      }
      // Bounce in place (mirrors bounceProjectile / stepOneProjectile: never
      // step into solid ground, just reflect velocity and retry next tick).
      vy = -vy * restitution;
      vx *= 0.82;
      if (Math.abs(vy) < 30) vy = 0;
    } else {
      x = nx;
      y = ny;
    }

    const d = dist(x, y, targetX, targetY);
    if (d < closest) closest = d;
  }

  return hasFuse ? dist(x, y, targetX, targetY) : closest;
}

function buildCpuCandidates() {
  const candidates = [];
  const bazooka = WEAPONS.bazooka;
  for (const powerDeg of [50, 65, 80, 95, 100]) {
    for (let deg = -85; deg <= 85; deg += 12) {
      candidates.push({ kind: 'bazooka', weapon: bazooka, localAim: (deg * Math.PI) / 180, power: powerDeg / 100 });
    }
  }
  const grenade = WEAPONS.grenade;
  for (const powerDeg of [45, 60, 75]) {
    for (let deg = -80; deg <= -20; deg += 15) {
      candidates.push({ kind: 'grenade', weapon: grenade, localAim: (deg * Math.PI) / 180, power: powerDeg / 100 });
    }
  }
  return candidates;
}

function pickCpuTarget(game, worm) {
  let best = null, bestD = Infinity;
  for (let ti = 0; ti < game.teams.length; ti++) {
    if (ti === worm.team) continue;
    for (const w of game.teams[ti].worms) {
      if (!w.alive) continue;
      const d = dist(worm.x, worm.y, w.x, w.y);
      if (d < bestD) { bestD = d; best = w; }
    }
  }
  return best;
}

function gaussianRandom(rand) {
  const r = rand || Math.random;
  const u = Math.max(r(), 1e-9);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function finalizeCpuSolution(game, worm) {
  const best = game.cpuBest;
  const teamIx = worm.team;
  const target = game.cpuTarget;
  const repeatTarget = target && game.cpuLastTargetByTeam[teamIx] === target.id;
  const sigma = repeatTarget ? 0.03 : 0.09; // Req 7.2: error shrinks on a repeat target
  if (target) game.cpuLastTargetByTeam[teamIx] = target.id;

  if (!best) {
    // No target / degenerate case: still act (Req 7.3) with a default lob.
    game.cpuSolution = { kind: 'bazooka', localAim: -0.6, power: 0.7 };
    return;
  }
  let localAim = clamp(best.localAim + gaussianRandom(game.rng) * sigma, -Math.PI / 2, Math.PI / 2);
  game.cpuSolution = { kind: best.kind, localAim, power: clamp(best.power, 0.05, 1) };
}

function fireCpuSolution(game, worm) {
  const team = game.teams[game.activeTeam];
  const sol = game.cpuSolution;
  if (sol.kind === 'shotgun') {
    team.ammo.shotgun = Math.max(0, team.ammo.shotgun - 1);
    fireShotgun(game, worm);
    fireShotgun(game, worm);
    game.retreatTimer = 0;
    game.state = STATE.PROJECTILE;
  } else if (sol.kind === 'dynamite') {
    spawnProjectile(game, 'dynamite', worm, 1, team);
    game.retreatTimer = RETREAT_SECONDS;
    game.state = STATE.PROJECTILE;
  } else {
    spawnProjectile(game, sol.kind, worm, sol.power, team);
    game.retreatTimer = RETREAT_SECONDS;
    game.state = STATE.PROJECTILE;
  }
}

// Runs the CPU's phase-scripted turn in place of human input whenever it is
// a CPU team's turn during AIMING/CHARGING: think (visible pause, bounded
// time-sliced shot search) -> aim sweep to the chosen solution -> charge ->
// fire. Reuses the same PROJECTILE/RETREAT/SETTLING machinery afterward
// (Req 7.4), so nothing downstream needs to know who fired.
function stepCpuTurn(game, dt) {
  const worm = game.activeWorm;
  game.turnTimer -= dt;

  if (!worm || !worm.alive || worm.hp <= 0) { enterSettling(game); return; }

  if (game.turnTimer <= 0) {
    // Safety net so the CPU can never stall the timer (Req 7.3, 9.*).
    if (game.cpuSolution) fireCpuSolution(game, worm); else enterSettling(game);
    return;
  }

  if (game.cpuPhase === null) {
    game.cpuPhase = 'THINK';
    game.cpuThinkTime = 0;
    game.cpuCandidates = buildCpuCandidates();
    game.cpuCandidateIx = 0;
    game.cpuBest = null;
    game.cpuTarget = pickCpuTarget(game, worm);
    game.cpuSolution = null;
    // Turn to face the target before building the (facing-relative) shot
    // grid, otherwise every candidate would aim at the wrong hemisphere.
    if (game.cpuTarget) worm.facing = game.cpuTarget.x >= worm.x ? 1 : -1;
  }

  if (game.cpuPhase === 'THINK') {
    game.cpuThinkTime += dt;
    if (game.cpuTarget) {
      let sims = 0;
      while (sims < CPU_SIMS_PER_FRAME && game.cpuCandidateIx < game.cpuCandidates.length) {
        const c = game.cpuCandidates[game.cpuCandidateIx++];
        const absAngle = worm.facing === 1 ? c.localAim : (Math.PI - c.localAim);
        const score = simulateShot(game.terrain, game.wind, worm.x, worm.y, absAngle, c.power, game.cpuTarget.x, game.cpuTarget.y, c.weapon);
        if (!game.cpuBest || score < game.cpuBest.score) game.cpuBest = { ...c, score };
        sims++;
      }
    }
    const searchDone = !game.cpuTarget || game.cpuCandidateIx >= game.cpuCandidates.length;
    if (game.cpuThinkTime >= CPU_THINK_SECONDS && searchDone) {
      finalizeCpuSolution(game, worm);
      game.cpuPhase = 'AIM';
    }
    return;
  }

  if (game.cpuPhase === 'AIM') {
    const sol = game.cpuSolution;
    const diff = sol.localAim - worm.localAim;
    if (Math.abs(diff) < 0.02) {
      worm.localAim = sol.localAim;
      updateAim(worm, {}, 0);
      game.cpuPhase = 'ACT';
    } else {
      worm.localAim = clamp(worm.localAim + Math.sign(diff) * AIM_SPEED * dt, -Math.PI / 2, Math.PI / 2);
      updateAim(worm, {}, 0);
    }
    return;
  }

  if (game.cpuPhase === 'ACT') {
    const sol = game.cpuSolution;
    const weapon = WEAPONS[sol.kind];
    if (!weapon.charge) {
      fireCpuSolution(game, worm);
      return;
    }
    if (game.state !== STATE.CHARGING) {
      game.state = STATE.CHARGING;
      game.chargePower = 0;
    }
    game.chargePower = clamp(game.chargePower + dt / CHARGE_SECONDS, 0, 1);
    if (game.chargePower >= Math.min(sol.power, 1) - 1e-3) {
      fireCpuSolution(game, worm);
    }
  }
}

// ============================================================================
// COMMONJS EXPORT GUARD (inert in the browser; `module` is undefined there)
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WORLD_W, WORLD_H, GRAVITY, WORM_RADIUS, MAX_STEP, WALK_SPEED,
    SAFE_FALL_DIST, FALL_DAMAGE_K, MIN_STANDING_ZONES, MIN_SPAWN_SPACING,
    TURN_SECONDS, RETREAT_SECONDS, SETTLE_CAP_SECONDS,
    PROJECTILE_TIMEOUT_SECONDS, SUDDEN_DEATH_TURN, SUDDEN_DEATH_HP_CAP,
    SUDDEN_DEATH_WATER_RISE, WORM_START_HP, DEATH_FUSE_SECONDS,
    DEATH_EXPLOSION_DAMAGE, DEATH_EXPLOSION_RADIUS, CHARGE_SECONDS, FIXED_DT,
    JUMP_VX, JUMP_VY, STATE,
    clamp, dist, lerp, mulberry32,
    Terrain,
    fallDamage, createWorm, stepWormPhysics, spawnTeams, TEAM_COLORS,
    allWorms, explode,
    WEAPONS, WEAPON_ORDER, canSelectWeapon, spawnProjectile, stepProjectiles,
    fireShotgun,
    MAX_WIND, createGame, advanceRoundRobin, checkWinDraw, startTurn, endTurn,
    AIM_SPEED, updateAim, stepGame, processDeaths, enterSettling,
    simulateShot, buildCpuCandidates, pickCpuTarget, stepCpuTurn,
  };
}
