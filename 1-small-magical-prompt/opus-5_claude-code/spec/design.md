# Design — HTML Worms

## Overview

A single-page, dependency-free canvas game. The world is a fixed 1800×900 pixel battlefield with a
water line at y = 820. Everything is simulated on a fixed 60 Hz timestep driven by an accumulator so
that physics is deterministic with respect to frame rate; rendering happens once per animation frame.

The three files split by concern:

| File | Responsibility |
|---|---|
| `index.html` | Document skeleton: canvas, HUD DOM, weapon dock, overlays. No inline logic. |
| `style.css` | All presentation of the DOM chrome (HUD, dock, overlays, banners), theming via CSS vars. |
| `game.js` | Terrain, physics, weapons, turn state machine, rendering, input, audio. IIFE, strict mode. |

The HUD is DOM rather than canvas-drawn: it gets crisp text and easy layout for free, and keeps the
canvas loop focused on the world.

---

## Architecture

```
                      ┌──────────────┐
   keyboard/mouse ──▶ │    Input     │──▶ intents (walk, aim, charge, fire, select)
                      └──────┬───────┘
                             ▼
   rAF ──▶ accumulator ──▶ ┌──────────────────┐      ┌───────────┐
                           │  Game (FSM)      │─────▶│  Terrain  │ mask + offscreen canvas
                           │  fixedStep()     │      └───────────┘
                           │  ├ worms         │      ┌───────────┐
                           │  ├ projectiles   │─────▶│  Explode  │ carve + damage + particles
                           │  ├ particles     │      └───────────┘
                           │  └ turn clock    │      ┌───────────┐
                           └────────┬─────────┘      │   Audio   │ WebAudio synth, no assets
                                    ▼                └───────────┘
                            render() ──▶ canvas   syncHud() ──▶ DOM
```

### Decision: terrain as a bitmask + offscreen canvas

**Context:** the game needs pixel-accurate destructible ground with cheap collision queries.

**Options considered:**
1. *Polygon terrain with CSG subtraction* — Pros: resolution-independent, small memory. Cons: boolean
   ops are fiddly, craters that split an island are painful, collision needs point-in-polygon.
2. *Bitmask (`Uint8Array`) mirrored by an offscreen canvas* — Pros: O(1) collision, trivial carving,
   pixel-perfect visuals. Cons: 1.6 MB of memory, mask and pixels must be kept in sync.
3. *Read pixels back from the canvas for collision* — Pros: one source of truth. Cons: `getImageData`
   per query is far too slow.

**Decision:** option 2.
**Rationale:** collision is the hot path (every worm point, every projectile substep). A flat typed
array indexed `y * WORLD_W + x` makes it a single array read. Carving writes the mask and applies a
`destination-out` arc to the offscreen canvas — the two stay in sync because both operations are
driven from the same circle.

### Decision: fixed timestep with an accumulator

**Context:** projectiles move fast; naive `dt`-scaled integration tunnels through thin terrain and
behaves differently on 60 Hz vs 144 Hz displays.

**Decision:** simulate in 1/60 s steps, clamp the frame delta to 0.1 s, and inside each step move
projectiles in sub-steps of at most 3 px.
**Rationale:** removes tunnelling and makes trajectories identical on any monitor. The clamp handles
Requirement 10.5 (backgrounded tab).

### Decision: DOM HUD, canvas world

Canvas text rendering is expensive and hard to lay out; the HUD changes rarely. The HUD is updated
from a single `syncHud()` that writes only when values actually change, so no layout thrash.

---

## Components and Interfaces

### `Terrain`

```js
terrain.generate()            // fractal height map + caves -> mask + offscreen canvas
terrain.solid(x, y) -> bool   // O(1); out-of-bounds is empty
terrain.carve(cx, cy, r)      // clears mask + pixels, draws scorch rim
terrain.surfaceY(x) -> y|null // topmost solid pixel in a column, used for spawning
```

Generation: four octaves of sine with random phase and amplitude produce a height map; the column
below each height is filled. 4–7 elliptical caves are then subtracted below the surface to create
overhangs and tunnels. Colouring walks each column top-down tracking depth: the first 5 solid pixels
of a run are grass (two-tone, noise-dithered), below that soil darkens with depth with per-pixel
noise, giving readable strata.

### `Worm`

```js
{ x, y, vx, vy, health, dead, dying, airborne, peakY, facing, aim, name, team }
```

* Collision hull: 9 sample points on a 6×9 ellipse; `wormHits(x, y)` returns true if any is solid.
* `tryWalk(worm, dir)`: probes vertical offsets in the order `0, -1 … -5, +1 … +5` and takes the
  first free one, which yields slope climbing (R4.2) and blocking on walls (R4.3) with no special
  cases.
* Airborne integration is sub-stepped, resolving X and Y independently so a worm slides along walls
  instead of sticking.
* `peakY` tracks the highest point reached while airborne; fall damage uses `y - peakY`.

### `Projectile`

```js
{ x, y, vx, vy, w /*weapon def*/, fuse, life, trail[], owner }
```

Per step: optional wind acceleration, gravity, then sub-stepped movement. On terrain contact, a
bouncing weapon reflects about a normal estimated from the mask gradient in a 5×5 neighbourhood and
loses energy; a non-bouncing weapon detonates. Fuse and a 12 s hard life cap (R10.3) both trigger
detonation. Contact with water removes it with a splash.

### `Weapon` (data-driven table)

```js
{ id, name, icon, key, ammo, mode, wind, radius, damage, bounce, fuse, cluster, shots }
```

`mode` is one of `launch` (angle/power), `drop` (dynamite, spawned at the feet), `hitscan`
(shotgun ray) and `strike` (airstrike, click-targeted). Adding a weapon means adding a row plus, at
most, a branch in `fireWeapon`.

### `explode(x, y, radius, damage, opts)`

1. `terrain.carve`
2. for each living worm: falloff damage, knockback impulse, floating damage text
3. particles (debris, smoke, sparks), camera shake, audio
4. worms that hit 0 health are flagged `dying` with a 0.55 s timer; their own detonation is queued,
   which is what produces chain reactions (R7.5)

### Turn state machine

```
TITLE ──start──▶ AIM ──fire──▶ FLIGHT ──all projectiles gone──▶ SETTLE
                  ▲                                               │
                  │                              shots remaining  │ everything at rest
                  └───────────────────────────────────────────────┤
                                                                  ▼
             GAMEOVER ◀──team wiped── END_TURN ◀──expired── RETREAT
```

* `AIM` — full control, turn clock running.
* `TARGET` — sub-state of AIM for the airstrike; movement frozen, click designates.
* `FLIGHT` — no control; camera follows the newest projectile.
* `SETTLE` — waits for zero projectiles, zero dying worms and zero airborne worms (R10.4).
* `RETREAT` — movement only, 5 s.
* `END_TURN` — win check, then next worm.

### `Camera`

Follows the newest live projectile, else the active worm; critically damped lerp toward the target,
clamped to world bounds (or centred if the viewport is wider than the world), plus a decaying shake
offset applied at draw time.

### `Audio`

WebAudio oscillators and generated noise buffers only — no files, so the "3 files" rule holds.
Explosions are a filtered noise burst plus a descending sine; firing is a fast pitch sweep; jumps,
steps, splashes and UI clicks are short blips. The context is created on the first user gesture
(the Start button) to satisfy autoplay policy.

---

## Data Models

```js
WORLD = { w: 1800, h: 900 }, WATER_Y = 820
GRAVITY = 0.32 px/step²        WIND_ACC = 0.014 px/step² per unit wind
TURN_TIME = 45 s               RETREAT_TIME = 5 s
CHARGE_TIME = 1.2 s            MAX_LAUNCH_SPEED = 18 px/step

team = { name, color, dark, worms: [Worm], cursor: int, ammo: { weaponId: int } }
game = { state, teams, turnTeam, active: Worm, wind: -1..1, timeLeft, retreatLeft,
         projectiles: [], particles: [], texts: [], shake, camera }
```

Wind is redrawn uniformly in [-1, 1] each turn and displayed as a signed gauge.

## Error Handling

| Scenario | Response |
|---|---|
| Terrain generation yields too little solid ground for spawns | regenerate, up to 8 attempts (R1.4) |
| Projectile flies off-world | kept while `x` is within ±400 of the world and `y < WORLD_H`, else discarded (R10.1) |
| Projectile never settles (perpetual bounce in a pit) | 12 s life cap forces detonation (R10.3) |
| Worm ends a turn mid-air | `SETTLE` blocks the turn change until it lands (R10.4) |
| Tab backgrounded, huge `dt` | delta clamped to 0.1 s |
| WebAudio unavailable or blocked | audio calls are wrapped; failure disables sound, game continues |
| Canvas resized to zero (hidden tab) | resize guarded with a minimum of 1 px |

## Testing Strategy

Manual play is the primary acceptance test; the checklist below maps to the requirements and is what
the implementation is validated against. Automated smoke-testing uses the Playwright dependency
already present in the repository: load the page, click Start, drive a few turns via synthetic key
events, and assert that no console error occurred and that the HUD reflects a changed game state.

* **Terrain** — carve a crater, assert `solid()` returns false inside it and true just outside.
* **Physics** — a worm dropped from 300 px takes fall damage; a worm walked into a vertical wall does
  not move; a worm walked up a 3-px step does.
* **Turn machine** — firing a bazooka moves AIM → FLIGHT → SETTLE → RETREAT → AIM with the other
  team active; the shotgun takes two shots before the turn ends.
* **Weapons** — ammunition decrements only for limited weapons, and a weapon at zero cannot be
  selected.
* **Victory** — killing the last worm of a team ends the match with the correct winner.
