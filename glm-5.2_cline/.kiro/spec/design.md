# Design

## Architecture Overview

The game is a single-page vanilla HTML/CSS/JS application. It uses an HTML5 `<canvas>` for rendering and a `requestAnimationFrame` game loop. State is managed in a central `Game` object. No external libraries are used.

### File Structure
```
glm-5.2_cline/
├── .kiro/spec/
│   ├── requirements.md
│   ├── design.md
│   └── tasks.md
├── index.html      # Markup, canvas, UI overlay
├── styles.css      # Layout, UI styling, theming
└── game.js         # All game logic (loaded as a module-free script)
```

## Components

### 1. Game State (`Game` object)
Holds all mutable state:
- `teams`: array of 2 teams, each with array of worms.
- `currentTeamIndex`, `currentWormIndex`: active worm.
- `terrain`: reference to the Terrain object.
- `projectiles`: active projectiles array.
- `explosions`: active explosion effects array.
- `wind`: `{ dir, mag }`.
- `turnTimer`: seconds remaining.
- `phase`: `'aiming' | 'charging' | 'projectile' | 'postturn' | 'gameover'`.
- `selectedWeapon`: index 0–3.
- `power`: 0–100 charging value.
- `aimAngle`: radians.

### 2. Terrain
- Represented as an offscreen `ImageData` buffer (per-pixel solidity mask) plus a rendered canvas.
- Generation: use layered sine waves + noise to create a heightmap; fill below the heightmap as solid.
- Collision: check alpha channel of the pixel at a coordinate.
- Destruction: `eraseCircle(x, y, radius)` sets pixels in a circle to transparent and re-renders.
- Surface finding: scan upward from a y to find the first solid pixel (for worm placement).

### 3. Worm
Properties: `x`, `y`, `vx`, `vy`, `hp`, `team`, `name`, `alive`, `radius`, `facing`.
Physics: gravity applied each frame; when falling, check landing; apply fall damage if `vy` exceeds threshold.

### 4. Physics
- Gravity constant `G = 0.4` px/frame².
- Wind applies horizontal acceleration to bazooka projectiles only.
- Grenade bounces: on terrain collision, reflect velocity with damping (`0.5`) and friction.
- Worms settle on terrain surface; small horizontal movement allowed during turn (walk) via A/D keys (optional, included).

### 5. Weapons
Each weapon is a factory producing a projectile or instant effect:
- **Bazooka**: projectile with gravity + wind; explodes on contact.
- **Grenade**: projectile with gravity, bounces, 3s fuse.
- **Shotgun**: raycast in aim direction with spread; damage worms along the ray within range.
- **Airstrike**: schedules 3 falling bombs at target x after 2s delay.

Explosion: `createExplosion(x, y, radius, damage)` — erases terrain, damages worms within radius proportional to distance, applies knockback.

### 6. Rendering
- Clear canvas; draw sky gradient background.
- Draw terrain canvas.
- Draw worms (body + health bar + name + active highlight).
- Draw projectiles.
- Draw explosions (expanding fading circles).
- Draw aim line + power arc when aiming/charging.
- Draw wind indicator (top center).
- Draw HUD (turn info, timer, weapon buttons handled in HTML overlay).

### 7. Input
- `mousemove`: update aim angle from active worm to cursor.
- `mousedown` (left): begin charging power (if phase is `aiming`).
- `mouseup` (left): fire weapon at current power; transition to `projectile` phase.
- `keydown`: 1–4 select weapon; Space/Enter skip turn; R restart.
- A/D: walk active worm left/right (limited per turn).

### 8. UI (HTML overlay)
- Top bar: team name, active worm, timer, wind indicator.
- Bottom bar: weapon buttons (1–4) with icons/labels.
- Game-over overlay: winner text + Play Again button.
- Styled with CSS; positioned over the canvas.

## Data Model

```js
Worm = { x, y, vx, vy, hp, team:0|1, name, alive, radius, facing:-1|1 }
Team = { name, color, worms: Worm[] }
Projectile = { x, y, vx, vy, type, fuse?, bounces?, owner }
Explosion = { x, y, radius, maxRadius, life, maxLife }
Wind = { dir:-1|1, mag: 0..5 }
```

## Key Algorithms

### Terrain Generation
1. Create heightmap array of width = canvas width.
2. For each x, height = base + sum of sine waves of varying frequency/amplitude + random noise.
3. Fill `ImageData` pixels below height with opaque terrain color; above transparent.

### Explosion Damage
For each alive worm: `dist = distance(worm, explosion.center)`; if `dist < explosion.radius`: `damage = maxDamage * (1 - dist/radius)`; apply knockback away from center scaled by `(1 - dist/radius)`.

### Turn Flow
1. Start turn: pick next team's next worm, reset timer, randomize wind, phase = `aiming`.
2. Player aims & charges; on fire → phase = `projectile`.
3. While projectiles active, simulate physics.
4. When no projectiles and no pending airstrikes → phase = `postturn` (3s delay).
5. After delay → check win condition; if not over, start next turn.

## Styling Approach
- Dark sky theme with team colors (Red `#e74c3c`, Blue `#3498db`).
- HUD uses semi-transparent panels with rounded corners.
- Weapon buttons highlight when selected.
- Canvas centered; responsive scaling via CSS `max-width:100%` and JS resize handling.