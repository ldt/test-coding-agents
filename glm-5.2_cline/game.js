/* =========================================================================
 * Worms — HTML Edition
 * Vanilla JS implementation of a 2D turn-based artillery game.
 *
 * Sections:
 *   1. Config & constants
 *   2. Utilities
 *   3. Terrain
 *   4. Worms & physics
 *   5. Weapons & explosions
 *   6. Game state & turn flow
 *   7. Input handling
 *   8. Rendering
 *   9. UI sync
 *  10. Game loop & init
 * ========================================================================= */

(() => {
'use strict';

/* ============================ 1. Config & constants ===================== */

const W = 1280;            // canvas logical width
const H = 720;             // canvas logical height
const GRAVITY = 0.42;      // px / frame^2
const WORM_RADIUS = 9;
const WORM_HP = 100;
const WORMS_PER_TEAM = 4;
const TURN_TIME = 45;      // seconds
const POST_TURN_DELAY = 3; // seconds
const MAX_WALK = 90;       // px per turn
const WALK_SPEED = 2.2;
const FALL_DAMAGE_THRESHOLD = 7;   // vy above this on landing => damage
const FALL_DAMAGE_FACTOR = 2.2;

const TEAM_COLORS = ['#e74c3c', '#3498db'];
const TEAM_NAMES = ['Red Team', 'Blue Team'];
const WORM_NAMES = ['Spy', 'Banger', 'Tricky', 'Munchkin', 'Fritz', 'Noodle', 'Gizmo', 'Pip'];

const WEAPONS = [
  { name: 'Bazooka',  radius: 42, damage: 48, color: '#ffd24a' },
  { name: 'Grenade',  radius: 38, damage: 42, color: '#7bd16b' },
  { name: 'Shotgun',  radius: 0,  damage: 0,  color: '#ffffff' }, // handled specially
  { name: 'Airstrike',radius: 34, damage: 38, color: '#ff8c42' },
];

/* ============================ 2. Utilities ============================== */

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const TAU = Math.PI * 2;

/* ============================ 3. Terrain =============================== */

class Terrain {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.img = null; // ImageData buffer
    this.generate();
  }

  /* Procedural heightmap generation using layered sine waves + noise. */
  generate() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Build heightmap
    const heights = new Float32Array(W);
    const base = H * 0.62;
    const amp1 = rand(60, 110), freq1 = rand(0.004, 0.009), off1 = rand(0, TAU);
    const amp2 = rand(25, 55),  freq2 = rand(0.012, 0.025), off2 = rand(0, TAU);
    const amp3 = rand(8, 18),   freq3 = rand(0.04, 0.08),  off3 = rand(0, TAU);
    for (let x = 0; x < W; x++) {
      let h = base;
      h += Math.sin(x * freq1 + off1) * amp1;
      h += Math.sin(x * freq2 + off2) * amp2;
      h += Math.sin(x * freq3 + off3) * amp3;
      h += rand(-4, 4); // noise
      heights[x] = clamp(h, H * 0.25, H * 0.92);
    }

    // Draw terrain body with a grass top + dirt gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#6ab04c');
    grad.addColorStop(0.04, '#5a9a3c');
    grad.addColorStop(0.12, '#7a5230');
    grad.addColorStop(1, '#3a2412');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, heights[x]);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Store ImageData for collision + destruction
    this.img = ctx.getImageData(0, 0, W, H);
    this.heights = heights;
  }

  /* Returns true if the pixel at (x,y) is solid (alpha > 0). */
  isSolid(x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const idx = (Math.floor(y) * W + Math.floor(x)) * 4 + 3;
    return this.img.data[idx] > 0;
  }

  /* Erase a circular region — terrain destruction. */
  eraseCircle(cx, cy, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Update ImageData buffer
    this.img = ctx.getImageData(0, 0, W, H);
  }

  /* Find the topmost solid pixel at column x (for worm placement). */
  findSurface(x) {
    x = Math.floor(x);
    if (x < 0 || x >= W) return H - 1;
    const data = this.img.data;
    for (let y = 0; y < H; y++) {
      if (data[(y * W + x) * 4 + 3] > 0) return y;
    }
    return H - 1;
  }
}

/* ============================ 4. Worms & physics ======================= */

function createWorm(x, y, team, name) {
  return {
    x, y, vx: 0, vy: 0,
    hp: WORM_HP, team, name,
    alive: true, radius: WORM_RADIUS,
    facing: 1,
    walkUsed: 0,
    onGround: false,
    deathExplosion: false,
  };
}

/* Apply gravity + terrain collision to a worm. */
function updateWormPhysics(worm, terrain) {
  if (!worm.alive) return;

  // Gravity
  worm.vy += GRAVITY;
  worm.x += worm.vx;
  worm.y += worm.vy;

  // Horizontal friction
  worm.vx *= 0.8;

  // Off bottom => death
  if (worm.y > H + 40) {
    killWorm(worm, false);
    return;
  }

  // Terrain collision: check below the worm
  const checkX = clamp(Math.floor(worm.x), 0, W - 1);
  const surfaceY = terrain.findSurface(checkX);

  if (worm.y + worm.radius >= surfaceY) {
    // Landed
    const landedHard = worm.vy > FALL_DAMAGE_THRESHOLD;
    worm.y = surfaceY - worm.radius;
    if (landedHard) {
      const dmg = Math.floor((worm.vy - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_FACTOR);
      if (dmg > 0) damageWorm(worm, dmg);
    }
    worm.vy = 0;
    worm.vx *= 0.5;
    worm.onGround = true;
  } else {
    worm.onGround = false;
  }

  // Side walls (keep in bounds)
  if (worm.x < worm.radius) { worm.x = worm.radius; worm.vx = 0; }
  if (worm.x > W - worm.radius) { worm.x = W - worm.radius; worm.vx = 0; }
}

function killWorm(worm, withExplosion = true) {
  if (!worm.alive) return;
  worm.alive = false;
  worm.hp = 0;
  if (withExplosion) {
    spawnExplosion(worm.x, worm.y, 30, 25);
  }
}

function damageWorm(worm, dmg) {
  if (!worm.alive) return;
  worm.hp -= dmg;
  if (worm.hp <= 0) {
    worm.hp = 0;
    killWorm(worm, true);
  }
}

/* ============================ 5. Weapons & explosions ================== */

const projectiles = [];
const explosions = [];
const pendingAirstrikes = []; // { x, delay }

function spawnExplosion(x, y, radius, maxDamage) {
  explosions.push({ x, y, radius, maxRadius: radius, life: 0, maxLife: 28 });
  Game.terrain.eraseCircle(x, y, radius);

  // Damage + knockback worms
  for (const team of Game.teams) {
    for (const worm of team) {
      if (!worm.alive) continue;
      const d = dist(x, y, worm.x, worm.y);
      if (d < radius + worm.radius) {
        const factor = 1 - clamp(d / (radius + worm.radius), 0, 1);
        const dmg = Math.floor(maxDamage * factor);
        if (dmg > 0) damageWorm(worm, dmg);
        // Knockback
        const ang = Math.atan2(worm.y - y, worm.x - x);
        const kb = factor * 9;
        worm.vx += Math.cos(ang) * kb;
        worm.vy += Math.sin(ang) * kb - 2;
      }
    }
  }
}

function fireWeapon(weaponIndex, fromX, fromY, angle, power) {
  const speed = 6 + (power / 100) * 16;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const owner = Game.currentTeamIndex;

  switch (weaponIndex) {
    case 0: { // Bazooka
      projectiles.push({
        type: 'bazooka', x: fromX, y: fromY, vx, vy,
        radius: 5, color: WEAPONS[0].color, owner,
        windAffected: true, bounces: false, fuse: -1,
      });
      break;
    }
    case 1: { // Grenade
      projectiles.push({
        type: 'grenade', x: fromX, y: fromY, vx, vy,
        radius: 5, color: WEAPONS[1].color, owner,
        windAffected: false, bounces: true, fuse: 180, // 3s @ 60fps
      });
      break;
    }
    case 2: { // Shotgun — instant raycast with spread
      fireShotgun(fromX, fromY, angle);
      // No projectile; go straight to post-turn after a brief moment
      Game.shotgunFired = true;
      break;
    }
    case 3: { // Airstrike — target x at cursor
      const targetX = Game.mouseX;
      pendingAirstrikes.push({ x: targetX, delay: 120 }); // 2s
      break;
    }
  }
}

function fireShotgun(fromX, fromY, angle) {
  const range = 360;
  const pellets = 6;
  const spread = 0.12;
  const dmgPerPellet = 9;

  for (let i = 0; i < pellets; i++) {
    const a = angle + rand(-spread, spread);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // Step along the ray, check terrain + worms
    let hitX = fromX + dx * range;
    let hitY = fromY + dy * range;
    for (let t = 8; t < range; t += 4) {
      const px = fromX + dx * t;
      const py = fromY + dy * t;
      if (Game.terrain.isSolid(px, py)) { hitX = px; hitY = py; break; }
      // Check worm hit
      let hitWorm = false;
      for (const team of Game.teams) {
        for (const worm of team) {
          if (!worm.alive) continue;
          if (dist(px, py, worm.x, worm.y) < worm.radius + 2) {
            damageWorm(worm, dmgPerPellet);
            // small knockback
            worm.vx += dx * 4;
            worm.vy += dy * 4 - 1;
            hitWorm = true;
            break;
          }
        }
        if (hitWorm) break;
      }
      if (hitWorm) { hitX = px; hitY = py; break; }
    }
    // Visual tracer
    Game.tracers.push({ x1: fromX, y1: fromY, x2: hitX, y2: hitY, life: 12 });
  }
  // Small terrain scar at impact area (cosmetic)
  // (No terrain destruction for shotgun per design — keeps it balanced)
}

function updateProjectiles() {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    // Physics
    p.vy += GRAVITY;
    if (p.windAffected) p.vx += Game.wind.dir * Game.wind.mag * 0.03;
    p.x += p.vx;
    p.y += p.vy;

    // Fuse
    if (p.fuse >= 0) {
      p.fuse--;
      if (p.fuse <= 0) {
        spawnExplosion(p.x, p.y, WEAPONS[1].radius, WEAPONS[1].damage);
        projectiles.splice(i, 1);
        continue;
      }
    }

    // Out of bounds horizontally or below
    if (p.x < -50 || p.x > W + 50 || p.y > H + 50) {
      projectiles.splice(i, 1);
      continue;
    }

    // Terrain collision
    if (Game.terrain.isSolid(p.x, p.y)) {
      if (p.bounces) {
        // Determine bounce normal by sampling neighbors
        const solidL = Game.terrain.isSolid(p.x - 3, p.y);
        const solidR = Game.terrain.isSolid(p.x + 3, p.y);
        const solidU = Game.terrain.isSolid(p.x, p.y - 3);
        const solidD = Game.terrain.isSolid(p.x, p.y + 3);
        if (solidD && !solidU) { p.vy = -Math.abs(p.vy) * 0.5; p.vx *= 0.7; }
        else if (solidU && !solidD) { p.vy = Math.abs(p.vy) * 0.5; }
        else if (solidR && !solidL) { p.vx = -Math.abs(p.vx) * 0.5; p.vy *= 0.8; }
        else if (solidL && !solidR) { p.vx = Math.abs(p.vx) * 0.5; p.vy *= 0.8; }
        else { p.vx *= -0.5; p.vy *= -0.5; }
        // Nudge out of terrain
        p.y -= 2;
        // Low energy => explode
        if (Math.hypot(p.vx, p.vy) < 1.5) {
          spawnExplosion(p.x, p.y, WEAPONS[1].radius, WEAPONS[1].damage);
          projectiles.splice(i, 1);
          continue;
        }
      } else {
        // Bazooka: explode on contact
        spawnExplosion(p.x, p.y, WEAPONS[0].radius, WEAPONS[0].damage);
        projectiles.splice(i, 1);
        continue;
      }
    }

    // Worm collision (for non-bouncing projectiles, explode; for grenade, explode too)
    let hitWorm = false;
    for (const team of Game.teams) {
      for (const worm of team) {
        if (!worm.alive) continue;
        if (dist(p.x, p.y, worm.x, worm.y) < worm.radius + p.radius) {
          hitWorm = true;
          break;
        }
      }
      if (hitWorm) break;
    }
    if (hitWorm) {
      const w = WEAPONS[p.type === 'bazooka' ? 0 : 1];
      spawnExplosion(p.x, p.y, w.radius, w.damage);
      projectiles.splice(i, 1);
    }
  }
}

function updateAirstrikes() {
  for (let i = pendingAirstrikes.length - 1; i >= 0; i--) {
    const a = pendingAirstrikes[i];
    a.delay--;
    if (a.delay <= 0) {
      // Spawn 3 falling bombs with slight spread
      for (let b = 0; b < 3; b++) {
        const bx = a.x + (b - 1) * 28 + rand(-6, 6);
        projectiles.push({
          type: 'bomb', x: bx, y: -20, vx: 0, vy: 3,
          radius: 5, color: WEAPONS[3].color, owner: Game.currentTeamIndex,
          windAffected: false, bounces: false, fuse: -1,
          bombRadius: WEAPONS[3].radius, bombDamage: WEAPONS[3].damage,
        });
      }
      pendingAirstrikes.splice(i, 1);
    }
  }
}

function updateExplosions() {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.life++;
    if (e.life >= e.maxLife) explosions.splice(i, 1);
  }
}

/* ============================ 6. Game state & turn flow ================ */

const Game = {
  terrain: null,
  teams: [[], []],
  currentTeamIndex: 0,
  currentWormIndex: 0,
  phase: 'aiming',   // aiming | charging | projectile | postturn | gameover
  selectedWeapon: 0,
  power: 0,
  charging: false,
  aimAngle: -Math.PI / 4,
  mouseX: W / 2, mouseY: H / 2,
  wind: { dir: 1, mag: 0 },
  turnTimer: TURN_TIME,
  postTimer: 0,
  walkKeys: { left: false, right: false },
  tracers: [],
  shotgunFired: false,
  lastTime: 0,
};

function initGame() {
  Game.terrain = new Terrain();
  Game.teams = [[], []];
  Game.phase = 'aiming';
  Game.selectedWeapon = 0;
  Game.power = 0;
  Game.charging = false;
  Game.aimAngle = -Math.PI / 4;
  Game.wind = randomizeWind();
  Game.turnTimer = TURN_TIME;
  Game.postTimer = 0;
  Game.tracers = [];
  Game.shotgunFired = false;
  projectiles.length = 0;
  explosions.length = 0;
  pendingAirstrikes.length = 0;

  // Place worms on terrain surface, spread across the map
  const slots = WORMS_PER_TEAM * 2;
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i < WORMS_PER_TEAM; i++) {
      const slot = t * WORMS_PER_TEAM + i;
      const x = ((slot + 0.5) / slots) * W + rand(-30, 30);
      const surfY = Game.terrain.findSurface(x);
      const worm = createWorm(x, surfY - WORM_RADIUS, t, WORM_NAMES[slot] || `W${slot}`);
      Game.teams[t].push(worm);
    }
  }

  // Set indices so startTurn() lands on worm 0 of team 0
  Game.currentTeamIndex = 0;
  Game.currentWormIndex = Game.teams[0].length - 1;

  document.getElementById('gameover').classList.add('hidden');
  startTurn();
}

function randomizeWind() {
  return { dir: Math.random() < 0.5 ? -1 : 1, mag: randi(0, 6) };
}

function activeWorm() {
  return Game.teams[Game.currentTeamIndex][Game.currentWormIndex];
}

function startTurn() {
  // Pick next worm in current team (team already advanced at end of previous turn)
  Game.currentWormIndex = (Game.currentWormIndex + 1) % Game.teams[Game.currentTeamIndex].length;
  // Ensure the chosen worm is alive
  let safety = 0;
  while (!activeWorm().alive && safety < 50) {
    Game.currentWormIndex = (Game.currentWormIndex + 1) % Game.teams[Game.currentTeamIndex].length;
    safety++;
  }
  const w = activeWorm();
  w.walkUsed = 0;
  w.vx = 0; w.vy = 0;
  Game.phase = 'aiming';
  Game.power = 0;
  Game.charging = false;
  Game.turnTimer = TURN_TIME;
  Game.wind = randomizeWind();
  Game.selectedWeapon = 0;
  updateWeaponUI();
  syncUI();
}

function nextTeam() {
  Game.currentTeamIndex = (Game.currentTeamIndex + 1) % 2;
  // Reset worm index so startTurn advances to first alive worm
  Game.currentWormIndex = (Game.currentWormIndex) % Game.teams[Game.currentTeamIndex].length;
}

function checkWin() {
  const alive0 = Game.teams[0].some(w => w.alive);
  const alive1 = Game.teams[1].some(w => w.alive);
  if (!alive0 || !alive1) {
    Game.phase = 'gameover';
    const winner = alive0 ? 0 : 1;
    showGameOver(winner);
    return true;
  }
  return false;
}

function endTurn() {
  if (checkWin()) return;
  nextTeam();
  startTurn();
}

function skipTurn() {
  if (Game.phase !== 'aiming' && Game.phase !== 'charging') return;
  Game.charging = false;
  Game.power = 0;
  Game.phase = 'postturn';
  Game.postTimer = POST_TURN_DELAY;
  syncUI();
}

/* ============================ 7. Input handling ======================== */

function setupInput(canvas) {
  const rectOf = () => canvas.getBoundingClientRect();

  canvas.addEventListener('mousemove', (e) => {
    const r = rectOf();
    const scaleX = W / r.width;
    const scaleY = H / r.height;
    Game.mouseX = (e.clientX - r.left) * scaleX;
    Game.mouseY = (e.clientY - r.top) * scaleY;
    if (Game.phase === 'aiming' || Game.phase === 'charging') {
      const w = activeWorm();
      if (w && w.alive) {
        Game.aimAngle = Math.atan2(Game.mouseY - w.y, Game.mouseX - w.x);
        w.facing = Math.cos(Game.aimAngle) >= 0 ? 1 : -1;
      }
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (Game.phase === 'aiming') {
      Game.charging = true;
      Game.phase = 'charging';
      Game.power = 0;
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (Game.phase === 'charging') {
      const w = activeWorm();
      if (w && w.alive) {
        const muzzleX = w.x + Math.cos(Game.aimAngle) * (w.radius + 4);
        const muzzleY = w.y + Math.sin(Game.aimAngle) * (w.radius + 4);
        fireWeapon(Game.selectedWeapon, muzzleX, muzzleY, Game.aimAngle, Game.power);
        Game.charging = false;
        if (Game.selectedWeapon === 2) {
          // Shotgun: no projectile, short post-turn
          Game.phase = 'postturn';
          Game.postTimer = 1.5;
        } else if (Game.selectedWeapon === 3) {
          // Airstrike: wait for bombs to land
          Game.phase = 'projectile';
        } else {
          Game.phase = 'projectile';
        }
        Game.power = 0;
        syncUI();
      }
    }
  });

  // Prevent context menu on canvas
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case '1': case '2': case '3': case '4':
        selectWeapon(parseInt(e.key, 10) - 1);
        break;
      case ' ':
      case 'Enter':
        if (Game.phase === 'aiming' || Game.phase === 'charging') skipTurn();
        e.preventDefault();
        break;
      case 'r': case 'R':
        if (Game.phase === 'gameover') initGame();
        break;
      case 'a': case 'A': case 'ArrowLeft':
        Game.walkKeys.left = true;
        break;
      case 'd': case 'D': case 'ArrowRight':
        Game.walkKeys.right = true;
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.key) {
      case 'a': case 'A': case 'ArrowLeft':
        Game.walkKeys.left = false;
        break;
      case 'd': case 'D': case 'ArrowRight':
        Game.walkKeys.right = false;
        break;
    }
  });

  // Weapon buttons
  document.querySelectorAll('.weapon-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectWeapon(parseInt(btn.dataset.weapon, 10));
    });
  });

  document.getElementById('skip-btn').addEventListener('click', skipTurn);
  document.getElementById('play-again').addEventListener('click', initGame);
}

function selectWeapon(i) {
  if (i < 0 || i > 3) return;
  Game.selectedWeapon = i;
  updateWeaponUI();
}

function updateWeaponUI() {
  document.querySelectorAll('.weapon-btn').forEach((btn) => {
    const idx = parseInt(btn.dataset.weapon, 10);
    btn.classList.toggle('selected', idx === Game.selectedWeapon);
  });
}

/* Handle walking during aiming phase. */
function handleWalking() {
  if (Game.phase !== 'aiming' && Game.phase !== 'charging') return;
  const w = activeWorm();
  if (!w || !w.alive || !w.onGround) return;
  let dir = 0;
  if (Game.walkKeys.left) dir = -1;
  if (Game.walkKeys.right) dir = 1;
  if (dir === 0) return;
  if (w.walkUsed >= MAX_WALK) return;
  const step = dir * WALK_SPEED;
  w.x += step;
  w.walkUsed += Math.abs(step);
  w.facing = dir;
  // Snap to surface
  const surfY = Game.terrain.findSurface(w.x);
  w.y = surfY - w.radius;
  // Update aim to follow facing direction roughly
  Game.aimAngle = Math.atan2(Game.mouseY - w.y, Game.mouseX - w.x);
}

/* ============================ 8. Rendering ============================= */

function render(ctx) {
  // Sky gradient background
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1a2a4a');
  sky.addColorStop(0.5, '#3a6a9a');
  sky.addColorStop(1, '#9ec5e8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Distant clouds (simple)
  drawClouds(ctx);

  // Terrain
  ctx.drawImage(Game.terrain.canvas, 0, 0);

  // Tracers (shotgun)
  for (let i = Game.tracers.length - 1; i >= 0; i--) {
    const t = Game.tracers[i];
    ctx.strokeStyle = `rgba(255,240,180,${t.life / 12})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(t.x1, t.y1);
    ctx.lineTo(t.x2, t.y2);
    ctx.stroke();
    t.life--;
    if (t.life <= 0) Game.tracers.splice(i, 1);
  }

  // Worms
  for (let t = 0; t < 2; t++) {
    for (const worm of Game.teams[t]) {
      if (!worm.alive) continue;
      drawWorm(ctx, worm, t === Game.currentTeamIndex && worm === activeWorm());
    }
  }

  // Projectiles
  for (const p of projectiles) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, TAU);
    ctx.fill();
    // Grenade: draw fuse indicator
    if (p.type === 'grenade' && p.fuse >= 0) {
      const fuseFrac = p.fuse / 180;
      ctx.strokeStyle = `rgba(255,80,80,${1 - fuseFrac})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 3, 0, TAU * (1 - fuseFrac));
      ctx.stroke();
    }
  }

  // Airstrike target marker
  if (Game.phase === 'projectile' && pendingAirstrikes.length > 0) {
    for (const a of pendingAirstrikes) {
      ctx.strokeStyle = 'rgba(255,140,66,0.8)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, 0);
      ctx.lineTo(a.x, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Explosions
  for (const e of explosions) {
    const frac = e.life / e.maxLife;
    const r = e.maxRadius * (0.4 + frac * 0.9);
    const alpha = 1 - frac;
    const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
    grad.addColorStop(0, `rgba(255,255,200,${alpha})`);
    grad.addColorStop(0.4, `rgba(255,160,40,${alpha * 0.8})`);
    grad.addColorStop(1, `rgba(120,40,10,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, TAU);
    ctx.fill();
  }

  // Aim line + power arc
  if ((Game.phase === 'aiming' || Game.phase === 'charging') && activeWorm() && activeWorm().alive) {
    const w = activeWorm();
    const len = 70;
    const ax = w.x + Math.cos(Game.aimAngle) * len;
    const ay = w.y + Math.sin(Game.aimAngle) * len;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w.x, w.y);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    // Arrowhead
    const ah = 8;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(Game.aimAngle - 0.4) * ah, ay - Math.sin(Game.aimAngle - 0.4) * ah);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(Game.aimAngle + 0.4) * ah, ay - Math.sin(Game.aimAngle + 0.4) * ah);
    ctx.stroke();

    // Power bar (arc above worm)
    if (Game.phase === 'charging') {
      const pw = Game.power / 100;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(w.x, w.y - w.radius - 14, 16, Math.PI, Math.PI * 2);
      ctx.stroke();
      const hue = 120 - pw * 120; // green -> red
      ctx.strokeStyle = `hsl(${hue},90%,55%)`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(w.x, w.y - w.radius - 14, 16, Math.PI, Math.PI + Math.PI * pw);
      ctx.stroke();
    }
  }

  // Wind indicator (top center, drawn on canvas as well for clarity)
  drawWindIndicator(ctx);
}

function drawClouds(ctx) {
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const t = performance.now() / 1000;
  for (let i = 0; i < 4; i++) {
    const cx = ((t * (8 + i * 3) + i * 320) % (W + 200)) - 100;
    const cy = 60 + i * 40;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, TAU);
    ctx.arc(cx + 28, cy + 6, 22, 0, TAU);
    ctx.arc(cx - 26, cy + 8, 20, 0, TAU);
    ctx.fill();
  }
}

function drawWorm(ctx, worm, isActive) {
  const color = TEAM_COLORS[worm.team];
  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(worm.x, worm.y, worm.radius, 0, TAU);
  ctx.fill();
  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Eyes (facing direction)
  const ex = worm.x + worm.facing * 3;
  const ey = worm.y - 2;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ex, ey, 3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(ex + worm.facing * 1, ey, 1.5, 0, TAU);
  ctx.fill();

  // Active highlight ring
  if (isActive) {
    ctx.strokeStyle = '#ffe24a';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(worm.x, worm.y, worm.radius + 5, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Health bar
  const barW = 34, barH = 5;
  const bx = worm.x - barW / 2;
  const by = worm.y - worm.radius - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#3a3';
  const hpFrac = clamp(worm.hp / WORM_HP, 0, 1);
  ctx.fillStyle = hpFrac > 0.5 ? '#4caf50' : hpFrac > 0.25 ? '#ffb300' : '#e53935';
  ctx.fillRect(bx, by, barW * hpFrac, barH);

  // Name
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(worm.name, worm.x, by - 4);
  ctx.textAlign = 'left';
}

function drawWindIndicator(ctx) {
  const cx = W / 2, cy = 34;
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,32,0.6)';
  ctx.fillRect(cx - 70, cy - 16, 140, 32);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(cx - 70, cy - 16, 140, 32);
  ctx.fillStyle = '#fff';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Wind', cx, cy - 2);
  // Arrow
  const mag = Game.wind.mag;
  const dir = Game.wind.dir;
  const ax = cx + dir * 30;
  ctx.strokeStyle = '#ffd24a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - dir * 20, cy + 8);
  ctx.lineTo(ax, cy + 8);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(ax, cy + 8);
  ctx.lineTo(ax - dir * 7, cy + 4);
  ctx.moveTo(ax, cy + 8);
  ctx.lineTo(ax - dir * 7, cy + 12);
  ctx.stroke();
  ctx.fillText(`${mag}`, cx, cy + 12);
  ctx.restore();
  ctx.textAlign = 'left';
}

/* ============================ 9. UI sync =============================== */

function syncUI() {
  const teamNameEl = document.getElementById('team-name');
  const wormNameEl = document.getElementById('worm-name');
  const timerEl = document.getElementById('timer');
  const windArrowEl = document.getElementById('wind-arrow');
  const windMagEl = document.getElementById('wind-mag');

  teamNameEl.textContent = TEAM_NAMES[Game.currentTeamIndex];
  teamNameEl.className = `team-label team-${Game.currentTeamIndex}`;
  const w = activeWorm();
  wormNameEl.textContent = w ? w.name : '—';

  timerEl.textContent = Math.ceil(Game.turnTimer);
  timerEl.classList.toggle('warn', Game.turnTimer <= 10);

  windArrowEl.textContent = Game.wind.dir > 0 ? '→' : '←';
  windMagEl.textContent = Game.wind.mag;

  updateWeaponUI();
}

function showGameOver(winner) {
  const overlay = document.getElementById('gameover');
  const text = document.getElementById('winner-text');
  text.textContent = `${TEAM_NAMES[winner]} Wins!`;
  text.style.color = TEAM_COLORS[winner];
  overlay.classList.remove('hidden');
}

/* ============================ 10. Game loop & init ===================== */

function update(dt) {
  // Charging power
  if (Game.phase === 'charging') {
    Game.power = clamp(Game.power + dt * 80, 0, 100);
  }

  // Walking
  handleWalking();

  // Turn timer
  if (Game.phase === 'aiming' || Game.phase === 'charging') {
    Game.turnTimer -= dt;
    if (Game.turnTimer <= 0) {
      skipTurn();
    }
  }

  // Physics for worms (always, so knockback/falls resolve)
  for (const team of Game.teams) {
    for (const worm of team) {
      if (worm.alive) updateWormPhysics(worm, Game.terrain);
    }
  }

  // Projectiles
  if (Game.phase === 'projectile') {
    updateProjectiles();
    updateAirstrikes();
    // Transition to post-turn when everything settled
    if (projectiles.length === 0 && pendingAirstrikes.length === 0) {
      Game.phase = 'postturn';
      Game.postTimer = POST_TURN_DELAY;
    }
  }

  // Shotgun fired (no projectile) -> postturn handled in mouseup, but also safety
  if (Game.shotgunFired && Game.tracers.length === 0 && Game.phase === 'postturn') {
    // nothing extra needed
  }

  // Post-turn delay
  if (Game.phase === 'postturn') {
    Game.postTimer -= dt;
    if (Game.postTimer <= 0) {
      endTurn();
    }
  }

  // Explosions lifecycle
  updateExplosions();

  // Sync timer display each frame (cheap)
  if (Game.phase === 'aiming' || Game.phase === 'charging') {
    document.getElementById('timer').textContent = Math.ceil(Game.turnTimer);
    document.getElementById('timer').classList.toggle('warn', Game.turnTimer <= 10);
  }
}

function loop(ts) {
  if (!Game.lastTime) Game.lastTime = ts;
  const dt = Math.min(0.05, (ts - Game.lastTime) / 1000);
  Game.lastTime = ts;

  update(dt);

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  render(ctx);

  requestAnimationFrame(loop);
}

function main() {
  const canvas = document.getElementById('game');
  canvas.width = W;
  canvas.height = H;
  setupInput(canvas);
  initGame();
  requestAnimationFrame(loop);
}

// Expose Game for debugging/testing
window.Game = Game;

window.addEventListener('load', main);

})();