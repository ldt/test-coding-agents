// ============================================================
// WORMS HTML GAME
// A classic turn-based strategy game
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 600;
const GRAVITY = 0.4;
const TURN_TIME = 30;
const WORM_SPEED = 3;
const JUMP_FORCE = -10;
const WATER_LEVEL = CANVAS_HEIGHT - 80;
const TERRAIN_COLORS = {
    grass: '#4a7c59',
    dirt: '#8b6914',
    rock: '#5a5a5a',
    water: '#3498db'
};

// ============================================================
// PERLIN NOISE IMPLEMENTATION
// ============================================================
class PerlinNoise {
    constructor(seed = Math.random() * 10000) {
        this.seed = seed;
        this.permutation = this.generatePermutation();
    }

    generatePermutation() {
        const perm = [];
        for (let i = 0; i < 256; i++) perm[i] = i;
        
        // Shuffle using seed
        let n = 256;
        while (n > 1) {
            const k = Math.floor(this.seededRandom() * n);
            n--;
            [perm[n], perm[k]] = [perm[k], perm[n]];
        }
        
        // Duplicate for wrapping
        for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
        return perm;
    }

    seededRandom() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(a, b, t) {
        return a + t * (b - a);
    }

    grad(hash, x) {
        return (hash & 1) === 0 ? x : -x;
    }

    noise1D(x) {
        const X = Math.floor(x) & 255;
        x -= Math.floor(x);
        
        const u = this.fade(x);
        return this.lerp(
            this.grad(this.permutation[X], x),
            this.grad(this.permutation[X + 1], x - 1),
            u
        );
    }

    // Multi-octave noise
    fbm(x, octaves = 4) {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += amplitude * this.noise1D(x * frequency);
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return value / maxValue;
    }
}

// ============================================================
// TERRAIN SYSTEM
// ============================================================
class Terrain {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.pixels = new Uint8Array(width * height); // 0 = air, 1 = solid
        this.heightMap = new Float32Array(width);
        this.perlin = new PerlinNoise();
        
        this.generate();
    }

    generate() {
        const scale = 0.008;
        const baseHeight = this.height * 0.6;

        // Generate heightmap
        for (let x = 0; x < this.width; x++) {
            const noise = this.perlin.fbm(x * scale, 4);
            this.heightMap[x] = baseHeight + noise * 150;
            
            // Add some variation
            this.heightMap[x] += Math.sin(x * 0.02) * 30;
        }

        // Smooth the heightmap
        this.smoothHeightMap();

        // Convert to pixel array
        for (let x = 0; x < this.width; x++) {
            const surfaceY = Math.floor(this.heightMap[x]);
            
            for (let y = surfaceY; y < this.height; y++) {
                const idx = y * this.width + x;
                
                if (y < WATER_LEVEL) {
                    this.pixels[idx] = 1;
                }
            }
        }
    }

    smoothHeightMap() {
        const smoothed = new Float32Array(this.width);
        const kernel = 5;
        
        for (let x = 0; x < this.width; x++) {
            let sum = 0;
            let count = 0;
            
            for (let i = -kernel; i <= kernel; i++) {
                const nx = x + i;
                if (nx >= 0 && nx < this.width) {
                    sum += this.heightMap[nx];
                    count++;
                }
            }
            
            smoothed[x] = sum / count;
        }
        
        this.heightMap = smoothed;
    }

    isSolid(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return y >= WATER_LEVEL;
        }
        return this.pixels[Math.floor(y) * this.width + Math.floor(x)] === 1;
    }

    getSurfaceY(x) {
        const ix = Math.floor(x);
        if (ix < 0 || ix >= this.width) return WATER_LEVEL;
        
        for (let y = 0; y < this.height; y++) {
            if (this.pixels[y * this.width + ix] === 1) {
                return y;
            }
        }
        return WATER_LEVEL;
    }

    explode(x, y, radius) {
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist <= radius) {
                    const px = cx + dx;
                    const py = cy + dy;
                    
                    if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
                        const idx = py * this.width + px;
                        if (this.pixels[idx] === 1) {
                            this.pixels[idx] = 0;
                        }
                    }
                }
            }
        }
        
        // Update heightmap for affected area
        for (let x = Math.max(0, cx - radius - 10); x < Math.min(this.width, cx + radius + 10); x++) {
            this.heightMap[x] = this.getSurfaceY(x);
        }
    }

    draw(ctx) {
        // Create image data
        const imageData = ctx.createImageData(this.width, this.height);
        const data = imageData.data;

        // Draw sky gradient
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = (y * this.width + x) * 4;
                
                if (y < WATER_LEVEL) {
                    // Sky gradient
                    const t = y / this.height;
                    data[idx] = 135 + t * 50;     // R
                    data[idx + 1] = 206 + t * 30; // G
                    data[idx + 2] = 235;           // B
                    data[idx + 3] = 255;           // A
                } else {
                    // Water
                    data[idx] = 52;
                    data[idx + 1] = 152;
                    data[idx + 2] = 219;
                    data[idx + 3] = 200;
                }
            }
        }

        // Draw terrain
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.pixels[y * this.width + x] === 1) {
                    const idx = (y * this.width + x) * 4;
                    const surfaceDist = this.heightMap[x] - y;
                    
                    // Color based on depth
                    let r, g, b;
                    
                    if (surfaceDist < 5) {
                        // Grass
                        r = 74;
                        g = 124;
                        b = 89;
                    } else if (surfaceDist < 30) {
                        // Dirt
                        r = 139;
                        g = 105;
                        b = 20;
                    } else {
                        // Rock
                        r = 90;
                        g = 90;
                        b = 90;
                    }
                    
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = 255;
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }
}

// ============================================================
// WEAPON SYSTEM
// ============================================================
class Weapon {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.ammo = config.ammo;
        this.maxAmmo = config.ammo;
        this.damage = config.damage;
        this.radius = config.radius;
        this.type = config.type;
        this.speed = config.speed || 15;
    }

    canFire() {
        return this.ammo > 0 || this.ammo === -1; // -1 = infinite
    }

    use() {
        if (this.ammo > 0) {
            this.ammo--;
        }
    }
}

// ============================================================
// WORM CLASS
// ============================================================
class Worm {
    constructor(x, y, teamId, wormIndex) {
        this.x = x;
        this.y = y;
        this.teamId = teamId;
        this.wormIndex = wormIndex;
        this.health = 100;
        this.maxHealth = 100;
        this.width = 20;
        this.height = 15;
        this.velocity = { x: 0, y: 0 };
        this.state = 'idle'; // idle, moving, jumping, falling, dead
        this.facing = 1; // 1 = right, -1 = left
        this.onGround = false;
    }

    update(terrain) {
        if (this.state === 'dead') return;

        // Apply gravity
        this.velocity.y += GRAVITY;

        // Update position
        this.x += this.velocity.x;
        this.y += this.velocity.y;

        // Terrain collision
        this.onGround = false;
        
        // Check if standing on ground
        const feetY = this.y + this.height / 2;
        if (terrain.isSolid(this.x, feetY + 1)) {
            this.y = terrain.getSurfaceY(this.x) - this.height / 2;
            this.velocity.y = 0;
            this.onGround = true;
            
            if (this.state === 'falling' || this.state === 'jumping') {
                this.state = 'idle';
            }
        }

        // Horizontal collision
        const rightEdge = this.x + this.width / 2;
        const leftEdge = this.x - this.width / 2;
        
        if (terrain.isSolid(rightEdge, this.y)) {
            this.x = Math.floor(rightEdge) - this.width / 2;
            this.velocity.x = 0;
        }
        
        if (terrain.isSolid(leftEdge, this.y)) {
            this.x = Math.ceil(leftEdge) + this.width / 2;
            this.velocity.x = 0;
        }

        // Friction
        if (this.onGround) {
            this.velocity.x *= 0.8;
        }

        // Water death
        if (this.y > WATER_LEVEL) {
            this.health = 0;
            this.state = 'dead';
        }
    }

    moveLeft() {
        if (this.state === 'dead') return;
        this.velocity.x = -WORM_SPEED;
        this.facing = -1;
        this.state = 'moving';
    }

    moveRight() {
        if (this.state === 'dead') return;
        this.velocity.x = WORM_SPEED;
        this.facing = 1;
        this.state = 'moving';
    }

    jump() {
        if (this.state === 'dead' || !this.onGround) return;
        this.velocity.y = JUMP_FORCE;
        this.state = 'jumping';
    }

    stopMoving() {
        this.velocity.x = 0;
        if (this.onGround && this.state === 'moving') {
            this.state = 'idle';
        }
    }

    takeDamage(amount) {
        if (this.state === 'dead') return 0;
        
        const actualDamage = Math.min(amount, this.health);
        this.health -= actualDamage;
        
        if (this.health <= 0) {
            this.health = 0;
            this.state = 'dead';
        }
        
        return actualDamage;
    }

    draw(ctx, isActive) {
        if (this.state === 'dead') return;

        // Worm body
        ctx.fillStyle = isActive ? '#fff' : '#ddd';
        ctx.beginPath();
        ctx.ellipse(
            this.x,
            this.y,
            this.width / 2,
            this.height / 2,
            0,
            0,
            Math.PI * 2
        );
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#000';
        const eyeOffsetX = this.facing * 4;
        ctx.beginPath();
        ctx.arc(this.x + eyeOffsetX - 3, this.y - 2, 2, 0, Math.PI * 2);
        ctx.arc(this.x + eyeOffsetX + 3, this.y - 2, 2, 0, Math.PI * 2);
        ctx.fill();

        // Health bar
        const barWidth = 30;
        const barHeight = 5;
        const healthPercent = this.health / this.maxHealth;
        
        ctx.fillStyle = '#333';
        ctx.fillRect(this.x - barWidth / 2, this.y - this.height / 2 - 12, barWidth, barHeight);
        
        ctx.fillStyle = healthPercent > 0.5 ? '#4ecdc4' : healthPercent > 0.25 ? '#f39c12' : '#e74c3c';
        ctx.fillRect(this.x - barWidth / 2, this.y - this.height / 2 - 12, barWidth * healthPercent, barHeight);

        // Active indicator
        if (isActive) {
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.width / 2 + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    getBounds() {
        return {
            x: this.x - this.width / 2,
            y: this.y - this.height / 2,
            width: this.width,
            height: this.height
        };
    }
}

// ============================================================
// PROJECTILE CLASS
// ============================================================
class Projectile {
    constructor(x, y, vx, vy, weapon, owner) {
        this.x = x;
        this.y = y;
        this.velocity = { x: vx, y: vy };
        this.weapon = weapon;
        this.owner = owner;
        this.timeToLive = 180; // 3 seconds at 60fps
        this.trail = [];
    }

    update() {
        // Store trail position
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 10) this.trail.shift();

        // Apply gravity
        this.velocity.y += GRAVITY * 0.5;

        // Update position
        this.x += this.velocity.x;
        this.y += this.velocity.y;

        // Decrease TTL
        this.timeToLive--;

        return this.timeToLive > 0;
    }

    draw(ctx) {
        // Draw trail
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        if (this.trail.length > 0) {
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
        }
        
        ctx.stroke();

        // Draw projectile
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(this.x - 1, this.y - 1, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ============================================================
// EXPLOSION EFFECT
// ============================================================
class Explosion {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.currentRadius = 0;
        this.maxFrames = 20;
        this.frame = 0;
        this.finished = false;
    }

    update() {
        this.frame++;
        this.currentRadius = (this.frame / this.maxFrames) * this.radius * 1.5;
        
        if (this.frame >= this.maxFrames) {
            this.finished = true;
        }
    }

    draw(ctx) {
        const alpha = 1 - (this.frame / this.maxFrames);
        
        // Outer glow
        const gradient = ctx.createRadialGradient(
            this.x, this.y, 0,
            this.x, this.y, this.currentRadius
        );
        gradient.addColorStop(0, `rgba(255, 200, 0, ${alpha})`);
        gradient.addColorStop(0.4, `rgba(255, 100, 0, ${alpha * 0.8})`);
        gradient.addColorStop(1, `rgba(255, 50, 0, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ============================================================
// DAMAGE NUMBER EFFECT
// ============================================================
class DamageNumber {
    constructor(x, y, damage) {
        this.x = x;
        this.y = y;
        this.damage = damage;
        this.vy = -2;
        this.life = 60;
        this.maxLife = 60;
    }

    update() {
        this.y += this.vy;
        this.vy *= 0.95;
        this.life--;
        return this.life > 0;
    }

    draw(ctx) {
        const alpha = this.life / this.maxLife;
        ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`-${this.damage}`, this.x, this.y);
    }
}

// ============================================================
// MAIN GAME CLASS
// ============================================================
class WormsGame {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;
        
        // Game state
        this.state = 'setup'; // setup, playing, paused, gameover
        this.teams = [];
        this.terrain = null;
        this.projectiles = [];
        this.effects = [];
        
        // Turn state
        this.currentTeamIndex = 0;
        this.currentWormIndex = 0;
        this.turnTimer = TURN_TIME;
        this.turnPhase = 'move'; // move, aim, fire, waiting
        
        // Input state
        this.keys = {};
        this.mouse = { x: 0, y: 0, down: false };
        this.aimAngle = 0;
        this.chargePower = 0;
        this.isCharging = false;
        
        // Weapons
        this.weapons = this.createWeapons();
        
        // UI elements
        this.teamNameEl = document.getElementById('team-name');
        this.wormInfoEl = document.getElementById('worm-info');
        this.timerEl = document.getElementById('turn-timer');
        this.weaponNameEl = document.getElementById('weapon-name');
        this.weaponAmmoEl = document.getElementById('weapon-ammo');
        this.startScreen = document.getElementById('start-screen');
        this.victoryScreen = document.getElementById('victory-screen');
        this.winnerText = document.getElementById('winner-text');
        this.statsEl = document.getElementById('stats');
        this.healthBarsContainer = document.getElementById('health-bars');
        
        // Bind events
        this.bindEvents();
        
        // Start loop
        this.lastTime = 0;
        this.gameLoop = this.gameLoop.bind(this);
        requestAnimationFrame(this.gameLoop);
    }

    createWeapons() {
        return [
            new Weapon({
                id: 'bazooka',
                name: 'Bazooka',
                ammo: -1,
                damage: 40,
                radius: 30,
                type: 'projectile',
                speed: 15
            }),
            new Weapon({
                id: 'grenade',
                name: 'Grenade',
                ammo: 3,
                damage: 50,
                radius: 40,
                type: 'projectile',
                speed: 12
            }),
            new Weapon({
                id: 'cluster',
                name: 'Cluster',
                ammo: 2,
                damage: 30,
                radius: 25,
                type: 'projectile',
                speed: 14
            }),
            new Weapon({
                id: 'holy',
                name: 'Holy Grenade',
                ammo: 1,
                damage: 80,
                radius: 60,
                type: 'projectile',
                speed: 10
            })
        ];
    }

    bindEvents() {
        // Keyboard
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            
            if (e.code === 'Space' && this.state === 'playing') {
                this.skipTurn();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        // Mouse
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
            
            // Update aim angle
            const worm = this.getCurrentWorm();
            if (worm && this.state === 'playing') {
                this.aimAngle = Math.atan2(
                    this.mouse.y - worm.y,
                    this.mouse.x - worm.x
                );
            }
        });
        
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.mouse.down = true;
                
                if (this.state === 'playing' && this.turnPhase === 'move') {
                    this.startCharging();
                }
            }
        });
        
        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.mouse.down = false;
                
                if (this.isCharging) {
                    this.fireWeapon();
                }
            }
        });
        
        // Buttons
        document.getElementById('start-btn').addEventListener('click', () => {
            this.startGame();
        });
        
        document.getElementById('restart-btn').addEventListener('click', () => {
            this.restartGame();
        });
    }

    startGame() {
        this.startScreen.classList.add('hidden');
        this.setupTeams();
        this.terrain = new Terrain(CANVAS_WIDTH, CANVAS_HEIGHT);
        this.spawnWorms();
        this.state = 'playing';
        this.startTurn();
        this.updateHealthBars();
    }

    setupTeams() {
        const teamConfigs = [
            { name: 'Red Raiders', color: '#ff6b6b' },
            { name: 'Blue Storm', color: '#4ecdc4' }
        ];
        
        this.teams = teamConfigs.map((config, index) => ({
            id: index,
            name: config.name,
            color: config.color,
            worms: []
        }));
    }

    spawnWorms() {
        const wormsPerTeam = 4;
        
        this.teams.forEach((team, teamIndex) => {
            for (let i = 0; i < wormsPerTeam; i++) {
                const x = 100 + (teamIndex * 500) + Math.random() * 300;
                const surfaceY = this.terrain.getSurfaceY(x);
                const y = surfaceY - 20;
                
                const worm = new Worm(x, y, teamIndex, i);
                team.worms.push(worm);
            }
        });
    }

    getCurrentTeam() {
        return this.teams[this.currentTeamIndex];
    }

    getCurrentWorm() {
        const team = this.getCurrentTeam();
        return team.worms[this.currentWormIndex];
    }

    getActiveWeapon() {
        return this.weapons[0]; // Bazooka for now
    }

    startTurn() {
        this.turnTimer = TURN_TIME;
        this.turnPhase = 'move';
        this.chargePower = 0;
        this.isCharging = false;
        
        // Find next alive worm
        this.findNextAliveWorm();
        
        // Update UI
        const team = this.getCurrentTeam();
        const worm = this.getCurrentWorm();
        
        this.teamNameEl.textContent = team.name;
        this.teamNameEl.style.color = team.color;
        this.wormInfoEl.textContent = `Worm ${worm.wormIndex + 1}`;
        
        const weapon = this.getActiveWeapon();
        this.weaponNameEl.textContent = weapon.name;
        this.weaponAmmoEl.textContent = weapon.ammo === -1 ? '∞' : weapon.ammo;
        
        this.timerEl.classList.remove('warning');
    }

    findNextAliveWorm() {
        let startIndex = this.currentWormIndex;
        let checked = 0;
        
        while (checked < this.teams[this.currentTeamIndex].worms.length) {
            const worm = this.teams[this.currentTeamIndex].worms[this.currentWormIndex];
            
            if (worm.health > 0) {
                return;
            }
            
            this.currentWormIndex = (this.currentWormIndex + 1) % this.teams[this.currentTeamIndex].worms.length;
            checked++;
        }
        
        // No alive worms found, end turn
        this.endTurn();
    }

    endTurn() {
        this.turnPhase = 'waiting';
        
        // Wait for all physics to settle
        setTimeout(() => {
            this.nextTurn();
        }, 500);
    }

    nextTurn() {
        // Check win condition
        if (this.checkWinCondition()) {
            return;
        }
        
        // Move to next team
        this.currentTeamIndex = (this.currentTeamIndex + 1) % this.teams.length;
        
        // Reset worm index for new team
        this.currentWormIndex = 0;
        
        this.startTurn();
    }

    checkWinCondition() {
        const aliveTeams = this.teams.filter(team => 
            team.worms.some(worm => worm.health > 0)
        );
        
        if (aliveTeams.length === 1) {
            this.gameOver(aliveTeams[0]);
            return true;
        }
        
        return false;
    }

    gameOver(winningTeam) {
        this.state = 'gameover';
        this.winnerText.textContent = `${winningTeam.name} Wins!`;
        this.winnerText.style.color = winningTeam.color;
        
        // Calculate stats
        const totalWorms = this.teams.reduce((sum, team) => 
            sum + team.worms.filter(w => w.health > 0).length, 0
        );
        this.statsEl.textContent = `${totalWorms} worm(s) survived`;
        
        this.victoryScreen.classList.remove('hidden');
    }

    skipTurn() {
        if (this.turnPhase === 'move') {
            this.endTurn();
        }
    }

    startCharging() {
        if (this.turnPhase !== 'move') return;
        
        this.isCharging = true;
        this.chargePower = 0;
        this.turnPhase = 'aim';
    }

    fireWeapon() {
        if (this.turnPhase !== 'aim' && this.turnPhase !== 'move') return;
        
        const worm = this.getCurrentWorm();
        const weapon = this.getActiveWeapon();
        
        if (!weapon.canFire()) {
            this.isCharging = false;
            this.turnPhase = 'move';
            return;
        }
        
        // Calculate launch velocity
        const power = Math.min(this.chargePower, 100);
        const speed = weapon.speed * (power / 50 + 0.5);
        
        const vx = Math.cos(this.aimAngle) * speed;
        const vy = Math.sin(this.aimAngle) * speed;
        
        // Create projectile
        const projectile = new Projectile(
            worm.x,
            worm.y,
            vx,
            vy,
            weapon,
            worm
        );
        
        this.projectiles.push(projectile);
        weapon.use();
        
        // Update weapon display
        this.weaponAmmoEl.textContent = weapon.ammo === -1 ? '∞' : weapon.ammo;
        
        this.isCharging = false;
        this.turnPhase = 'fire';
        
        // End turn after projectile lands
        setTimeout(() => {
            this.endTurn();
        }, 3000);
    }

    handleInput() {
        const worm = this.getCurrentWorm();
        if (!worm || worm.state === 'dead') return;
        
        if (this.turnPhase === 'move') {
            if (this.keys['ArrowLeft']) {
                worm.moveLeft();
            } else if (this.keys['ArrowRight']) {
                worm.moveRight();
            } else {
                worm.stopMoving();
            }
            
            if (this.keys['ArrowUp'] || this.keys['KeyW']) {
                worm.jump();
            }
        }
        
        // Charge power while mouse is down
        if (this.isCharging) {
            this.chargePower += 1;
        }
    }

    update(deltaTime) {
        if (this.state !== 'playing') return;
        
        // Handle input
        this.handleInput();
        
        // Update turn timer
        if (this.turnPhase !== 'waiting') {
            this.turnTimer -= deltaTime / 1000;
            
            if (this.turnTimer <= 0) {
                this.turnTimer = 0;
                this.endTurn();
            }
            
            // Warning when low
            if (this.turnTimer < 5) {
                this.timerEl.classList.add('warning');
            }
        }
        
        // Update timer display
        this.timerEl.textContent = Math.ceil(this.turnTimer);
        
        // Update worms
        this.teams.forEach(team => {
            team.worms.forEach(worm => {
                worm.update(this.terrain);
            });
        });
        
        // Update projectiles
        this.projectiles = this.projectiles.filter(projectile => {
            const alive = projectile.update();
            
            if (!alive) {
                // Explode on TTL
                this.handleExplosion(projectile.x, projectile.y, projectile.weapon.radius, projectile.weapon.damage);
                return false;
            }
            
            // Check terrain collision
            if (this.terrain.isSolid(projectile.x, projectile.y)) {
                this.handleExplosion(projectile.x, projectile.y, projectile.weapon.radius, projectile.weapon.damage);
                return false;
            }
            
            // Check worm collision
            this.teams.forEach(team => {
                team.worms.forEach(worm => {
                    if (worm.state !== 'dead') {
                        const bounds = worm.getBounds();
                        if (projectile.x >= bounds.x && 
                            projectile.x <= bounds.x + bounds.width &&
                            projectile.y >= bounds.y && 
                            projectile.y <= bounds.y + bounds.height) {
                            this.handleExplosion(projectile.x, projectile.y, projectile.weapon.radius, projectile.weapon.damage);
                            this.projectiles = this.projectiles.filter(p => p !== projectile);
                        }
                    }
                });
            });
            
            return true;
        });
        
        // Update effects
        this.effects = this.effects.filter(effect => effect.update());
    }

    handleExplosion(x, y, radius, damage) {
        // Destroy terrain
        this.terrain.explode(x, y, radius);
        
        // Create explosion effect
        this.effects.push(new Explosion(x, y, radius));
        
        // Damage nearby worms
        this.teams.forEach(team => {
            team.worms.forEach(worm => {
                if (worm.state !== 'dead') {
                    const dx = worm.x - x;
                    const dy = worm.y - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < radius) {
                        const damageAmount = Math.floor(damage * (1 - distance / radius));
                        const actualDamage = worm.takeDamage(damageAmount);
                        
                        if (actualDamage > 0) {
                            this.effects.push(new DamageNumber(worm.x, worm.y - 20, actualDamage));
                            
                            // Push worm away from explosion
                            const pushForce = 5 * (1 - distance / radius);
                            const angle = Math.atan2(dy, dx);
                            worm.velocity.x += Math.cos(angle) * pushForce;
                            worm.velocity.y += Math.sin(angle) * pushForce;
                            worm.state = 'falling';
                        }
                    }
                }
            });
        });
        
        this.updateHealthBars();
    }

    drawTrajectoryPreview() {
        if (this.turnPhase !== 'aim' && !this.isCharging) return;
        
        const worm = this.getCurrentWorm();
        if (!worm) return;
        
        const weapon = this.getActiveWeapon();
        const power = Math.min(this.chargePower, 100);
        const speed = weapon.speed * (power / 50 + 0.5);
        
        const vx = Math.cos(this.aimAngle) * speed;
        const vy = Math.sin(this.aimAngle) * speed;
        
        // Draw trajectory dots
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        
        for (let i = 0; i < 20; i++) {
            const t = i * 3;
            const px = worm.x + vx * t;
            const py = worm.y + vy * t + 0.5 * GRAVITY * t * t;
            
            if (this.terrain.isSolid(px, py) || py > WATER_LEVEL) break;
            
            this.ctx.beginPath();
            this.ctx.arc(px, py, 2, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        // Draw aim line
        this.ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(worm.x, worm.y);
        this.ctx.lineTo(
            worm.x + Math.cos(this.aimAngle) * 50,
            worm.y + Math.sin(this.aimAngle) * 50
        );
        this.ctx.stroke();
    }

    draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw terrain
        if (this.terrain) {
            this.terrain.draw(this.ctx);
        }
        
        // Draw worms
        this.teams.forEach((team, teamIndex) => {
            this.ctx.fillStyle = team.color;
            
            team.worms.forEach(worm => {
                if (worm.state !== 'dead') {
                    const isActive = teamIndex === this.currentTeamIndex && 
                                     worm === this.getCurrentWorm();
                    worm.draw(this.ctx, isActive);
                }
            });
        });
        
        // Draw projectiles
        this.projectiles.forEach(projectile => {
            projectile.draw(this.ctx);
        });
        
        // Draw effects
        this.effects.forEach(effect => {
            effect.draw(this.ctx);
        });
        
        // Draw trajectory preview
        this.drawTrajectoryPreview();
        
        // Draw charge bar
        if (this.isCharging) {
            const worm = this.getCurrentWorm();
            if (worm) {
                const barWidth = 50;
                const barHeight = 8;
                const chargePercent = Math.min(this.chargePower / 100, 1);
                
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(worm.x - barWidth / 2, worm.y + worm.height / 2 + 10, barWidth, barHeight);
                
                const r = Math.floor(255 * chargePercent);
                const g = Math.floor(255 * (1 - chargePercent));
                this.ctx.fillStyle = `rgb(${r}, ${g}, 0)`;
                this.ctx.fillRect(worm.x - barWidth / 2, worm.y + worm.height / 2 + 10, barWidth * chargePercent, barHeight);
            }
        }
    }

    updateHealthBars() {
        this.healthBarsContainer.innerHTML = '';
        
        this.teams.forEach((team, teamIndex) => {
            team.worms.forEach((worm, wormIndex) => {
                if (worm.health > 0 || worm.state === 'dead') {
                    const container = document.createElement('div');
                    container.className = 'health-bar-container';
                    
                    const label = document.createElement('div');
                    label.className = 'health-bar-label';
                    label.textContent = `${team.name} - W${wormIndex + 1}`;
                    label.style.color = team.color;
                    
                    const bar = document.createElement('div');
                    bar.className = 'health-bar';
                    
                    const fill = document.createElement('div');
                    fill.className = `health-bar-fill team-${teamIndex}`;
                    fill.style.width = `${worm.health}%`;
                    
                    if (worm.health <= 0) {
                        fill.style.background = '#666';
                    }
                    
                    bar.appendChild(fill);
                    container.appendChild(label);
                    container.appendChild(bar);
                    this.healthBarsContainer.appendChild(container);
                }
            });
        });
    }

    gameLoop(timestamp) {
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;
        
        this.update(deltaTime);
        this.draw();
        
        requestAnimationFrame(this.gameLoop);
    }

    restartGame() {
        this.victoryScreen.classList.add('hidden');
        this.teams = [];
        this.projectiles = [];
        this.effects = [];
        this.currentTeamIndex = 0;
        this.currentWormIndex = 0;
        
        this.startGame();
    }
}

// ============================================================
// INITIALIZE GAME
// ============================================================
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new WormsGame();
});
