# Worms Game - Specification

## Requirements

### User Stories

**US-1: Basic Gameplay**
As a player, I want to control a worm that moves across a 2D terrain, so that I can navigate the battlefield.

**US-2: Turn-Based Combat**
As a player, I want to take turns attacking an opponent, so that we can engage in strategic combat.

**US-3: Weapon Selection**
As a player, I want to select from different weapons (bazooka, grenade, shotgun), so that I can choose my attack strategy.

**US-4: Terrain Destruction**
As a player, I want explosions to destroy terrain, so that the battlefield changes dynamically.

**US-5: Health System**
As a player, I want worms to have health that decreases when hit, so that there's a clear win condition.

**US-6: Visual Feedback**
As a player, I want to see explosions, health bars, and turn indicators, so that I understand game state.

### Acceptance Criteria (EARS Format)

1. **Movement**: WHEN player presses left/right arrow keys THEN the active worm SHALL move horizontally across terrain
2. **Jumping**: WHEN player presses up arrow key AND worm is on ground THEN the worm SHALL jump
3. **Aiming**: WHEN player presses up/down arrow keys WHILE aiming THEN the aim angle SHALL adjust between -90 and +90 degrees
4. **Firing**: WHEN player presses spacebar THEN the selected weapon SHALL fire from worm position at current aim angle
5. **Turn Switch**: WHEN a weapon fires and completes its effect THEN the turn SHALL switch to the other player
6. **Bazooka**: WHEN bazooka fires THEN it SHALL launch a projectile affected by gravity that explodes on impact
7. **Grenade**: WHEN grenade fires THEN it SHALL launch a projectile with timer that explodes after 3 seconds
8. **Shotgun**: WHEN shotgun fires THEN it SHALL fire multiple pellets in a spread pattern instantly
9. **Terrain Destruction**: WHEN explosion occurs THEN terrain pixels within radius SHALL be removed
10. **Damage**: WHEN worm is within explosion radius THEN its health SHALL decrease based on distance from center
11. **Win Condition**: WHEN a worm's health reaches 0 THEN the game SHALL declare the other player winner
12. **UI Display**: WHEN game is running THEN it SHALL display current player, both worms' health, and selected weapon

### Constraints

- Single HTML file with embedded or linked CSS/JS
- Canvas-based rendering (600x400 minimum)
- Vanilla JavaScript (no frameworks)
- Keyboard-only controls
- 2 players (hotseat/local multiplayer)
- Procedurally generated destructible terrain

---

## Design

### Overview

A turn-based artillery game where two players control worms on destructible terrain. Players take turns aiming and firing weapons to destroy the opponent's worm. The game uses HTML5 Canvas for rendering and vanilla JavaScript for game logic.

### Architecture

```
┌─────────────────────────────────────┐
│           index.html                │
│  (Canvas element + UI containers)   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         game.js                     │
│  ┌─────────────────────────────┐    │
│  │ Game State Manager          │    │
│  │ - Current turn, phase       │    │
│  │ - Players array             │    │
│  │ - Projectiles array         │    │
│  │ - Particles array           │    │
│  └──────────────┬───────────────┘    │
│                 │                    │
│  ┌──────────────▼───────────────┐    │
│  │ Terrain System              │    │
│  │ - Height map generation     │    │
│  │ - Destruction (circular)    │    │
│  │ - Collision detection       │    │
│  └──────────────┬───────────────┘    │
│                 │                    │
│  ┌──────────────▼───────────────┐    │
│  │ Physics Engine              │    │
│  │ - Gravity, velocity         │    │
│  │ - Projectile motion         │    │
│  │ - Explosion physics         │    │
│  └──────────────┬───────────────┘    │
│                 │                    │
│  ┌──────────────▼───────────────┐    │
│  │ Renderer                    │    │
│  │ - Terrain drawing           │    │
│  │ - Worm drawing              │    │
│  │ - Projectiles/particles     │    │
│  │ - UI (health, turn, weapon) │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Components and Interfaces

#### 1. Game State
```javascript
{
  phase: 'aiming' | 'firing' | 'exploding' | 'turnEnd' | 'gameOver',
  currentPlayer: 0 | 1,
  players: [
    { x, y, health: 100, color, angle, weaponIndex, isAlive }
  ],
  projectiles: [],
  particles: [],
  terrain: Terrain,
  winner: null
}
```

#### 2. Terrain System
- **Generation**: Perlin noise or midpoint displacement for natural-looking hills
- **Data Structure**: `Uint8Array` width x height (alpha channel for destruction)
- **Destruction**: Circular mask with feathered edges
- **Collision**: Sample height at x position

#### 3. Weapons
```javascript
const WEAPONS = [
  { name: 'Bazooka', type: 'projectile', gravity: true, damage: 50, radius: 40 },
  { name: 'Grenade', type: 'projectile', gravity: true, timer: 3000, damage: 40, radius: 50 },
  { name: 'Shotgun', type: 'instant', pellets: 8, spread: 30, damage: 15, range: 200 }
];
```

#### 4. Physics Constants
- GRAVITY = 0.3
- PROJECTILE_SPEED = 15
- EXPLOSION_FORCE = 8

### Data Models

**Terrain**: Width x Height Uint8ClampedArray (RGBA), alpha=0 = empty, alpha=255 = solid
**Worm**: { x: number, y: number, health: number, color: string, angle: number, weaponIndex: number, isAlive: boolean }
**Projectile**: { x, y, vx, vy, weaponType, owner, timer, exploded }
**Particle**: { x, y, vx, vy, life, maxLife, color, size }

### Error Handling

- Canvas context loss: Attempt restoration, show error message
- Out of bounds: Clamp positions, destroy projectiles leaving screen
- Division by zero: Guard angle calculations
- Missing assets: Use procedural fallbacks

### Testing Strategy

- Unit: Terrain generation, collision, damage calculation
- Integration: Turn flow, weapon firing, win detection
- Manual: Visual verification, control responsiveness

---

## Tasks

- [ ] 1. **Project Setup**
  - [ ] 1.1 Create HTML structure with canvas and UI elements
  - [ ] 1.2 Create CSS for styling (canvas, UI panels, responsive)
  - [ ] 1.3 Create base JavaScript module structure

- [ ] 2. **Terrain System**
  - [ ] 2.1 Implement procedural terrain generation (midpoint displacement)
  - [ ] 2.2 Create terrain rendering to canvas
  - [ ] 2.3 Implement circular destruction with feathered edges
  - [ ] 2.4 Add collision detection (getHeightAt, isSolidAt)

- [ ] 3. **Worm System**
  - [ ] 3.1 Create worm data structure and initialization
  - [ ] 3.2 Implement worm movement (walk left/right, jump)
  - [ ] 3.3 Add worm rendering (body, aim indicator)
  - [ ] 3.4 Implement ground detection and positioning

- [ ] 4. **Physics Engine**
  - [ ] 4.1 Implement gravity and velocity integration
  - [ ] 4.2 Create projectile motion update loop
  - [ ] 4.3 Add explosion physics (force application to worms)

- [ ] 5. **Weapon System**
  - [ ] 5.1 Implement bazooka (timed projectile with gravity)
  - [ ] 5.2 Implement grenade (timer-based explosion)
  - [ ] 5.3 Implement shotgun (instant raycast with spread)
  - [ ] 5.4 Add weapon switching (1/2/3 keys)

- [ ] 6. **Game Loop & State Management**
  - [ ] 6.1 Create main game loop (update + render)
  - [ ] 6.2 Implement turn management (switch turns, phases)
  - [ ] 6.3 Add input handling (keyboard events)
  - [ ] 6.4 Implement win condition detection

- [ ] 7. **Visual Effects**
  - [ ] 7.1 Create explosion particles
  - [ ] 7.2 Add projectile trails
  - [ ] 7.3 Implement screen shake on explosions

- [ ] 8. **UI & Polish**
  - [ ] 8.1 Create health bars for both players
  - [ ] 8.2 Add turn indicator and weapon display
  - [ ] 8.3 Create game over screen with restart
  - [ ] 8.4 Add instructions overlay
  - [ ] 8.5 Test and balance gameplay