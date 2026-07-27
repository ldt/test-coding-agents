const GRAVITY = 500;
const WIND_RANGE = 200;
const EXPLOSION_RADIUS = 60;
const EXPLOSION_DAMAGE = 50;
const WORM_SPEED = 60;
const JUMP_VELOCITY = -280;
const TURN_TIME = 30;
const MAX_POWER = 600;
const CHARGE_RATE = 300;
const AI_DELAY = 800;
const WORM_RADIUS = 12;
const WORLD_WIDTH = 2000;

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let W, H;

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  W = canvas.width;
  H = canvas.height;
}
window.addEventListener('resize', resize);
resize();

class Terrain {
  constructor() {
    this.heights = new Float32Array(WORLD_WIDTH);
    this.waterLevel = H - 60;
    this.generate();
  }

  generate() {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const n1 = Math.sin(x * 0.003) * 80;
      const n2 = Math.sin(x * 0.007 + 1.3) * 50;
      const n3 = Math.sin(x * 0.015 + 2.7) * 25;
      const n4 = Math.sin(x * 0.002 + 4.1) * 40;
      const base = H * 0.55;
      this.heights[x] = base + n1 + n2 + n3 + n4;
    }
  }

  getSurfaceY(x) {
    const ix = Math.round(x);
    if (ix < 0) return this.heights[0];
    if (ix >= WORLD_WIDTH) return this.heights[WORLD_WIDTH - 1];
    return this.heights[ix];
  }

  isInside(x, y) {
    const ix = Math.round(x);
    if (ix < 0 || ix >= WORLD_WIDTH) return y >= this.waterLevel;
    return y >= this.heights[ix];
  }

  destroy(cx, cy, radius) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.round(cx - radius));
    const x1 = Math.min(WORLD_WIDTH - 1, Math.round(cx + radius));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const maxDy = Math.sqrt(Math.max(0, r2 - dx * dx));
      const y0 = Math.round(cy - maxDy);
      const y1 = Math.round(cy + maxDy);
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          if (y < this.heights[x]) {
            this.heights[x] = y;
          }
        }
      }
    }
  }

  draw() {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < WORLD_WIDTH; x++) {
      ctx.lineTo(x, this.heights[x]);
    }
    ctx.lineTo(WORLD_WIDTH, H);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, H * 0.3, 0, H);
    grad.addColorStop(0, '#5a8a3c');
    grad.addColorStop(0.3, '#4a7a2e');
    grad.addColorStop(0.7, '#3d6b24');
    grad.addColorStop(1, '#2d4a18');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, this.waterLevel);
    for (let x = 0; x <= WORLD_WIDTH; x++) {
      ctx.lineTo(x, this.waterLevel);
    }
    ctx.lineTo(WORLD_WIDTH, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const wgrad = ctx.createLinearGradient(0, this.waterLevel, 0, H);
    wgrad.addColorStop(0, 'rgba(30, 120, 200, 0.35)');
    wgrad.addColorStop(0.2, 'rgba(20, 90, 170, 0.45)');
    wgrad.addColorStop(0.6, 'rgba(15, 60, 130, 0.55)');
    wgrad.addColorStop(1, 'rgba(5, 25, 70, 0.75)');
    ctx.fillStyle = wgrad;
    ctx.fill();
  }
}

let terrain;

class Worm {
  constructor(x, team, index) {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.team = team;
    this.index = index;
    this.hp = 100;
    this.maxHp = 100;
    this.isAlive = true;
    this.angle = team === 0 ? -Math.PI / 4 : -Math.PI * 3 / 4;
    this.isAirborne = false;
    this.facing = team === 0 ? 1 : -1;
    this.moveTimer = 0;
    this.onSurface();
  }

  onSurface() {
    const sy = terrain.getSurfaceY(this.x);
    this.y = sy - WORM_RADIUS;
    this.vy = 0;
    this.isAirborne = false;
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.isAlive = false;
  }

  move(dir) {
    if (!this.isAlive) return;
    this.facing = dir;
    this.moveTimer = 0.15;

    const nx = this.x + dir * WORM_SPEED * (1 / 60);
    if (nx < WORM_RADIUS || nx > WORLD_WIDTH - WORM_RADIUS) return;

    const sy = terrain.getSurfaceY(nx);
    if (sy >= terrain.waterLevel) return;

    const ny = sy - WORM_RADIUS;
    const diff = Math.abs(ny - this.y);
    if (diff < 30) {
      this.x = nx;
      this.y = ny;
      this.vy = 0;
      this.isAirborne = false;
    }
  }

  jump() {
    if (!this.isAlive || this.isAirborne) return;
    this.vy = JUMP_VELOCITY;
    this.isAirborne = true;
  }

  update(dt) {
    if (!this.isAlive) return;
    if (this.moveTimer > 0) this.moveTimer -= dt;

    if (this.isAirborne) {
      this.vy += GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const sy = terrain.getSurfaceY(this.x);
      if (this.y + WORM_RADIUS >= sy && this.vy > 0) {
        this.y = sy - WORM_RADIUS;
        this.vy = 0;
        this.vx = 0;
        this.isAirborne = false;
      }
    } else {
      const sy = terrain.getSurfaceY(this.x);
      const ny = sy - WORM_RADIUS;
      if (this.y < ny - 2) {
        this.isAirborne = true;
        this.vy = 0;
      } else {
        this.y = ny;
      }
    }

    if (this.y > terrain.waterLevel + 20) {
      this.isAlive = false;
    }
    this.x = Math.max(WORM_RADIUS, Math.min(WORLD_WIDTH - WORM_RADIUS, this.x));
  }

  draw(isActive) {
    if (!this.isAlive) return;

    ctx.save();

    const bodyColor = this.team === 0 ? '#3676ff' : '#ff3636';
    const bodyColorDark = this.team === 0 ? '#1a4a9e' : '#9e1a1a';

    ctx.beginPath();
    ctx.ellipse(this.x, this.y, WORM_RADIUS, WORM_RADIUS * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.strokeStyle = bodyColorDark;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const eyeOffX = this.facing * 5;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.x + eyeOffX, this.y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(this.x + eyeOffX, this.y - 4, 2, 0, Math.PI * 2);
    ctx.fill();

    const hpPct = this.hp / this.maxHp;
    const bw = WORM_RADIUS * 2.4;
    const bh = 4;
    const by = this.y - WORM_RADIUS - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(this.x - bw / 2, by, bw, bh);
    const hpColor = hpPct > 0.5 ? '#44cc44' : hpPct > 0.25 ? '#cccc44' : '#cc4444';
    ctx.fillStyle = hpColor;
    ctx.fillRect(this.x - bw / 2, by, bw * hpPct, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(this.x - bw / 2, by, bw, bh);

    if (isActive) {
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(this.x, this.y, WORM_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(
        this.x + Math.cos(this.angle) * 35,
        this.y + Math.sin(this.angle) * 35
      );
      ctx.stroke();

      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(
        this.x + Math.cos(this.angle) * 35,
        this.y + Math.sin(this.angle) * 35,
        3, 0, Math.PI * 2
      );
      ctx.fill();
    }

    ctx.restore();
  }
}

class Projectile {
  constructor(x, y, angle, powerFrac, wind) {
    this.x = x;
    this.y = y;
    const speed = 150 + powerFrac * 500;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.wind = wind;
    this.alive = true;
    this.bounced = false;
    this.trail = [];
  }

  update(dt) {
    if (!this.alive) return;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 25) this.trail.shift();

    this.vx += this.wind * dt;
    this.vy += GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const sy = terrain.getSurfaceY(this.x);
    if (this.y + 4 >= sy && this.vy > 0) {
      if (!this.bounced) {
        this.bounced = true;
        this.vy *= -0.4;
        this.vx *= 0.7;
        this.y = sy - 4;
        if (Math.abs(this.vy) < 20) {
          this.explode();
        }
      } else {
        this.explode();
      }
    }

    if (this.y > terrain.waterLevel) {
      this.alive = false;
    }

    if (this.x < -100 || this.x > WORLD_WIDTH + 100 || this.y < -500) {
      this.alive = false;
    }
  }

  explode() {
    if (!this.alive) return;
    this.alive = false;
    terrain.destroy(this.x, this.y, EXPLOSION_RADIUS);

    for (const worm of game.allWorms) {
      if (!worm.isAlive) continue;
      const dx = worm.x - this.x;
      const dy = worm.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < EXPLOSION_RADIUS) {
        const falloff = 1 - dist / EXPLOSION_RADIUS;
        const damage = Math.round(EXPLOSION_DAMAGE * falloff * (0.8 + Math.random() * 0.4));
        worm.takeDamage(damage);
      }
    }

    game.explosionEffect = {
      x: this.x,
      y: this.y,
      timer: 0.5,
      maxTimer: 0.5
    };
    game.state = 'exploding';
  }

  isOffScreen() {
    return this.x < -100 || this.x > WORLD_WIDTH + 100 || this.y > H + 50 || this.y < -500;
  }

  draw() {
    if (!this.alive) return;

    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const alpha = (i / this.trail.length) * 0.5;
      ctx.fillStyle = `rgba(255, 200, 50, ${alpha})`;
      const r = 1.5 + (i / this.trail.length) * 2.5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffdd44';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff8d0';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
  }

  follow(target) {
    this.targetX = target.x - W / 2;
    this.targetY = target.y - H / 2 + 80;
  }

  update() {
    this.x += (this.targetX - this.x) * 0.08;
    this.y += (this.targetY - this.y) * 0.08;
    this.x = Math.max(0, Math.min(WORLD_WIDTH - W, this.x));
    this.y = Math.max(-100, Math.min(50, this.y));
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
  }
}

class AI {
  compute(activeWorm, enemies) {
    let target = null;
    let minDist = Infinity;
    for (const e of enemies) {
      if (!e.isAlive) continue;
      const d = Math.abs(e.x - activeWorm.x) + Math.abs(e.y - activeWorm.y);
      if (d < minDist) {
        minDist = d;
        target = e;
      }
    }
    if (!target) return null;

    const dx = target.x - activeWorm.x;
    const dy = target.y - activeWorm.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const gravityComp = GRAVITY * dist / (300 * 300) * 0.5;
    let angle = Math.atan2(dy, dx) - gravityComp;

    const windEffect = game.wind * dist / (350 * 350) * 2;
    angle += windEffect * 0.4;

    const minAngle = -Math.PI * 0.85;
    const maxAngle = -0.05;
    angle = Math.max(minAngle, Math.min(maxAngle, angle));

    const powerBase = dist * 0.6 + 50;
    const powerJitter = (Math.random() - 0.3) * 80;
    const power = Math.max(100, Math.min(MAX_POWER, powerBase + powerJitter));

    return { angle, power };
  }
}

class Game {
  constructor() {
    this.team1 = [];
    this.team2 = [];
    this.activeTeam = 0;
    this.activeWormIndex = 0;
    this.state = 'menu';
    this.timer = TURN_TIME;
    this.wind = 0;
    this.projectile = null;
    this.explosionEffect = null;
    this.power = 0;
    this.isCharging = false;
    this.ai = new AI();
    this.camera = new Camera();
    this.aiTimer = 0;
    this.aiAction = null;
    this.winner = null;
    this.keys = {};
    this.setupInput();
    document.getElementById('restart-btn').addEventListener('click', () => this.restart());
  }

  get allWorms() {
    return [...this.team1, ...this.team2];
  }

  get activeWorm() {
    const team = this.activeTeam === 0 ? this.team1 : this.team2;
    return team[this.activeWormIndex];
  }

  get aliveTeam1() {
    return this.team1.filter(w => w.isAlive);
  }

  get aliveTeam2() {
    return this.team2.filter(w => w.isAlive);
  }

  init() {
    terrain = new Terrain();
    this.team1 = [];
    this.team2 = [];
    this.activeTeam = 0;
    this.activeWormIndex = 0;
    this.state = 'playing';
    this.timer = TURN_TIME;
    this.wind = (Math.random() - 0.5) * 2 * WIND_RANGE;
    this.projectile = null;
    this.explosionEffect = null;
    this.power = 0;
    this.isCharging = false;
    this.aiTimer = 0;
    this.aiAction = null;
    this.winner = null;
    this.camera.reset();

    const startX = WORLD_WIDTH * 0.15;
    for (let i = 0; i < 3; i++) {
      const wx = startX + i * 55 + Math.random() * 30;
      const w = new Worm(wx, 0, i);
      this.team1.push(w);
    }

    const startX2 = WORLD_WIDTH * 0.7;
    for (let i = 0; i < 3; i++) {
      const wx = startX2 + i * 55 + Math.random() * 30;
      const w = new Worm(wx, 1, i);
      w.facing = -1;
      w.angle = -Math.PI * 3 / 4;
      this.team2.push(w);
    }
  }

  restart() {
    document.getElementById('game-over-overlay').classList.add('hidden');
    this.init();
  }

  setupInput() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
      if (e.key === ' ' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
      if (e.key === ' ') this.releaseFire();
      if (e.key === 'Tab') e.preventDefault();
    });
  }

  releaseFire() {
    if (this.state !== 'playing' || this.activeTeam !== 0) return;
    const worm = this.activeWorm;
    if (!worm || !worm.isAlive || !this.isCharging) return;
    this.isCharging = false;
    document.getElementById('power-bar-container').classList.remove('visible');
    this.doFire(worm);
  }

  doFire(worm) {
    const powerFrac = this.power / MAX_POWER;
    const px = worm.x + Math.cos(worm.angle) * (WORM_RADIUS + 8);
    const py = worm.y + Math.sin(worm.angle) * (WORM_RADIUS + 8);
    const p = new Projectile(px, py, worm.angle, powerFrac, this.wind);
    this.projectile = p;
    this.state = 'firing';
    this.power = 0;
  }

  nextTurn() {
    const t1Count = this.aliveTeam1.length;
    const t2Count = this.aliveTeam2.length;

    if (t1Count === 0) {
      this.winner = 'Red Team';
      this.state = 'gameover';
      this.showGameOver();
      return;
    }
    if (t2Count === 0) {
      this.winner = 'Blue Team';
      this.state = 'gameover';
      this.showGameOver();
      return;
    }

    this.activeTeam = this.activeTeam === 0 ? 1 : 0;
    const team = this.activeTeam === 0 ? this.team1 : this.team2;
    const alive = team.filter(w => w.isAlive);
    if (alive.length === 0) {
      this.activeWormIndex = 0;
    } else {
      const current = team[this.activeWormIndex];
      if (!current || !current.isAlive) {
        const nextAlive = alive[0];
        this.activeWormIndex = team.indexOf(nextAlive);
      }
    }

    this.timer = TURN_TIME;
    this.wind += (Math.random() - 0.5) * 40;
    this.wind = Math.max(-WIND_RANGE, Math.min(WIND_RANGE, this.wind));
    this.state = 'playing';
    this.power = 0;
    this.isCharging = false;
    this.aiAction = null;
    this.aiTimer = 0;

    const worm = this.activeWorm;
    if (worm) this.camera.follow(worm);
  }

  updateAI(dt) {
    if (this.activeTeam !== 1 || this.state !== 'playing') return;
    const worm = this.activeWorm;
    if (!worm || !worm.isAlive) {
      this.nextTurn();
      return;
    }

    if (!this.aiAction) {
      this.aiAction = this.ai.compute(worm, this.aliveTeam1);
      this.aiTimer = AI_DELAY;
    }

    if (!this.aiAction) {
      this.nextTurn();
      return;
    }

    if (this.aiTimer > 0) {
      const diff = this.aiAction.angle - worm.angle;
      if (Math.abs(diff) > 0.03) {
        worm.angle += Math.sign(diff) * 0.6 * dt;
      } else {
        worm.angle = this.aiAction.angle;
      }
      this.aiTimer -= dt * 1000;
      return;
    }

    this.power = this.aiAction.power;
    this.doFire(worm);
  }

  updatePlayerInput(dt) {
    if (this.activeTeam !== 0 || this.state !== 'playing') return;
    const worm = this.activeWorm;
    if (!worm || !worm.isAlive) return;

    if (this.keys['ArrowLeft']) worm.move(-1);
    if (this.keys['ArrowRight']) worm.move(1);
    if (this.keys['ArrowUp']) {
      worm.angle = Math.max(-Math.PI * 0.85, worm.angle - 1.2 * dt);
    }
    if (this.keys['ArrowDown']) {
      worm.angle = Math.min(-0.05, worm.angle + 1.2 * dt);
    }
    if (this.keys['Tab']) {
      this.keys['Tab'] = false;
      worm.jump();
    }

    if (this.keys[' ']) {
      if (!this.isCharging) {
        this.isCharging = true;
        this.power = 0;
        document.getElementById('power-bar-container').classList.add('visible');
      }
      this.power = Math.min(MAX_POWER, this.power + CHARGE_RATE * dt);
      const pct = (this.power / MAX_POWER) * 100;
      document.getElementById('power-fill').style.width = pct + '%';
    }
  }

  updateProjectile(dt) {
    if (this.state !== 'firing' || !this.projectile) return;
    this.projectile.update(dt);
    if (this.projectile.alive) this.camera.follow(this.projectile);

    if (!this.projectile.alive && !this.explosionEffect) {
      this.projectile = null;
      this.nextTurn();
    }

    for (const worm of this.allWorms) {
      if (worm.isAlive && worm.isAirborne) worm.update(dt);
    }
  }

  updateExplosion(dt) {
    if (this.state !== 'exploding' || !this.explosionEffect) return;
    this.explosionEffect.timer -= dt;
    this.camera.follow(this.explosionEffect);

    if (this.explosionEffect.timer <= 0) {
      this.explosionEffect = null;
      for (const worm of this.allWorms) {
        if (worm.isAlive && !worm.isAirborne) {
          const sy = terrain.getSurfaceY(worm.x);
          if (worm.y + WORM_RADIUS > sy + 2) {
            worm.isAirborne = true;
            worm.vy = 0;
          } else {
            worm.y = sy - WORM_RADIUS;
          }
        }
      }
      this.nextTurn();
    }

    for (const worm of this.allWorms) {
      if (worm.isAlive && worm.isAirborne) worm.update(dt);
    }
  }

  update(dt) {
    if (this.state === 'menu' || this.state === 'gameover') return;

    if (this.state === 'playing') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.isCharging = false;
        document.getElementById('power-bar-container').classList.remove('visible');
        this.nextTurn();
        return;
      }
      this.updatePlayerInput(dt);
      this.updateAI(dt);
      const worm = this.activeWorm;
      if (worm && worm.isAlive) {
        worm.update(dt);
        this.camera.follow(worm);
      }
    }

    if (this.state === 'firing') {
      this.updateProjectile(dt);
    }

    if (this.state === 'exploding') {
      this.updateExplosion(dt);
    }

    this.camera.update();
    this.updateHUD();
  }

  updateHUD() {
    const worm = this.activeWorm;
    const teamName = this.activeTeam === 0 ? 'BLUE' : 'RED';
    const wi = worm && worm.isAlive ? worm.index : 0;
    document.getElementById('team-indicator').textContent = `${teamName} W${wi + 1}`;

    if (worm && worm.isAlive) {
      const pct = (worm.hp / worm.maxHp) * 100;
      document.getElementById('worm-hp-fill').style.width = pct + '%';
    }

    const windVal = this.wind;
    const windEl = document.getElementById('wind-value');
    if (Math.abs(windVal) < 5) {
      windEl.textContent = 'Calm';
    } else {
      const dir = windVal > 0 ? '→' : '←';
      windEl.textContent = `${dir} ${Math.abs(Math.round(windVal))}`;
    }

    document.getElementById('timer-value').textContent = Math.ceil(this.timer);
  }

  showGameOver() {
    const overlay = document.getElementById('game-over-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('victory-title').textContent = 'Victory!';
    document.getElementById('victory-message').textContent = `${this.winner} wins!`;
  }

  drawExplosion() {
    const e = this.explosionEffect;
    if (!e) return;
    const progress = 1 - e.timer / e.maxTimer;
    const r = e.radius * (0.3 + progress * 0.7);

    const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
    grad.addColorStop(0, 'rgba(255, 255, 200, 0.9)');
    grad.addColorStop(0.2, 'rgba(255, 220, 80, 0.7)');
    grad.addColorStop(0.5, 'rgba(255, 120, 30, 0.4)');
    grad.addColorStop(0.8, 'rgba(200, 60, 10, 0.15)');
    grad.addColorStop(1, 'rgba(100, 30, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + progress * 3;
      const pr = r * (0.4 + Math.random() * 0.6);
      const px = e.x + Math.cos(angle) * pr;
      const py = e.y + Math.sin(angle) * pr;
      const size = 2 + Math.random() * 5;
      const alpha = (0.7 - progress * 0.6) * (0.5 + Math.random() * 0.5);
      ctx.fillStyle = `rgba(255, ${180 + Math.random() * 75}, ${Math.random() * 60}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw() {
    ctx.save();

    ctx.clearRect(0, 0, W, H);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, '#4a90d9');
    skyGrad.addColorStop(0.4, '#87ceeb');
    skyGrad.addColorStop(0.7, '#b8d4e8');
    skyGrad.addColorStop(1, '#c8d8c0');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.translate(-this.camera.x, -this.camera.y);

    terrain.draw();

    for (const worm of this.allWorms) {
      const isActive = worm === this.activeWorm && this.state === 'playing';
      worm.draw(isActive);
    }

    if (this.projectile) this.projectile.draw();

    if (this.explosionEffect) this.drawExplosion();

    ctx.restore();
  }

  loop(timestamp) {
    const dt = Math.min(1 / 30, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;
    this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  start() {
    this.lastTime = performance.now();
    this.init();
    this.loop(this.lastTime);
  }
}

const game = new Game();
game.start();
