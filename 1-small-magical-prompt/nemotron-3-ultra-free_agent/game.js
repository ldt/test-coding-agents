const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const WORM_RADIUS = 12;
const WORM_MOVE_SPEED = 120;
const WORM_JUMP_FORCE = -350;
const GRAVITY = 300;
const PROJECTILE_SPEED = 350;
const EXPLOSION_RADIUS_BASE = 40;
const SCREEN_SHAKE_MAX = 15;

const WEAPONS = [
  { name: 'Bazooka', type: 'projectile', gravity: true, damage: 50, radius: 45, color: '#ff6b35', speed: 1.0 },
  { name: 'Grenade', type: 'projectile', gravity: true, timer: 3000, damage: 45, radius: 55, color: '#ffcc00', speed: 0.8 },
  { name: 'Shotgun', type: 'instant', pellets: 8, spread: 0.4, damage: 12, range: 250, color: '#ffaa00', speed: 1.0 }
];

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let terrainImageData = null;
let terrainHeightMap = null;

const keys = { left: false, right: false, up: false, down: false, space: false };

const gameState = {
  phase: 'start',
  currentPlayer: 0,
  players: [],
  projectiles: [],
  particles: [],
  screenShake: 0,
  aimAngle: -Math.PI / 4,
  winner: null
};

function generateTerrain() {
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const heightMap = new Float32Array(width);
  
  const roughness = 0.5;
  const midDisplacement = 150;
  
  heightMap[0] = height * 0.65;
  heightMap[width - 1] = height * 0.65;
  
  function displace(left, right, displacement) {
    if (right - left <= 1) return;
    const mid = Math.floor((left + right) / 2);
    heightMap[mid] = (heightMap[left] + heightMap[right]) / 2 + (Math.random() - 0.5) * displacement;
    displace(left, mid, displacement * roughness);
    displace(mid, right, displacement * roughness);
  }
  
  displace(0, width - 1, midDisplacement);
  
  for (let i = 1; i < width - 1; i++) {
    heightMap[i] = (heightMap[i - 1] + heightMap[i] + heightMap[i + 1]) / 3;
  }
  
  const baseHeight = height * 0.75;
  for (let i = 0; i < width; i++) {
    heightMap[i] = Math.max(baseHeight, Math.min(height - 20, heightMap[i]));
  }
  
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  
  const terrainColor1 = [45, 74, 62, 255];
  const terrainColor2 = [35, 58, 48, 255];
  const terrainColor3 = [25, 42, 35, 255];
  
  for (let x = 0; x < width; x++) {
    const h = Math.floor(heightMap[x]);
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      if (y >= h) {
        const depth = y - h;
        let r, g, b, a;
        if (depth < 10) {
          const t = depth / 10;
          r = terrainColor1[0] * (1 - t) + terrainColor2[0] * t;
          g = terrainColor1[1] * (1 - t) + terrainColor2[1] * t;
          b = terrainColor1[2] * (1 - t) + terrainColor2[2] * t;
          a = 255;
        } else if (depth < 40) {
          const t = (depth - 10) / 30;
          r = terrainColor2[0] * (1 - t) + terrainColor3[0] * t;
          g = terrainColor2[1] * (1 - t) + terrainColor3[1] * t;
          b = terrainColor2[2] * (1 - t) + terrainColor3[2] * t;
          a = 255;
        } else {
          r = terrainColor3[0];
          g = terrainColor3[1];
          b = terrainColor3[2];
          a = 255;
        }
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      } else {
        data[idx + 3] = 0;
      }
    }
  }
  
  return { imageData: imgData, heightMap };
}

function destroyTerrain(x, y, radius) {
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const data = terrainImageData.data;
  let changed = false;
  
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(x - radius));
  const maxX = Math.min(width - 1, Math.ceil(x + radius));
  const minY = Math.max(0, Math.floor(y - radius));
  const maxY = Math.min(height - 1, Math.ceil(y + radius));
  
  for (let px = minX; px <= maxX; px++) {
    for (let py = minY; py <= maxY; py++) {
      const dx = px - x;
      const dy = py - y;
      const dist2 = dx * dx + dy * dy;
      
      if (dist2 <= r2) {
        const idx = (py * width + px) * 4 + 3;
        if (data[idx] > 0) {
          const falloff = 1 - Math.sqrt(dist2) / radius;
          data[idx] = Math.max(0, data[idx] - 255 * falloff * 0.8);
          changed = true;
        }
      }
    }
  }
  
  if (changed) {
    for (let px = minX; px <= maxX; px++) {
      let h = height - 1;
      for (let py = height - 1; py >= 0; py--) {
        const idx = (py * width + px) * 4 + 3;
        if (data[idx] > 128) {
          h = py;
          break;
        }
      }
      terrainHeightMap[px] = h;
    }
  }
}

function findGroundY(x, startY) {
  x = Math.max(0, Math.min(CANVAS_WIDTH - 1, Math.floor(x)));
  return terrainHeightMap[x];
}

function isSolidAt(x, y) {
  if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return true;
  const idx = (Math.floor(y) * CANVAS_WIDTH + Math.floor(x)) * 4 + 3;
  return terrainImageData.data[idx] > 128;
}

function createExplosion(x, y, radius, color, damage, owner) {
  destroyTerrain(x, y, radius);
  gameState.screenShake = Math.min(SCREEN_SHAKE_MAX, radius * 0.25);
  
  const particleCount = Math.floor(radius * 1.5);
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    const life = 300 + Math.random() * 500;
    gameState.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 50,
      life, maxLife: life,
      color: color || ['#ff6b35', '#ffaa00', '#ff4400', '#ffff00'][Math.floor(Math.random() * 4)],
      size: 2 + Math.random() * 4
    });
  }
  
  for (let i = 0; i < gameState.players.length; i++) {
    if (i === owner) continue;
    const p = gameState.players[i];
    if (!p.isAlive) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < radius) {
      const damageMult = 1 - dist / radius;
      const dmg = Math.round(damage * damageMult);
      p.health = Math.max(0, p.health - dmg);
      if (dist > 0) {
        const force = (radius - dist) * 6;
        p.vx += (dx / dist) * force;
        p.vy -= force * 0.5;
      }
      if (p.health <= 0) {
        p.isAlive = false;
        gameState.winner = owner;
        gameState.phase = 'gameOver';
      }
    }
  }
  
  updateUI();
}

function fireWeapon() {
  const player = getCurrentPlayer();
  const weapon = WEAPONS[player.weaponIndex];
  
  const angle = player.faceRight ? player.angle : Math.PI - player.angle;
  const startX = player.x + Math.cos(angle) * (WORM_RADIUS + 5);
  const startY = player.y + Math.sin(angle) * (WORM_RADIUS + 5);
  const speed = PROJECTILE_SPEED * weapon.speed;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  
  gameState.phase = 'firing';
  
  if (weapon.type === 'instant') {
    for (let i = 0; i < weapon.pellets; i++) {
      const spreadAngle = angle + (Math.random() - 0.5) * weapon.spread;
      raycastShot(startX, startY, spreadAngle, weapon, player);
    }
    gameState.phase = 'turnEnd';
    setTimeout(switchTurn, 300);
  } else {
    const proj = {
      x: startX, y: startY,
      vx, vy,
      weaponType: player.weaponIndex,
      owner: gameState.currentPlayer,
      timer: weapon.timer || 0,
      trail: [{ x: startX, y: startY }]
    };
    gameState.projectiles.push(proj);
  }
}

function raycastShot(x, y, angle, weapon, owner) {
  const step = 5;
  let dist = 0;
  let hit = false;
  
  while (dist < weapon.range && !hit) {
    const nx = x + Math.cos(angle) * dist;
    const ny = y + Math.sin(angle) * dist;
    
    if (nx < 0 || nx >= CANVAS_WIDTH || ny < 0 || ny >= CANVAS_HEIGHT) break;
    
    if (isSolidAt(nx, ny)) {
      createExplosion(nx, ny, weapon.radius / 3, weapon.color, weapon.damage, gameState.currentPlayer);
      hit = true;
      break;
    }
    
    for (let i = 0; i < gameState.players.length; i++) {
      if (i === gameState.currentPlayer) continue;
      const p = gameState.players[i];
      if (!p.isAlive) continue;
      const dx = p.x - nx;
      const dy = p.y - ny;
      if (dx * dx + dy * dy < WORM_RADIUS * WORM_RADIUS * 2) {
        createExplosion(nx, ny, weapon.radius / 2, weapon.color, weapon.damage * 2, gameState.currentPlayer);
        hit = true;
        break;
      }
    }
    
    dist += step;
  }
  
  if (!hit) {
    const nx = x + Math.cos(angle) * dist;
    const ny = y + Math.sin(angle) * dist;
    createExplosion(nx, ny, weapon.radius / 4, weapon.color, weapon.damage / 2, gameState.currentPlayer);
  }
}

function updateProjectiles(dt) {
  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    const p = gameState.projectiles[i];
    const weapon = WEAPONS[p.weaponType];
    
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 10) p.trail.shift();
    
    if (p.timer > 0) {
      p.timer -= dt * 1000;
      if (p.timer <= 0) {
        createExplosion(p.x, p.y, weapon.radius, weapon.color, weapon.damage, p.owner);
        gameState.projectiles.splice(i, 1);
        continue;
      }
    }
    
    if (p.x < 0 || p.x >= CANVAS_WIDTH || p.y >= CANVAS_HEIGHT) {
      if (p.y >= CANVAS_HEIGHT) {
        createExplosion(p.x, p.y, weapon.radius, weapon.color, weapon.damage, p.owner);
      }
      gameState.projectiles.splice(i, 1);
      continue;
    }
    
    if (isSolidAt(p.x, p.y)) {
      createExplosion(p.x, p.y, weapon.radius, weapon.color, weapon.damage, p.owner);
      gameState.projectiles.splice(i, 1);
      continue;
    }
    
    for (let j = 0; j < gameState.players.length; j++) {
      if (j === p.owner) continue;
      const target = gameState.players[j];
      if (!target.isAlive) continue;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      if (dx * dx + dy * dy < WORM_RADIUS * WORM_RADIUS * 2.5) {
        createExplosion(p.x, p.y, weapon.radius, weapon.color, weapon.damage, p.owner);
        gameState.projectiles.splice(i, 1);
        break;
      }
    }
  }
}

function updateParticles(dt) {
  for (let i = gameState.particles.length - 1; i >= 0; i--) {
    const p = gameState.particles[i];
    p.life -= dt * 1000;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += GRAVITY * 0.3 * dt;
    if (p.life <= 0) {
      gameState.particles.splice(i, 1);
    }
  }
}

function getCurrentPlayer() {
  return gameState.players[gameState.currentPlayer];
}

function switchTurn() {
  if (gameState.phase === 'gameOver') return;
  
  const alive = gameState.players.filter(p => p.isAlive);
  if (alive.length <= 1) {
    gameState.phase = 'gameOver';
    gameState.winner = alive[0] ? gameState.players.indexOf(alive[0]) : 0;
    showGameOver();
    return;
  }
  
  let next = (gameState.currentPlayer + 1) % 2;
  while (!gameState.players[next].isAlive) {
    next = (next + 1) % 2;
  }
  gameState.currentPlayer = next;
  gameState.phase = 'aiming';
  gameState.aimAngle = -Math.PI / 4;
  
  const player = getCurrentPlayer();
  player.angle = player.faceRight ? gameState.aimAngle : Math.PI - gameState.aimAngle;
  
  updateUI();
}

function createPlayers() {
  const colors = [
    { main: '#4ecdc4', dark: '#2ea8a0' },
    { main: '#ff6b6b', dark: '#e84a4a' }
  ];
  
  const positions = [
    { x: CANVAS_WIDTH * 0.2, y: 100 },
    { x: CANVAS_WIDTH * 0.8, y: 100 }
  ];
  
  gameState.players = [];
  for (let i = 0; i < 2; i++) {
    const groundY = findGroundY(positions[i].x, 0);
    gameState.players.push({
      x: positions[i].x,
      y: groundY - WORM_RADIUS,
      vx: 0, vy: 0,
      health: 100, maxHealth: 100,
      color: colors[i].main,
      colorDark: colors[i].dark,
      angle: i === 0 ? -Math.PI / 4 : Math.PI + Math.PI / 4,
      weaponIndex: 0,
      faceRight: i === 0,
      onGround: true,
      isAlive: true
    });
  }
  gameState.currentPlayer = 0;
  gameState.aimAngle = -Math.PI / 4;
  getCurrentPlayer().angle = gameState.players[0].faceRight ? gameState.aimAngle : Math.PI - gameState.aimAngle;
}

function generateTerrain() {
  const result = generateTerrain();
  terrainImageData = result.imageData;
  terrainHeightMap = result.heightMap;
}

function updatePlayerPhysics(player, dt) {
  if (!player.isAlive) return;
  
  player.vy += GRAVITY * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  
  player.vx *= 0.85;
  
  const groundY = findGroundY(player.x, player.y - WORM_RADIUS);
  if (player.y + WORM_RADIUS >= groundY) {
    player.y = groundY - WORM_RADIUS;
    player.vy = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }
  
  player.x = Math.max(WORM_RADIUS, Math.min(CANVAS_WIDTH - WORM_RADIUS, player.x));
}

function handleInput() {
  if (gameState.phase !== 'aiming') return;
  
  const player = getCurrentPlayer();
  if (!player.isAlive) return;
  
  if (keys.left) {
    player.vx -= WORM_MOVE_SPEED * 0.02;
    player.faceRight = false;
  }
  if (keys.right) {
    player.vx += WORM_MOVE_SPEED * 0.02;
    player.faceRight = true;
  }
  if (keys.up && player.onGround) {
    player.vy = WORM_JUMP_FORCE;
    player.onGround = false;
  }
  
  if (keys.up) {
    gameState.aimAngle = Math.max(-Math.PI / 2, gameState.aimAngle - 0.03);
  }
  if (keys.down) {
    gameState.aimAngle = Math.min(Math.PI / 2, gameState.aimAngle + 0.03);
  }
  
  player.angle = player.faceRight ? gameState.aimAngle : Math.PI - gameState.aimAngle;
}

function updateGame(dt) {
  if (gameState.phase === 'start' || gameState.phase === 'gameOver') return;
  
  handleInput();
  
  for (const player of gameState.players) {
    updatePlayerPhysics(player, dt);
  }
  
  if (gameState.phase === 'firing') {
    updateProjectiles(dt);
    if (gameState.projectiles.length === 0) {
      gameState.phase = 'turnEnd';
      setTimeout(switchTurn, 300);
    }
  }
  
  updateParticles(dt);
  
  if (gameState.screenShake > 0) {
    gameState.screenShake = Math.max(0, gameState.screenShake - dt * 30);
  }
}

function drawTerrain() {
  ctx.putImageData(terrainImageData, 0, 0);
}

function drawWorm(player) {
  if (!player.isAlive) return;
  
  ctx.save();
  ctx.translate(player.x, player.y);
  if (!player.faceRight) ctx.scale(-1, 1);
  
  const gradient = ctx.createRadialGradient(-3, -4, 0, 0, 0, WORM_RADIUS);
  gradient.addColorStop(0, player.color);
  gradient.addColorStop(1, player.colorDark);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, WORM_RADIUS, WORM_RADIUS * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.fillStyle = player.colorDark;
  ctx.beginPath();
  ctx.ellipse(-3, -4, WORM_RADIUS * 0.6, WORM_RADIUS * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-6, -6, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(-5, -6, 1.5, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const aimAngle = player.faceRight ? player.angle : Math.PI - player.angle;
  ctx.beginPath();
  ctx.moveTo(8, 2);
  ctx.lineTo(8 + Math.cos(aimAngle) * 22, 8 + Math.sin(aimAngle) * 22);
  ctx.stroke();
  
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 2);
  ctx.lineTo(8 + Math.cos(aimAngle) * 20, 8 + Math.sin(aimAngle) * 20);
  ctx.stroke();
  
  ctx.restore();
}

function drawProjectiles() {
  for (const proj of gameState.projectiles) {
    const weapon = WEAPONS[proj.weaponType];
    
    ctx.strokeStyle = weapon.color + '80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < proj.trail.length; i++) {
      const p = proj.trail[i];
      const alpha = i / proj.trail.length;
      ctx.globalAlpha = alpha * 0.5;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    
    ctx.fillStyle = weapon.color;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(proj.x - 1, proj.y - 1, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of gameState.particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawUI() {
  const p1 = gameState.players[0];
  const p2 = gameState.players[1];
  
  document.getElementById('health1').style.width = `${(p1.health / p1.maxHealth) * 100}%`;
  document.getElementById('healthText1').textContent = p1.health;
  document.getElementById('health2').style.width = `${(p2.health / p2.maxHealth) * 100}%`;
  document.getElementById('healthText2').textContent = p2.health;
  
  const turnEl = document.getElementById('turnIndicator');
  if (gameState.phase === 'gameOver') {
    turnEl.textContent = 'GAME OVER';
    turnEl.style.color = '#ff4444';
    turnEl.style.textShadow = '0 0 10px #ff4444';
  } else {
    const current = gameState.players[gameState.currentPlayer];
    turnEl.textContent = `PLAYER ${gameState.currentPlayer + 1}'S TURN`;
    turnEl.style.color = current.color;
    turnEl.style.textShadow = `0 0 10px ${current.color}`;
  }
  
  document.querySelectorAll('.weapon-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === getCurrentPlayer().weaponIndex);
  });
}

function updateUI() {
  drawUI();
}

function render() {
  const shakeX = gameState.screenShake > 0 ? (Math.random() - 0.5) * gameState.screenShake * 2 : 0;
  const shakeY = gameState.screenShake > 0 ? (Math.random() - 0.5) * gameState.screenShake * 2 : 0;
  
  ctx.save();
  ctx.translate(shakeX, shakeY);
  
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#0a0f1a');
  gradient.addColorStop(0.5, '#1a1a2e');
  gradient.addColorStop(1, '#16213e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  drawTerrain();
  drawProjectiles();
  drawParticles();
  
  for (const player of gameState.players) {
    drawWorm(player);
  }
  
  ctx.restore();
}

let lastTime = 0;
function gameLoop(timestamp) {
  const dt = Math.min(1/30, (timestamp - lastTime) / 1000);
  lastTime = timestamp;
  
  updateGame(dt);
  render();
  
  requestAnimationFrame(gameLoop);
}

function startGame() {
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('instructionsOverlay').classList.add('hidden');
  
  generateTerrain();
  createPlayers();
  gameState.phase = 'aiming';
  gameState.projectiles = [];
  gameState.particles = [];
  gameState.screenShake = 0;
  gameState.winner = null;
  updateUI();
}

function showGameOver() {
  const winner = gameState.winner;
  document.getElementById('winnerText').textContent = `PLAYER ${winner + 1} WINS!`;
  document.getElementById('winnerText').style.color = gameState.players[winner].color;
  document.getElementById('gameOverOverlay').classList.remove('hidden');
}

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'ArrowLeft': keys.left = true; break;
    case 'ArrowRight': keys.right = true; break;
    case 'ArrowUp': keys.up = true; break;
    case 'ArrowDown': keys.down = true; break;
    case 'Space': 
      e.preventDefault();
      keys.space = true;
      if (gameState.phase === 'aiming') {
        fireWeapon();
      }
      break;
    case 'Digit1': case 'Key1':
      if (gameState.phase === 'aiming') {
        getCurrentPlayer().weaponIndex = 0;
        updateUI();
      }
      break;
    case 'Digit2': case 'Key2':
      if (gameState.phase === 'aiming') {
        getCurrentPlayer().weaponIndex = 1;
        updateUI();
      }
      break;
    case 'Digit3': case 'Key3':
      if (gameState.phase === 'aiming') {
        getCurrentPlayer().weaponIndex = 2;
        updateUI();
      }
      break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowLeft': keys.left = false; break;
    case 'ArrowRight': keys.right = false; break;
    case 'ArrowUp': keys.up = false; break;
    case 'ArrowDown': keys.down = false; break;
    case 'Space': keys.space = false; break;
  }
});

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('closeInstructions').addEventListener('click', () => {
  document.getElementById('instructionsOverlay').classList.add('hidden');
});

document.querySelectorAll('.weapon-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (gameState.phase === 'aiming') {
      getCurrentPlayer().weaponIndex = parseInt(btn.dataset.weapon);
      updateUI();
    }
  });
});

requestAnimationFrame(gameLoop);