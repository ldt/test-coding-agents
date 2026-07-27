# Worms HTML Game — Design

## Overview
Single-page browser game using Canvas API for rendering. The game features destructible terrain, projectile physics, AI opponents, and a turn-based system. All logic is in one JavaScript file with one HTML file and one CSS file.

## Architecture

```
index.html    →  Entry point, canvas element, script/style links
style.css     →  Visual styling for HUD, overlays, buttons
game.js       →  All game logic: terrain, physics, entities, AI, rendering
```

## Components and Interfaces

### Game Engine (game.js)
- `Game` class: orchestrates game loop, state machine, turn management
- `Terrain` class: procedural generation, destruction, collision detection
- `Worm` class: position, health, movement, aiming, death
- `Projectile` class: position, velocity, physics update, explosion
- `Camera` class: viewport tracking, smooth follow
- `AI` class: targeting logic for computer-controlled team

### Rendering Approach
- Canvas 2D for game world (terrain, worms, projectiles, explosions)
- DOM-based HUD for UI (timer, wind, HP bars, power meter)
- Camera offset transforms canvas drawing coordinates

### Data Models

**Terrain:**
- `heights[]`: Array of y-values for each x-pixel (0 to canvas width)
- `generate()`: Creates terrain using layered sine waves
- `destroy(cx, cy, radius)`: Circular terrain removal
- `getSurfaceY(x)`: Returns terrain height at given x
- `isCollision(x, y)`: Checks if point is within terrain

**Worm:**
- `{ x, y, hp, maxHp, team, isAlive, angle }`
- `move(direction)`: Walk along terrain surface
- `jump()`: Apply upward velocity
- `takeDamage(amount)`: Reduce HP, die if ≤ 0
- `update(dt)`: Apply gravity if airborne

**Projectile:**
- `{ x, y, vx, vy, alive, bounced }`
- `update(dt)`: Apply gravity + wind, check collisions
- `explode()`: Damage worms, destroy terrain in radius
- `isOffScreen()`: Despawn if out of bounds

**Camera:**
- `{ x, y }`: offset for rendering
- `follow(target)`: Smooth lerp toward target position

### Game States
```
MENU → PLAYING → TURN_PLAYER → FIRING → EXPLODING → SWITCH_TURN → (repeat)
                                                         ↓
                                                   GAME_OVER
```

- MENU: Start screen
- TURN_PLAYER: Active worm can move/aim/fire (or AI computes)
- FIRING: Projectile in flight
- EXPLODING: Explosion animation playing
- SWITCH_TURN: Brief pause before next turn

### Controls
| Key      | Action        |
|----------|---------------|
| ← →     | Move worm     |
| ↑ ↓     | Aim angle     |
| Space    | Charge & fire |
| Tab      | Jump          |

### Physics Constants
- Gravity: 500 px/s²
- Wind range: -200 to +200 px/s²
- Explosion radius: 60px
- Explosion damage: 50 max, falloff by distance
- Projectile speed: 500 px/s base

## Error Handling
- Canvas not supported: show error message in DOM
- All worms dead on one team: transition to GAME_OVER
- Invalid turn transitions blocked by state machine
- Window resize: canvas fills viewport, terrain regenerated on new game only

## Testing Strategy
- Manual playtesting with browser
- Verify AI fires correctly
- Verify terrain destruction works
- Verify collision detection at edges
- Verify turn timer expiry transitions correctly

## Decision Documentation

### Decision: Pure Canvas vs DOM + Canvas
**Context:** Choose rendering approach for the game
- **Canvas 2D** - Pros: pixel-perfect terrain destruction, efficient particle/explosion effects / Cons: no built-in UI elements
- **DOM-only** - Pros: easy UI / Cons: hard to do terrain destruction and physics
**Decision:** Hybrid — Canvas for game world, DOM for HUD
**Rationale:** Best of both worlds: complex game rendering on canvas, accessible and stylable UI via DOM

### Decision: Real-time vs Turn-based AI
**Context:** How AI should operate during its turn
- **Real-time simulation** - Pros: AI looks natural / Cons: need to simulate controls
- **Instant compute** - Pros: simpler / Cons: feels robotic
**Decision:** AI computes instantly but adds a small delay before firing
**Rationale:** Simpler implementation while maintaining perceived fairness
