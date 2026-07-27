/* ==========================================================================
   WORMS — HTML Edition
   A turn-based artillery game inspired by Worms.
   Single-file JavaScript: terrain, physics, combat, UI.
   ========================================================================== */

'use strict';

/* ===== Constants & Configuration ===== */

const CONFIG = {
    canvasWidth: 1024,
    canvasHeight: 576,

    // Physics
    gravity: 0.35,
    windFactor: 0.02,
    maxWind: 3.0,

    // Terrain
    terrainSmoothness: 0.02,
    terrainAmplitude: 80,
    terrainBaseHeight: 120,

    // Worms
    wormCountPerTeam: 4,
    wormHP: 100,
    wormWidth: 24,
    wormHeight: 20,
    wormMoveSpeed: 0.6,

    // Projectile
    projectileRadius: 4,
    minPower: 10,
    maxPower: 100,
    explosionRadius: 45,
    baseDamage: 50,

    // Timing
    turnTimeLimit: 30, // seconds (not enforced strictly, for future use)
    explosionDuration: 12,
    explosionParticleCount: 20,
};

/* ===== Utility Functions ===== */

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function degToRad(deg) {
    return deg * Math.PI / 180;
}

function radToDeg(rad) {
    return rad * 180 / Math.PI;
}

/* ===== Terrain System ===== */

class Terrain {
    constructor(width, height, ctx) {
        this.width = width;
        this.height = height;
        this.ctx = ctx;
        this.imageData = ctx.createImageData(width, height);
        this.data = this.imageData.data;
        this.skyColor = { r: 26, g: 42, b: 62 };
        this.terrainColor = { r: 50, g: 140, b: 50 };
    }

    /** Generate terrain using layered sine waves for a natural look. */
    generate() {
        const data = this.data;
        const w = this.width;
        const h = this.height;

        // Build heightmap using multiple sine waves
        const heights = new Array(w);
        for (let x = 0; x < w; x++) {
            const norm = x / w;
            let height = h * 0.75; // base water level

            // Layer 1: large hills
            height += Math.sin(norm * Math.PI * 2 + 1.3) * CONFIG.terrainAmplitude * 0.6;
            // Layer 2: medium bumps
            height += Math.sin(norm * Math.PI * 4.7 + 0.7) * CONFIG.terrainAmplitude * 0.3;
            // Layer 3: small detail
            height += Math.sin(norm * Math.PI * 9.3 + 2.1) * CONFIG.terrainAmplitude * 0.15;
            // Layer 4: very large slope
            height += Math.sin(norm * Math.PI * 0.8 + 3.0) * CONFIG.terrainAmplitude * 0.4;

            heights[x] = Math.max(h * 0.55, Math.min(h * 0.92, height));
        }

        // Fill pixel data: sky above terrain, ground below
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                if (y >= heights[x]) {
                    // Ground pixel
                    data[idx] = this.terrainColor.r;
                    data[idx + 1] = this.terrainColor.g;
                    data[idx + 2] = this.terrainColor.b;
                    data[idx + 3] = 255;
                } else if (y >= h * 0.82) {
                    // Water line (shallow water)
                    data[idx] = 30;
                    data[idx + 1] = 80;
                    data[idx + 2] = 140;
                    data[idx + 3] = 200;
                } else {
                    // Sky
                    data[idx] = this.skyColor.r;
                    data[idx + 1] = this.skyColor.g;
                    data[idx + 2] = this.skyColor.b;
                    data[idx + 3] = 255;
                }
            }
        }

        // Store heightmap for surface queries
        this.heights = heights;
        this.render();
    }

    /** Render the terrain imageData to the canvas. */
    render() {
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /** Check if a pixel at (x, y) is solid terrain. */
    isSolid(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        const idx = (Math.floor(y) * this.width + Math.floor(x)) * 4;
        return this.data[idx + 3] > 0;
    }

    /** Get the terrain surface height at a given x coordinate. */
    getSurfaceHeight(x) {
        if (x < 0 || x >= this.width) return this.height;
        if (this.heights) return this.heights[Math.floor(x)];
        // Fallback: scan downward
        for (let y = 0; y < this.height; y++) {
            if (this.isSolid(x, y)) return y;
        }
        return this.height;
    }

    /** Destroy terrain in a circular area (explosion). */
    digCircle(centerX, centerY, radius) {
        const data = this.data;
        const w = this.width;
        const h = this.height;
        const r2 = radius * radius;

        const minX = Math.max(0, Math.floor(centerX - radius));
        const maxX = Math.min(w - 1, Math.ceil(centerX + radius));
        const minY = Math.max(0, Math.floor(centerY - radius));
        const maxY = Math.min(h - 1, Math.ceil(centerY + radius));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - centerX;
                const dy = y - centerY;
                if (dx * dx + dy * dy <= r2) {
                    const idx = (y * w + x) * 4;
                    // Set to transparent (sky color with 0 alpha)
                    data[idx] = this.skyColor.r;
                    data[idx + 1] = this.skyColor.g;
                    data[idx + 2] = this.skyColor.b;
                    data[idx + 3] = 0;
                }
            }
        }

        // Update heightmap for affected columns
        if (this.heights) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - centerX;
                if (dx * dx > r2) continue;
                // Find new surface height for this column
                let newHeight = h;
                for (let y = Math.max(0, Math.floor(centerY - radius)); y < h; y++) {
                    const idx = (y * w + x) * 4;
                    if (data[idx + 3] > 0) {
                        newHeight = y;
                        break;
                    }
                }
                this.heights[x] = newHeight;
            }
        }

        this.render();
    }
}

/* ===== Worm Class ===== */

class Worm {
    constructor(x, y, team, index) {
        this.x = x;
        this.y = y;
        this.team = team; // 'red' or 'blue'
        this.index = index; // 0-based within team
        this.hp = CONFIG.wormHP;
        this.maxHp = CONFIG.wormHP;
        this.facing = team === 'red' ? 1 : -1; // red faces right, blue faces left
        this.width = CONFIG.wormWidth;
        this.height = CONFIG.wormHeight;
        this.onGround = true;
        this.vx = 0;
        this.vy = 0;
        this.selected = false;
    }

    get centerX() {
        return this.x + this.width / 2;
    }

    get centerY() {
        return this.y + this.height / 2;
    }

    get feetX() {
        return this.x + this.width / 2;
    }

    get feetY() {
        return this.y + this.height;
    }

    isAlive() {
        return this.hp > 0;
    }

    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
    }

    /** Place worm on terrain surface at given x. */
    placeOnTerrain(terrain) {
        const surfaceY = terrain.getSurfaceHeight(this.x);
        this.y = surfaceY - this.height;
        // Ensure worm is above water
        if (this.y > terrain.height * 0.82) {
            this.y = terrain.height * 0.82 - this.height;
        }
    }

    /** Update worm physics (falling, etc.). */
    update(terrain, game) {
        if (!this.isAlive()) return;

        // Check if on ground
        const feetY = this.feetY;
        const groundBelow = terrain.getSurfaceHeight(this.feetX);

        if (feetY < groundBelow - 1) {
            // Falling
            this.onGround = false;
            this.vy += CONFIG.gravity;
            this.y += this.vy;
        } else {
            // On ground
            this.onGround = true;
            this.vy = 0;
            this.y = groundBelow - this.height;
        }

        // Check for water death
        if (this.y > terrain.height * 0.82) {
            this.hp = 0;
        }

        // Horizontal movement (only for active worm in aiming phase)
        if (this.selected && game.gameState === 'aiming' && game.currentTeam === this.team) {
            this.x += this.vx;
            this.vx *= 0.9; // friction
            // Clamp to canvas
            this.x = clamp(this.x, 0, CONFIG.canvasWidth - this.width);
        }
    }

    render(ctx) {
        if (!this.isAlive()) return;

        const color = this.team === 'red' ? '#ff5555' : '#55aaff';
        const eyeColor = '#ffffff';
        const pupilColor = '#000000';

        // Body
        ctx.fillStyle = color;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Body outline
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.strokeRect(this.x, this.y, this.width, this.height);

        // Selection ring
        if (this.selected) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(this.x - 3, this.y - 3, this.width + 6, this.height + 6);
            ctx.setLineDash([]);
        }

        // Face direction indicator
        ctx.fillStyle = eyeColor;
        const eyeX = this.facing > 0 ? this.x + this.width - 6 : this.x + 4;
        ctx.fillRect(eyeX, this.y + 4, 4, 4);

        // Pupil
        ctx.fillStyle = pupilColor;
        const pupilX = this.facing > 0 ? this.x + this.width - 5 : this.x + 5;
        ctx.fillRect(pupilX, this.y + 4, 2, 2);

        // HP bar above worm
        const barWidth = this.width;
        const barHeight = 4;
        const hpPercent = this.hp / this.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(this.x, this.y - 8, barWidth, barHeight);
        ctx.fillStyle = hpPercent > 0.5 ? '#4caf50' : hpPercent > 0.2 ? '#ff9800' : '#f44336';
        ctx.fillRect(this.x, this.y - 8, barWidth * hpPercent, barHeight);
    }
}

/* ===== Projectile Class ===== */

class Projectile {
    constructor(x, y, vx, vy, owner) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = CONFIG.projectileRadius;
        this.owner = owner;
        this.active = true;
        this.exploding = false;
        this.explosionFrame = 0;
        this.explosionX = 0;
        this.explosionY = 0;
        this.particles = [];
    }

    update(terrain, game) {
        if (!this.active) return;

        if (this.exploding) {
            this.explosionFrame++;
            if (this.explosionFrame > CONFIG.explosionDuration) {
                this.active = false;
                game.endProjectilePhase();
            }
            return;
        }

        // Apply physics
        this.vy += CONFIG.gravity;
        this.vx += game.wind * CONFIG.windFactor;

        this.x += this.vx;
        this.y += this.vy;

        // Check terrain collision
        if (terrain.isSolid(this.x, this.y)) {
            this.explode(this.x, this.y, terrain, game);
            return;
        }

        // Check if projectile went out of bounds
        if (this.x < 0 || this.x > CONFIG.canvasWidth || this.y > CONFIG.canvasHeight) {
            this.active = false;
            game.endProjectilePhase();
        }
    }

    explode(x, y, terrain, game) {
        this.exploding = true;
        this.explosionFrame = 0;
        this.explosionX = x;
        this.explosionY = y;
        this.vx = 0;
        this.vy = 0;

        // Destroy terrain
        terrain.digCircle(x, y, CONFIG.explosionRadius);

        // Damage worms
        for (const worm of game.worms) {
            if (!worm.isAlive()) continue;
            const dist = distance(worm.centerX, worm.centerY, x, y);
            if (dist <= CONFIG.explosionRadius) {
                const damage = Math.round(
                    CONFIG.baseDamage * (1 - dist / CONFIG.explosionRadius)
                );
                if (damage > 0) {
                    worm.takeDamage(damage);
                }
            }
        }

        // Create explosion particles
        this.createParticles();

        // Screen shake
        game.screenShake = 8;

        // Play sound effect (visual only)
        game.lastExplosionTime = game.frameCount;
    }

    createParticles() {
        this.particles = [];
        for (let i = 0; i < CONFIG.explosionParticleCount; i++) {
            const angle = rand(0, Math.PI * 2);
            const speed = rand(1, 5);
            this.particles.push({
                x: this.explosionX,
                y: this.explosionY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 20,
                color: `hsl(${rand(0, 60)}, 100%, 50%)`
            });
        }
    }

    updateParticles() {
        if (!this.exploding) return;
        for (const p of this.particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1;
            p.life--;
        }
    }

    render(ctx) {
        if (!this.active) return;

        if (this.exploding) {
            this.renderExplosion(ctx);
            this.updateParticles();
            return;
        }

        // Projectile
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    renderExplosion(ctx) {
        const radius = CONFIG.explosionRadius * (this.explosionFrame / CONFIG.explosionDuration);

        // Explosion flash
        const gradient = ctx.createRadialGradient(
            this.explosionX, this.explosionY, 0,
            this.explosionX, this.explosionY, radius
        );
        gradient.addColorStop(0, '#ffff00');
        gradient.addColorStop(0.5, '#ff6600');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.explosionX, this.explosionY, radius, 0, Math.PI * 2);
        ctx.fill();

        // Particles
        for (const p of this.particles) {
            if (p.life > 0) {
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.life / 20;
                ctx.fillRect(p.x, p.y, 2, 2);
            }
        }
        ctx.globalAlpha = 1;
    }
}

/* ===== Game Class ===== */

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.uiCanvas = document.getElementById('uiCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.uiCtx = this.uiCanvas.getContext('2d');

        this.terrain = new Terrain(CONFIG.canvasWidth, CONFIG.canvasHeight, this.ctx);
        this.worms = [];
        this.projectiles = [];

        this.currentTeam = 'red';
        this.activeWorm = null;
        this.wind = 0;
        this.frameCount = 0;
        this.gameState = 'aiming'; // 'aiming' | 'firing' | 'exploding' | 'gameOver'

        // Aiming
        this.aimAngle = 45;
        this.aimPower = 50;
        this.aimStart = null;
        this.isDragging = false;

        // Effects
        this.screenShake = 0;
        this.lastExplosionTime = 0;

        // UI elements
        this.ui = {
            turnLabel: document.getElementById('turnLabel'),
            turnTeam: document.getElementById('turnTeam'),
            healthFill: document.getElementById('healthFill'),
            healthValue: document.getElementById('healthValue'),
            redCount: document.getElementById('redCount').querySelector('.count'),
            blueCount: document.getElementById('blueCount').querySelector('.count'),
            angleValue: document.getElementById('angleValue'),
            powerValue: document.getElementById('powerValue'),
            aimOverlay: document.getElementById('aimOverlay'),
            skipBtn: document.getElementById('skipTurnBtn'),
            restartBtn: document.getElementById('restartBtn'),
            messageOverlay: document.getElementById('messageOverlay'),
            messageTitle: document.getElementById('messageTitle'),
            messageText: document.getElementById('messageText'),
            messageBtn: document.getElementById('messageBtn'),
            windFill: document.getElementById('windFill'),
            windValue: document.getElementById('windValue'),
        };

        this.init();
    }

    init() {
        // Generate terrain
        this.terrain.generate();

        // Create worms
        this.worms = [];
        this.createWorms();

        // Set initial wind
        this.wind = rand(-CONFIG.maxWind, CONFIG.maxWind);

        // Select first worm
        this.selectActiveWorm();

        // Bind UI events
        this.bindEvents();

        // Start game loop
        this.lastTimestamp = 0;
        requestAnimationFrame(this.gameLoop.bind(this));
    }

    createWorms() {
        const teamConfigs = [
            { team: 'red', side: 'left' },
            { team: 'blue', side: 'right' }
        ];

        for (const config of teamConfigs) {
            const startX = config.side === 'left'
                ? CONFIG.canvasWidth * 0.15
                : CONFIG.canvasWidth * 0.85;

            for (let i = 0; i < CONFIG.wormCountPerTeam; i++) {
                // Spread worms across their side
                const spread = (i - (CONFIG.wormCountPerTeam - 1) / 2) * 60;
                const x = startX + spread;
                const worm = new Worm(x, 0, config.team, i);
                worm.placeOnTerrain(this.terrain);
                this.worms.push(worm);
            }
        }
    }

    selectActiveWorm() {
        // Find first alive worm on current team
        const teamWorms = this.worms.filter(w => w.team === this.currentTeam && w.isAlive());
        if (teamWorms.length === 0) {
            this.checkWinCondition();
            return;
        }

        // Deselect all
        for (const w of this.worms) w.selected = false;

        // Select first alive worm on current team
        this.activeWorm = teamWorms[0];
        this.activeWorm.selected = true;

        // Update UI
        this.updateUI();
    }

    bindEvents() {
        // Mouse/touch for aiming
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));

        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this));
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this));
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));

        // Buttons
        this.ui.skipBtn.addEventListener('click', () => this.skipTurn());
        this.ui.restartBtn.addEventListener('click', () => this.restart());
        this.ui.messageBtn.addEventListener('click', () => this.restart());
    }

    /* ===== Input Handlers ===== */

    onMouseDown(e) {
        if (this.gameState !== 'aiming') return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.startAim(x, y);
    }

    onMouseMove(e) {
        if (this.gameState !== 'aiming' || !this.isDragging) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.updateAim(x, y);
    }

    onMouseUp(e) {
        if (this.gameState !== 'aiming' || !this.isDragging) return;
        this.fireProjectile();
    }

    onTouchStart(e) {
        e.preventDefault();
        if (this.gameState !== 'aiming') return;
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.startAim(x, y);
    }

    onTouchMove(e) {
        e.preventDefault();
        if (this.gameState !== 'aiming' || !this.isDragging) return;
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.updateAim(x, y);
    }

    onTouchEnd(e) {
        e.preventDefault();
        if (this.gameState !== 'aiming' || !this.isDragging) return;
        this.fireProjectile();
    }

    startAim(x, y) {
        if (!this.activeWorm) return;
        this.isDragging = true;
        this.aimStart = { x, y };
    }

    updateAim(x, y) {
        if (!this.aimStart) return;

        const dx = x - this.aimStart.x;
        const dy = y - this.aimStart.y;

        // Angle: from the worm's position to the drag point
        const wormX = this.activeWorm.centerX;
        const wormY = this.activeWorm.centerY;

        // Calculate angle relative to worm
        let angleRad = Math.atan2(y - wormY, x - wormX);

        // If aiming behind the worm, clamp to forward direction
        if (this.activeWorm.facing > 0) {
            // Facing right: angle should be between -90 and 90 degrees
            angleRad = clamp(angleRad, degToRad(-85), degToRad(85));
        } else {
            // Facing left: angle should be between 90 and 270 degrees (or -90 to -180)
            angleRad = clamp(angleRad, degToRad(95), degToRad(175));
        }

        this.aimAngle = radToDeg(angleRad);

        // Power based on drag distance
        const dragDist = distance(x, y, this.aimStart.x, this.aimStart.y);
        const power = clamp(dragDist / 100 * 100, 0, 100);
        this.aimPower = power;

        // Update UI
        this.ui.angleValue.textContent = `${Math.round(this.aimAngle)}°`;
        this.ui.powerValue.textContent = `${Math.round(this.aimPower)}%`;
        this.ui.aimOverlay.classList.add('visible');
    }

    fireProjectile() {
        if (!this.activeWorm || this.aimPower < 5) {
            this.isDragging = false;
            this.aimStart = null;
            this.ui.aimOverlay.classList.remove('visible');
            return;
        }

        this.isDragging = false;
        this.aimStart = null;
        this.ui.aimOverlay.classList.remove('visible');

        this.gameState = 'firing';

        // Calculate initial velocity
        const angleRad = degToRad(this.aimAngle);
        const power = this.aimPower / 100;
        const speed = CONFIG.minPower + (CONFIG.maxPower - CONFIG.minPower) * power;

        const vx = Math.cos(angleRad) * speed;
        const vy = Math.sin(angleRad) * speed;

        // Spawn projectile at worm's position
        const proj = new Projectile(
            this.activeWorm.centerX,
            this.activeWorm.feetY,
            vx, vy,
            this.activeWorm
        );
        this.projectiles.push(proj);
    }

    endProjectilePhase() {
        // Remove dead projectiles
        this.projectiles = this.projectiles.filter(p => p.active);

        // Check for eliminations
        this.checkEliminations();

        // Check win condition
        if (this.checkWinCondition()) return;

        // Switch turn
        this.switchTurn();
    }

    checkEliminations() {
        // Update worm physics to settle
        for (const worm of this.worms) {
            if (worm.isAlive()) {
                worm.update(this.terrain, this);
            }
        }
    }

    switchTurn() {
        this.currentTeam = this.currentTeam === 'red' ? 'blue' : 'red';
        this.selectActiveWorm();
        this.gameState = 'aiming';
        this.wind = rand(-CONFIG.maxWind, CONFIG.maxWind);
        this.updateWindUI();
    }

    skipTurn() {
        if (this.gameState !== 'aiming') return;
        this.switchTurn();
    }

    checkWinCondition() {
        const redAlive = this.worms.some(w => w.team === 'red' && w.isAlive());
        const blueAlive = this.worms.some(w => w.team === 'blue' && w.isAlive());

        if (!redAlive || !blueAlive) {
            this.gameState = 'gameOver';
            const winner = redAlive ? 'red' : 'blue';
            this.showGameOver(winner);
            return true;
        }
        return false;
    }

    showGameOver(winner) {
        this.ui.messageOverlay.classList.remove('hidden');
        this.ui.messageTitle.textContent = `${winner.toUpperCase()} TEAM WINS!`;
        this.ui.messageTitle.className = `team-${winner}`;
        this.ui.messageText.textContent = 'The battle is over. Ready for another round?';
    }

    restart() {
        // Reset game state
        this.worms = [];
        this.projectiles = [];
        this.gameState = 'aiming';
        this.currentTeam = 'red';
        this.screenShake = 0;

        // Regenerate everything
        this.terrain.generate();
        this.createWorms();
        this.wind = rand(-CONFIG.maxWind, CONFIG.maxWind);
        this.selectActiveWorm();

        // Hide overlays
        this.ui.messageOverlay.classList.add('hidden');
        this.ui.aimOverlay.classList.remove('visible');
    }

    /* ===== UI Updates ===== */

    updateUI() {
        // Turn indicator
        this.ui.turnTeam.textContent = this.currentTeam.toUpperCase();
        this.ui.turnTeam.className = `team-${this.currentTeam}`;

        // Health bar
        if (this.activeWorm) {
            const hpPercent = this.activeWorm.hp / this.activeWorm.maxHp;
            this.ui.healthFill.style.width = `${hpPercent * 100}%`;
            this.ui.healthValue.textContent = this.activeWorm.hp;

            // Health bar color
            this.ui.healthFill.className = '';
            if (hpPercent < 0.3) {
                this.ui.healthFill.classList.add('critical');
            } else if (hpPercent < 0.5) {
                this.ui.healthFill.classList.add('low');
            }
        }

        // Team counts
        const redAlive = this.worms.filter(w => w.team === 'red' && w.isAlive()).length;
        const blueAlive = this.worms.filter(w => w.team === 'blue' && w.isAlive()).length;
        this.ui.redCount.textContent = redAlive;
        this.ui.blueCount.textContent = blueAlive;

        // Disable skip button during non-aiming phases
        this.ui.skipBtn.disabled = this.gameState !== 'aiming';
    }

    updateWindUI() {
        const windPercent = (this.wind + CONFIG.maxWind) / (CONFIG.maxWind * 2) * 100;
        this.ui.windFill.style.width = `${Math.abs(this.wind) / CONFIG.maxWind * 100}%`;
        this.ui.windFill.style.marginLeft = this.wind < 0 ? `${100 - windPercent}%` : '0%';
        this.ui.windFill.className = this.wind < 0 ? 'negative' : '';
        this.ui.windValue.textContent = Math.round(this.wind * 10) / 10;
    }

    /* ===== Game Loop ===== */

    gameLoop(timestamp) {
        const dt = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;

        this.frameCount++;

        // Update
        this.update(dt);

        // Render
        this.render();

        requestAnimationFrame(this.gameLoop.bind(this));
    }

    update(dt) {
        // Update worms
        for (const worm of this.worms) {
            worm.update(this.terrain, this);
        }

        // Update projectiles
        for (const proj of this.projectiles) {
            proj.update(this.terrain, this);
        }

        // Screen shake decay
        if (this.screenShake > 0) {
            this.screenShake *= 0.85;
            if (this.screenShake < 0.5) this.screenShake = 0;
        }

        // Update UI
        this.updateUI();
    }

    render() {
        // Apply screen shake
        const shakeX = (Math.random() - 0.5) * this.screenShake;
        const shakeY = (Math.random() - 0.5) * this.screenShake;

        this.ctx.save();
        this.ctx.translate(shakeX, shakeY);

        // Clear and redraw terrain (terrain is already rendered, just redraw if needed)
        // Actually terrain is rendered via putImageData, we need to redraw it
        this.terrain.render();

        // Render worms
        for (const worm of this.worms) {
            worm.render(this.ctx);
        }

        // Render projectiles
        for (const proj of this.projectiles) {
            proj.render(this.ctx);
        }

        // Render aim preview (trajectory arc)
        if (this.gameState === 'aiming' && this.activeWorm && !this.isDragging) {
            this.renderTrajectoryPreview();
        }

        // Render aim line (while dragging)
        if (this.isDragging && this.aimStart) {
            this.renderAimLine();
        }

        this.ctx.restore();

        // Clear UI canvas
        this.uiCtx.clearRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
    }

    renderTrajectoryPreview() {
        if (!this.activeWorm) return;

        const angleRad = degToRad(this.aimAngle);
        const power = this.aimPower / 100;
        const speed = CONFIG.minPower + (CONFIG.maxPower - CONFIG.minPower) * power;

        let x = this.activeWorm.centerX;
        let y = this.activeWorm.feetY;
        let vx = Math.cos(angleRad) * speed;
        let vy = Math.sin(angleRad) * speed;

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);

        for (let i = 0; i < 60; i++) {
            vx += this.wind * CONFIG.windFactor;
            vy += CONFIG.gravity;
            x += vx;
            y += vy;

            // Stop if hitting terrain
            if (this.terrain.isSolid(x, y)) break;

            this.ctx.lineTo(x, y);
        }

        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    renderAimLine() {
        if (!this.aimStart || !this.activeWorm) return;

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([3, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.activeWorm.centerX, this.activeWorm.centerY);
        this.ctx.lineTo(this.aimStart.x, this.aimStart.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }
}

/* ===== Initialization ===== */

document.addEventListener('DOMContentLoaded', () => {
    // Hide loading, start game
    const game = new Game();

    // Expose for debugging
    window.game = game;
});
