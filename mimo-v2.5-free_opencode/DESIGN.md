# Worms HTML Game - Technical Design Document

## Overview

A browser-based Worms game using HTML5 Canvas for rendering and vanilla JavaScript for game logic. The game features turn-based combat, destructible terrain, physics-based projectiles, and simple AI for single-player or hot-seat multiplayer.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Game Engine                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Renderer  │  │  Game Loop  │  │   Input Manager     │ │
│  │   (Canvas)  │  │  (RAF)      │  │   (Keyboard/Mouse)  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Terrain   │  │   Physics   │  │   Entity Manager    │ │
│  │   System    │  │   System    │  │   (Worms, Projectiles)│ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Turn       │  │   Weapon    │  │   Collision         │ │
│  │  Manager    │  │   System    │  │   Detection         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### Renderer (renderer.js)
- Manages HTML5 Canvas context
- Draws terrain from pixel data
- Renders worms, projectiles, and effects
- Handles camera/viewport (optional)
- Manages UI overlays (health bars, weapon info)

#### Game Loop (game.js)
- RequestAnimationFrame-based loop
- Delta time calculation
- State updates (physics, turns, animations)
- Orchestrates rendering

#### Input Manager (input.js)
- Keyboard event listeners
- Mouse position tracking
- Input state management
- Action mapping (move left, fire, etc.)

#### Terrain System (terrain.js)
- Procedural terrain generation using Perlin noise
- Pixel-level destruction
- Water/void areas
- Terrain collision queries

#### Physics System (physics.js)
- Gravity application
- Projectile trajectory calculation
- Explosion force propagation
- Simple rigid body dynamics

#### Entity Manager (entities.js)
- Worm class (position, health, team, state)
- Projectile class (position, velocity, type)
- Visual effects (explosions, damage numbers)
- Entity lifecycle management

#### Turn Manager (turns.js)
- Team rotation logic
- Turn timer (30 seconds)
- Turn end conditions
- Active worm selection

#### Weapon System (weapons.js)
- Weapon definitions (bazooka, grenade, etc.)
- Ammo tracking
- Damage calculation
- Trajectory preview

#### Collision Detection (collision.js)
- Circle-terrain collision
- Circle-circle collision (worms)
- Ray casting for line of sight
- Spatial hashing for optimization

## Data Models

### Game State
```javascript
{
  state: 'setup' | 'playing' | 'paused' | 'gameover',
  turn: {
    teamIndex: number,
    wormIndex: number,
    timeRemaining: number,
    phase: 'move' | 'aim' | 'fire' | 'waiting'
  },
  teams: Team[],
  terrain: ImageData,
  projectiles: Projectile[],
  effects: Effect[]
}
```

### Team
```javascript
{
  id: number,
  name: string,
  color: string,
  worms: Worm[]
}
```

### Worm
```javascript
{
  id: number,
  teamId: number,
  x: number,
  y: number,
  health: number,
  maxHealth: number,
  currentWeapon: Weapon,
  state: 'idle' | 'moving' | 'jumping' | 'falling' | 'dead',
  velocity: { x: number, y: number }
}
```

### Weapon
```javascript
{
  id: string,
  name: string,
  ammo: number,
  maxAmmo: number,
  damage: number,
  radius: number,
  type: 'projectile' | 'direct' | 'area'
}
```

### Projectile
```javascript
{
  x: number,
  y: number,
  velocity: { x: number, y: number },
  type: string,
  damage: number,
  radius: number,
  timeToLive: number
}
```

### Effect
```javascript
{
  type: 'explosion' | 'damage' | 'turn_indicator',
  x: number,
  y: number,
  frame: number,
  maxFrames: number,
  data: any
}
```

## Key Algorithms

### Terrain Generation (Perlin Noise)
1. Generate base height map using noise function
2. Smooth the height map
3. Add underwater areas below threshold
4. Convert to pixel data for collision detection

### Projectile Physics
1. Apply gravity to velocity each frame
2. Update position based on velocity
3. Check terrain collision at new position
4. If collision: explode and create damage area
5. Check worm collision at new position
6. If collision: apply damage and explode

### Explosion System
1. Create circular damage mask at explosion center
2. For each pixel in radius:
   - Calculate distance from center
   - Apply damage falloff (closer = more damage)
   - Remove terrain pixel if within radius
3. Check all worms in area
4. Apply damage based on distance
5. Apply force push to nearby worms
6. Create visual effect

### Turn System
1. On turn start:
   - Highlight current worm
   - Start timer (30s)
   - Enable movement controls
2. During turn:
   - Process input
   - Update timer
   - Track actions taken
3. On turn end (timeout, attack, or skip):
   - Disable controls
   - Process all physics/animations
   - Move to next team's worm
   - Check win condition

## Interface Specifications

### Main Game API
```javascript
class WormsGame {
  constructor(canvasId: string)
  
  // Lifecycle
  init(options: GameOptions): void
  start(): void
  pause(): void
  reset(): void
  
  // Game state
  getState(): GameState
  getCurrentTeam(): Team
  getCurrentWorm(): Worm
  
  // Actions
  moveWorm(direction: 'left' | 'right'): void
  jump(direction: 'left' | 'right'): void
  aimWeapon(angle: number): void
  fireWeapon(power: number): void
  selectWeapon(weaponId: string): void
  skipTurn(): void
}
```

### Event System
```javascript
// Events emitted by game
game.on('turn:start', (team, worm) => {})
game.on('turn:end', () => {})
game.on('worm:damage', (worm, damage) => {})
game.on('worm:death', (worm) => {})
game.on('explosion', (x, y, radius) => {})
game.on('victory', (winningTeam) => {})
```

## Error Handling

### Runtime Errors
- Canvas not supported → Show fallback message
- Missing assets → Use placeholder colors
- Physics instability → Clamp values, reset if needed

### Game Logic Errors
- Invalid turn state → Force turn end
- Worm stuck in terrain → Teleport to nearest safe position
- Projectile out of bounds → Destroy immediately

## Testing Strategy

### Unit Tests (Manual)
- Terrain generation produces valid heightmap
- Collision detection accuracy
- Damage calculation correctness
- Turn rotation logic

### Integration Tests
- Full turn cycle (move → aim → fire → end)
- Explosion affects terrain and worms correctly
- Game ends when team eliminated

### Visual Tests
- Terrain renders correctly
- Worms display with health bars
- Explosions animate properly
- UI elements update in real-time

## Performance Considerations

1. **Terrain Rendering**: Cache terrain as ImageData, only update on destruction
2. **Collision Detection**: Use spatial hashing for worm-projectile checks
3. **Physics**: Limit calculation frequency for non-critical updates
4. **Effects**: Pool effect objects to avoid garbage collection
5. **Canvas**: Use requestAnimationFrame for smooth 60fps rendering

## File Structure

```
mimo-v2.5-free_opencode/
├── SPEC.md          # Requirements
├── DESIGN.md        # This document
├── TASKS.md         # Implementation tasks
├── index.html       # Main HTML file
├── style.css        # Styles
└── game.js          # All game logic
```

## Decisions

### Decision: Single JS File vs Multiple Modules
**Context:** Need to decide on code organization
**Options:**
1. Single JS file - Simple, no build step, easier deployment
2. Multiple ES modules - Better organization, requires bundler
**Decision:** Single JS file
**Rationale:** Simplicity for a standalone HTML game, no build complexity

### Decision: Canvas vs DOM for Rendering
**Context:** Need to render game visuals
**Options:**
1. HTML5 Canvas - Fast, pixel-level control, good for games
2. DOM elements - CSS styling, easier animations, slower for many elements
**Decision:** HTML5 Canvas
**Rationale:** Better performance for terrain manipulation and many entities

### Decision: Input Method
**Context:** Player needs to control worms
**Options:**
1. Keyboard only - Simple, works everywhere
2. Mouse + Keyboard - More intuitive aiming, better UX
3. Touch - Mobile support, complex implementation
**Decision:** Mouse + Keyboard (primary), Keyboard only (fallback)
**Rationale:** Best UX for desktop, keyboard fallback for compatibility
