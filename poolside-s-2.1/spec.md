# Worms — HTML Game Specification (SDD Kiro Style)

## 1. Requirements

### 1.1 Overview
Create a browser-based turn-based artillery game inspired by *Worms*. Two teams of worms take turns aiming and firing projectiles across destructible terrain. The last team standing wins.

### 1.2 Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | The game renders a 2D side-view battlefield on an HTML `<canvas>` element. |
| FR-02 | The battlefield contains destructible terrain generated from a procedurally-created heightmap (mountains, valleys). |
| FR-03 | Two teams of worms (Team Red and Team Blue) are placed on opposite sides of the terrain. |
| FR-04 | Each worm has a position (x, y), a facing direction (left/right), and hit points (HP). Default HP = 100. |
| FR-05 | The game is turn-based: only the current player's active worm can act. |
| FR-06 | The active worm can aim a weapon by dragging or using angle/power controls. |
| FR-07 | The active worm can fire a projectile that follows a ballistic (parabolic) trajectory under gravity. |
| FR-08 | Projectiles collide with terrain and worms. Terrain collision destroys (removes) terrain pixels in a circular blast radius. |
| FR-09 | Worm collision with a projectile explosion deals damage based on distance from the blast center. |
| FR-10 | Worms that fall into water (below terrain) or reach 0 HP are eliminated. |
| FR-11 | When a worm is eliminated, the next worm on the same team becomes active (if any). |
| FR-12 | When all worms on a team are eliminated, the opposing team wins. |
| FR-13 | The UI displays: current team turn, active worm HP, remaining worms per team, and a health bar. |
| FR-14 | The game includes a "Skip Turn" button to pass the turn to the opponent. |
| FR-15 | The game includes a "Restart" button to reset the battlefield and worms. |
| FR-16 | A wind factor affects projectile trajectory (optional, adds realism). |
| FR-17 | Explosions can cause chain reactions if nearby projectiles or worms are affected. |

### 1.3 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | The game must run in any modern browser (Chrome, Firefox, Safari, Edge) without external dependencies. |
| NFR-02 | The game must use only three files: `index.html`, `style.css`, `game.js`. |
| NFR-03 | The game must maintain a stable frame rate (≥ 30 FPS) on a standard desktop. |
| NFR-04 | The game must be playable on a canvas of at least 1024×576 pixels. |
| NFR-05 | The game must provide visual feedback for aiming (trajectory preview arc). |
| NFR-06 | The game must be self-contained — no network requests after initial load. |

### 1.4 User Stories

- **As a** player, **I want** to aim my worm's weapon, **so that** I can hit enemies across the terrain.
- **As a** player, **I want** to see the trajectory preview, **so that** I can predict where my shot will land.
- **As a** player, **I want** to see my worm's health, **so that** I know how much damage I can take.
- **As a** player, **I want** to see which team's turn it is, **so that** I know when to act.
- **As a** player, **I want** to restart the game, **so that** I can play again after a match ends.

---

## 2. Design

### 2.1 Architecture

```
index.html
├── <canvas id="gameCanvas">   — main rendering surface
├── <div id="ui">              — HUD and controls
│   ├── #turnIndicator        — current team turn
│   ├── #healthBar            — active worm health bar
│   ├── #teamInfo             — worm counts per team
│   ├── #controls             — aim, fire, skip, restart buttons
│   └── #trajectoryCanvas     — overlay for aim preview
└── <script src="game.js">     — game logic
style.css                      — all visual styling
```

### 2.2 Module Structure (game.js)

The JavaScript is organized into the following logical sections:

1. **Constants & Configuration** — canvas dimensions, gravity, weapon stats, team colors.
2. **Utility Functions** — random number generation, distance calculation, clamping.
3. **Terrain System** — generates and stores the destructible terrain as a pixel array (ImageData).
4. **Worm Class** — position, facing, HP, team, render, takeDamage, isAlive.
5. **Projectile Class** — position, velocity, gravity, wind, update, render, explode.
6. **Game Class** — central state machine: turn management, input handling, collision detection, win condition, rendering loop.
7. **Input Handlers** — mouse/touch for aiming and firing.
8. **Rendering** — draw terrain, worms, projectiles, UI.
9. **Initialization** — bootstrap the game on DOMContentLoaded.

### 2.3 Data Structures

#### Terrain
- Stored as a `Uint8ClampedArray` of RGBA pixel data from `canvas.getImageData()`.
- A pixel is "solid" if its alpha channel > 0.
- `digCircle(x, y, radius)` sets pixels within a circle to transparent.

#### Worm
```javascript
class Worm {
  x, y            // position (feet position on terrain)
  facing          // 1 = right, -1 = left
  hp              // hit points
  team            // 'red' | 'blue'
  width, height   // sprite dimensions
}
```

#### Projectile
```javascript
class Projectile {
  x, y            // position
  vx, vy          // velocity
  gravity         // acceleration downward
  windFactor      // horizontal drift
  radius          // visual size
  active          // false after explosion
}
```

#### Game State
```javascript
class Game {
  canvas, ctx     // rendering context
  terrain         // pixel data array
  worms           // array of Worm instances
  projectiles     // array of active Projectile instances
  currentTeam     // 'red' | 'blue'
  wind            // current wind value
  gameState       // 'aiming' | 'firing' | 'exploding' | 'gameOver'
  aimAngle, aimPower // current aim settings
}
```

### 2.4 Game Flow

```
[Init] → Generate Terrain → Place Worms → [Aiming Phase]
                                      ↓
                              [Fire Projectile]
                                      ↓
                        [Projectile Flying (loop)]
                                      ↓
                           [Explosion + Damage]
                                      ↓
                        [Check Eliminations]
                                      ↓
                         [Check Win Condition]
                                      ↓
                          Yes → [Game Over]
                          No  → Next Team → [Aiming Phase]
```

### 2.5 Physics Model

- **Gravity**: `vy += GRAVITY` each frame (e.g., 0.3 px/frame²).
- **Wind**: `vx += wind * 0.01` each frame (subtle horizontal drift).
- **Projectile motion**: `x += vx; y += vy` each frame.
- **Terrain collision**: when projectile y exceeds terrain surface at x, trigger explosion.
- **Blast damage**: `damage = max(0, BASE_DAMAGE * (1 - distance / BLAST_RADIUS))`.

### 2.6 Rendering Strategy

- **Terrain**: drawn once via `putImageData`, then re-drawn only when terrain changes (after explosions).
- **Worms**: drawn as simple sprites (colored rectangles with eyes) each frame.
- **Projectiles**: drawn as circles each frame.
- **UI**: HTML/CSS overlays, updated via DOM manipulation.
- **Aim preview**: a dotted arc showing the predicted trajectory, drawn on an overlay canvas or directly on the main canvas before firing.

### 2.7 Collision Detection

- **Projectile vs. Terrain**: Sample the terrain pixel array at the projectile's position. If solid, explode.
- **Projectile vs. Worm**: After explosion, check each worm's distance from blast center. If within radius, apply damage.
- **Worm vs. Terrain (falling)**: If a worm's feet are not on solid terrain, apply gravity and check for fall damage or water death.

---

## 3. Tasks

### 3.1 Phase 1: Project Setup & Boilerplate
- [T1] Create `index.html` with canvas element, UI container, and script/style links.
- [T2] Create `style.css` with body/reset styles, canvas centering, and UI layout.
- [T3] Create `game.js` with configuration constants and utility functions.

### 3.2 Phase 2: Terrain System
- [T4] Implement terrain generation using Perlin-like noise or sine-wave combination.
- [T5] Implement terrain rendering via `putImageData`.
- [T6] Implement `digCircle` for terrain destruction.

### 3.3 Phase 3: Worms
- [T7] Implement `Worm` class with position, facing, HP, and team.
- [T8] Implement worm rendering (simple sprite).
- [T9] Implement worm placement on terrain (find surface height at given x).

### 3.4 Phase 4: Projectile & Physics
- [T10] Implement `Projectile` class with velocity, gravity, and wind.
- [T11] Implement projectile flight update loop.
- [T12] Implement projectile-terrain collision and explosion.

### 3.5 Phase 5: Combat & Damage
- [T13] Implement blast damage calculation for worms.
- [T14] Implement worm elimination and fall/death checks.
- [T15] Implement turn switching logic.

### 3.6 Phase 6: UI & Controls
- [T16] Implement aiming controls (mouse drag for angle/power).
- [T17] Implement trajectory preview arc.
- [T18] Implement UI updates (turn indicator, health bar, team info).
- [T19] Implement Skip Turn and Restart buttons.

### 3.7 Phase 7: Win Condition & Polish
- [T20] Implement win condition check and game-over screen.
- [T21] Add visual effects (explosion particles, screen shake).
- [T22] Add wind indicator to UI.
- [T23] Test across browsers and fix issues.

### 3.8 Phase 8: Final Verification
- [T24] Verify exactly 3 files: `index.html`, `style.css`, `game.js`.
- [T25] Verify no external dependencies.
- [T26] Verify game is playable from `index.html` alone.
