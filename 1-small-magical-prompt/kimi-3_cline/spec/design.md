# Design — Worms (HTML5 Clone)

## Overview

A zero-dependency, single-canvas 2D artillery game written in vanilla JavaScript.
The architecture is a classic fixed-timestep game loop with a finite-state machine
driving turn flow. All rendering is immediate-mode 2D canvas; terrain is cached in an
offscreen canvas and only re-composited when explosions modify it.

```
┌────────────────────────────────────────────────────────────┐
│ index.html ── canvas#game (960×540) + weapon buttons       │
│ style.css  ── page chrome, layout, buttons                 │
│ game.js    ── everything else (sections below)             │
└────────────────────────────────────────────────────────────┘
```

## Architecture

### Game loop
- `requestAnimationFrame` drives rendering.
- Simulation advances in fixed steps of `1/60 s` inside an accumulator (max 5 steps/frame
  to avoid the spiral of death). Interpolation is unnecessary at this step size.

### State machine

```
 title ──Enter/click──► aim ◄──────────────┐
                        │Space             │ nextTurn()
                        ▼                  │
                     charge ──release──► fire()
                        │                  │
                        ▼                  ▼
              projectile (bazooka)    retreat (grenade/dynamite, fuse live, worm controllable)
                        │                  │
                        ▼                  ▼
                        settle ──timer──► victory check ──► gameover | nextTurn
```

States: `title`, `aim`, `charge`, `projectile`, `retreat`, `settle`, `gameover`.

### World & terrain model
- World: 1600×640 px. Viewport: 960×540 px (camera pans).
- Terrain solidity: `Uint8Array` grid of 800×320 cells at 2 px resolution
  (`CELL = 2`). `solidPx(x,y)` maps world px → cell.
- Heightmap generation: sum of 3 sine waves with random phase/frequency/amplitude,
  raised edges at world borders, plus 2 carved caves.
- Rendering cache: a world-sized offscreen canvas + `ImageData`. `paintColumn(gx)`
  writes both pixel columns of a cell column: transparent above the surface, a 3-cell
  grass band, then a depth-graded dirt fill with deterministic hash noise
  (`hash(x,y)` — repaint-stable). After an explosion, only affected columns are
  repainted, then the whole `ImageData` is `putImageData`'d (fast enough at ~1 Mpx).

### Entities

| Entity   | Data                                                        |
|----------|-------------------------------------------------------------|
| Worm     | pos, vel, hp, team, name, facing, aimDeg, onGround, alive   |
| Projectile | type (bazooka/grenade/dynamite), pos, vel, fuse           |
| Particle | pos, vel, life, color, size, gravity flag (debris/smoke/spark/splash) |
| Flash    | pos, radius, ttl (additive explosion glow)                  |

### Physics
- Gravity 900 px/s², terminal velocity 720 px/s.
- **Worm/terrain:** horizontal movement tests the body strip excluding the lowest 6 px,
  giving free step-up over shallow slopes and hard blocking on cliffs. Vertical: sample
  ground under the feet; snap-to-ground on landing; fall damage when landing speed
  exceeds 520 px/s (`dmg = (v−520)·0.06`).
- **Bazooka:** point projectile, `vx += wind·35·dt`, `vy += g·dt`; explodes on terrain
  or worm contact; smoke trail.
- **Grenade:** as bazooka but no wind; on contact, surface normal is estimated by
  sampling solidity at ±3 px on both axes; velocity reflected with restitution 0.45 and
  tangential friction 0.8; detonates on fuse.
- **Dynamite:** same normal sampling, near-zero restitution; detonates on fuse.
- **Explosion:** clears terrain cells in radius, applies linear-falloff damage and radial
  knockback impulse to worms within 1.5× radius, spawns particles/flash/shake.

### Turn management
- Teams alternate; each team has its own worm cursor (round-robin, skipping the dead).
- Turn timer 30 s applies to `aim`/`charge` only. Grenade/dynamite use their fuse as the
  retreat clock, then a 1 s `settle` phase lets physics resolve (falling, drowning)
  before victory check and `nextTurn()`.

### Camera
- Target = active worm (aim/charge/retreat) or projectile (projectile/settle).
- Exponential smoothing `cam += (target−cam)·(1−e^(−6dt))`, clamped to world bounds.
- Explosion shake: decaying random offset applied at render time only.

### Rendering layers (per frame)
1. Sky gradient, sun, parallax clouds & distant hills
2. Water (animated sine surface, translucent, over submerged terrain)
3. Terrain (offscreen canvas, camera-transformed)
4. Dynamite / projectiles / worm sprites (circle body, eye, aim crosshair, name + HP bar)
5. Particles, explosion flashes (additive)
6. HUD (screen space): team panels, wind, timer, weapon slots, power bar, banners
7. Overlays: title / game-over veils

### Input
- Keyboard: ←/→ walk & facing, ↑/↓ aim, Space hold/release = charge/fire,
  Enter = jump (and start), 1/2/3 = weapon, R = restart on game-over.
- Mouse: HTML weapon buttons below canvas; click starts/restarts.
- `?demo` URL param: bot that dispatches synthetic `KeyboardEvent`s (walk/aim/charge/
  fire/jump/weapon-switch) for hands-free smoke testing.

## Error handling
- No external assets → no load failures. Canvas context assumed available (all modern
  desktop browsers).
- Physics guards: max integration steps, landing snap iteration caps, cursor advance
  guards against infinite loops when teams are wiped.
- All array accesses for terrain are bounds-checked (`solidPx` treats the world sides as
  solid walls and open sky/water column as empty).

## Testing strategy
- Manual playtest checklist derived from REQ-1…REQ-9 acceptance criteria.
- Automated smoke path: `index.html?demo` autoplay — load in a scripted browser, watch
  for console errors across title → aim → charge → flight → explosion → next turn.
- Visual verification via screenshots at key states.
