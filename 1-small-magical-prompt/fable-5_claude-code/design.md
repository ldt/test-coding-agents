# Design Document

## Overview

A single-page, zero-dependency implementation of a Worms-style artillery game. All simulation and rendering live in `game.js`; `index.html` provides the canvas plus HUD/menu DOM skeleton; `style.css` styles the DOM chrome. Rendering uses one full-viewport `<canvas>` (Canvas 2D). The terrain is a per-pixel bitmap held in an offscreen canvas, which gives free destructibility (destroy = draw a transparent circle) and free rendering (blit the offscreen canvas).

Guiding decisions:

- **Fixed-timestep physics, variable-rate rendering.** The simulation steps at 60 Hz accumulated from `requestAnimationFrame` delta (clamped to 100 ms to survive tab switches); fast projectiles move in swept sub-steps of ≤3 px within each step, so tunneling is impossible without paying for a higher tick rate. This keeps trajectories deterministic across machines — important for CPU aim prediction, which simulates the same integrator.
- **Terrain as pixels, entities as circles.** Worms and projectiles are circles tested against the terrain's alpha channel. No polygon meshes, no physics engine.
- **No scrolling camera.** The full 1600×900 playfield is always rendered, scaled to fit the viewport. "Camera" work is limited to screen shake; nothing pans or follows.
- **One explicit state machine** owns match flow. Every screen and turn phase is an enum value; input handlers check the current state first. This is the main defense for Requirements 3, 9.

## Architecture

```mermaid
graph TD
    Loop[Game loop: rAF + fixed-step accumulator] --> SM[State machine]
    SM --> Menu[TITLE / VICTORY screens]
    SM --> Turn[Turn controller]
    Turn --> Input[Input map keyboard]
    Turn --> AI[CPU controller]
    Turn --> Phys[Physics: worms, projectiles]
    Phys --> Terrain[Terrain bitmap offscreen canvas]
    Phys --> Explode[Explosion resolver]
    Explode --> Terrain
    Explode --> Worms[Worm damage/knockback]
    Loop --> Render[Renderer: sky, terrain blit, entities, particles]
    Loop --> HUD[HUD DOM updates]
```

### State machine

```
TITLE → PLACING(instant) → TURN_START → AIMING → CHARGING → PROJECTILE
      → RETREAT → SETTLING → TURN_END → (TURN_START | GAME_OVER) → TITLE/rematch
```

- `AIMING`: movement + aim + weapon select allowed; timer runs (45 s). Timer expiry while `CHARGING` fires at current power instead of forfeiting (Req 3.3).
- `CHARGING`: Space held on a chargeable weapon; release or 100% fires. Instant weapons (Shotgun, Dynamite) skip this phase.
- `PROJECTILE`: input locked except retreat movement. `RETREAT` runs concurrently as a sub-timer starting at fire time: max 5 s, ended early as soon as all shot effects have resolved and the active worm is at rest (Req 3.4 — no idle tail after a grenade's fuse ends). Shotgun turns never enter retreat: the timer keeps running between the two rays and the turn ends after the second (Req 5.6).
- `SETTLING`: waits for all worms `atRest`, no live projectiles, and no pending death detonations; hard cap 8 s (Req 9.2).
- `TURN_END`: applies drowning/death resolution (including chain reactions), checks win/draw (Req 1.3/1.4), increments the turn counter and applies sudden-death bookkeeping (Req 10: start at 20 total turns, cap HP at 30, raise `waterY` by 12 px at each subsequent turn start), then flips team.

All timers are decremented in the fixed step, never via `setTimeout`, so pausing/clamping delta cannot desync them (Req 9.4).

## Components and Interfaces

### Terrain (`Terrain`)

- Offscreen canvas `W×H` (playfield size, e.g. 1600×900 logical pixels) + cached `Uint8ClampedArray` of its alpha channel, rebuilt only on destruction (dirty-rect `getImageData` around the crater).
- `generate(seed)`: 1D height map from 3–4 octaves of value noise (or midpoint displacement); filled downward; grass band drawn along the top edge; water line at `H - waterHeight`. After generation, count distinct standing zones (flat-enough runs above the water line); fewer than 8 → regenerate with a new seed, bounded to 8 attempts (Reqs 1.7, 2.1). Spawn placement then samples zones with ≥80 px spacing.
- `solidAt(x, y) → bool`: alpha > 127 lookup; out-of-bounds left/right/top = air, below water = air (water kills separately). `waterY` is mutable: sudden death raises it 12 px per turn (Req 10.3); submerged terrain stays in the bitmap but drowning triggers on the water line, so no carving is needed.
- `carve(x, y, r)`: `globalCompositeOperation = 'destination-out'` circle, then re-stroke a darker rim ring clipped to remaining terrain (Req 2.5), then refresh alpha cache for the dirty rect.

### Entities

```js
Worm { id, team, x, y, vx, vy, hp, facing, aimAngle, alive, atRest, fallStartY }
Projectile { kind, x, y, vx, vy, fuse, windFactor, bounces, restitution, age, timeoutAt }
Particle { x, y, vx, vy, life, color, size }   // cosmetic only
```

### Physics (`stepPhysics(dt)`)

- Gravity `g` applied to airborne worms and all projectiles; bazooka adds `wind * windFactor` to `vx`.
- **Worm ground movement**: step-up walking — try move 1px horizontally; if blocked, try up to `MAX_STEP` (≈4 px) upward steps; if still blocked, stop (Req 4.1/4.2). Slopes steeper than the step allowance are walls.
- **Worm collision**: circle vs terrain sampled at 8 points; landing sets `atRest`, computes fall damage from `fallStartY` (damage = `max(0, (fallDist - SAFE_FALL) * k)`, Req 4.4).
- **Projectile collision**: swept sampling along the velocity each substep so fast shells cannot tunnel through thin terrain. Grenade/cluster reflect velocity about the terrain surface normal (estimated from alpha samples) with restitution ≈ 0.45.
- **Shotgun**: not a projectile — raycast in aim direction, march 2 px steps until worm/terrain/OOB hit; apply small carve + damage at hit point (Req 5.6).

### Explosion resolver (`explode(x, y, radius, maxDmg)`)

Single choke point (Reqs 2.2, 6.2, 6.3, 8.2):
1. `terrain.carve(x, y, radius)`.
2. For each living worm: `d = dist(worm, blast)`; if `d < radius + wormRadius`: damage `= max(maxDmg * (1 - d/radius), 0.25 * maxDmg)` — the floor applies exactly while the blast circle overlaps the worm circle (Req 6.2); knockback impulse along the blast→worm vector scaled by damage; mark airborne, record `fallStartY` **after** knockback applies so knockback-induced falls hurt.
3. Spawn particles, screen-shake `= f(radius)`, floating damage numbers, explosion sound (Reqs 6.6, 8.7).
4. Friendly fire: no team filter anywhere in this path (Req 6.7).

Deaths are **not** applied mid-flight; HP hits are, but death resolution happens in `SETTLING → TURN_END`: a worm at 0 HP is flagged `dying` with a 0.5 s timer, then detonates via this same `explode()` path (25 max damage, 40 px radius) and leaves a gravestone (Req 6.4). Because death detonations feed back through `explode()`, chain reactions fall out for free; `SETTLING` simply waits until no worm is `dying`. Simultaneous kills therefore resolve consistently for the draw rule (Req 1.4) and active-worm-death rule (Req 3.7).

### Weapons table (data-driven)

| id | key | ammo/team | charge | wind | fuse | maxDmg | radius | notes |
|----|-----|-----------|--------|------|------|--------|--------|-------|
| bazooka | 1 | ∞ | yes | yes | impact | 50 | 55 px | |
| grenade | 2 | ∞ | yes | no | 3 s | 45 | 50 px | restitution 0.45 |
| cluster | 3 | 3 | yes | no | 3 s | 30 + 5×15 | 40/25 px | exactly 5 bomblets, inherit ±spread |
| shotgun | 4 | 3 | no | no | instant | 25 ×2 | 18 px | 2 rays per turn, timer runs between, no retreat |
| dynamite | 5 | 2 | no | no | 3 s | 75 | 80 px | placed at feet |

One `WEAPONS` object drives selection UI, firing, ammo gating (per-team counts, depleted weapons unselectable — Req 5.10), and CPU reasoning — adding a weapon means adding a row plus at most one special-case hook (cluster split, shotgun ray).

### CPU controller (Req 7)

Runs only in `AIMING` on the CPU team's turn, as a small phase script: `think (0.8 s) → pick target → maybe walk (≤1.5 s) → sweep aim to solution (visible) → charge to computed power → fire`.

Aiming: pick nearest living enemy; **simulate candidate shots with the real projectile integrator** (bounded: ≤ 60 sims of ≤ 600 steps against the alpha cache) over a grid of angle×power for the bazooka (wind included for free), score by closest approach to target; pick best, then add Gaussian error (σ shrinks if the same worm was targeted last turn). If best score is poor (blocked by mountain), fall back to grenade lob sims; if still poor, take the least-bad shot anyway before the timer (Req 7.3). The search is time-sliced across the frames of the 0.8 s think pause (e.g. ≤ 8 sims per frame) so no frame exceeds the 50 ms budget of Req 7.5. Using the real integrator instead of closed-form ballistics is what makes wind/bounce handling correct with no extra math.

### Audio (Req 8.7)

Web Audio API only — oscillators and generated noise buffers, no files, so the 3-file rule holds. Fire = fast pitch sweep; explosion = filtered noise burst sized to blast radius; splash, turn-change and UI blips. The `AudioContext` is created on the first user gesture (mode selection) to satisfy autoplay policy; every audio call is wrapped so failure disables sound without touching gameplay.

### Demo mode (Req 9.5)

`?demo` in the URL skips the title screen and starts a CPU-vs-CPU match using the standard CPU controller for both teams — no special bot code, just `isCpu` on both teams. Combined with `window.__game`, a headless test can load the page, wait, and assert state transitions and HP changes with zero synthetic input.

### Input

Single `keydown`/`keyup` map feeding a `keys` set; all game reactions read the set inside the fixed step (no logic in event handlers except `preventDefault` for arrows/space). Every handler routes through the state machine's `allowedInputs(state)` filter (Reqs 3.6, 9.3).

### Rendering

Per frame: sky gradient → terrain blit → water band (animated sine surface) → gravestones → worms (body, eyes, team-colored band, HP label, active marker arrow) → aim crosshair → projectiles → particles → damage numbers. Screen shake = random offset translate decaying over ~0.3 s. HUD (timer, wind, weapon panel, team health bars) is DOM, updated only when values change.

## Data Models

Match-level state, all owned by a single `game` object (no globals scattered):

```js
game = {
  state, stateTime,          // enum + seconds in state
  mode,                      // 'pvp' | 'cpu' | 'demo'
  teams: [{ name, color, worms[], isCpu, ammo: { cluster: 3, shotgun: 3, dynamite: 2 } }],
  activeTeam, activeWormIx,  // round-robin cursor per team (Req 3.2)
  turnTimer, retreatTimer, wind,
  shotsLeft,                 // for shotgun's 2 shots
  turnCount, suddenDeath,    // Req 10: sudden death starts at turnCount 20
  projectiles[], particles[], damageNumbers[], graves[],
  terrain,                   // owns mutable waterY (rises in sudden death)
  camera: { shakeT, shakeMag },
}
```

Round-robin per team is a persistent index that advances past dead worms — not "first living worm" — so all worms get used (Req 3.2).

## Error Handling

- **Projectile timeout**: every projectile records `timeoutAt = age + 10 s`; the step force-explodes (grenades) or discards (bazooka OOB) on expiry (Req 9.1).
- **Settle cap**: `SETTLING` force-zeroes velocities and snaps worms to the nearest solid below (or drowns them) after 8 s (Req 9.2).
- **Delta clamp**: `dt = min(rawDt, 0.1 s)` before the accumulator (Req 9.4).
- **OOB**: left/right/top exits beyond a margin with outward velocity discard the projectile (Req 5.9); worms clamp horizontally at map edges; anything below water line drowns (Req 6.5).
- **State guards**: every mutation entry point (`fire()`, `endTurn()`, `startMatch()`) asserts the expected state and no-ops otherwise (Req 9.3, 1.6).

## Testing Strategy

Manual acceptance passes plus a headless smoke test (optional but recommended — Playwright is preinstalled at the repo root; a `test/smoke.js` may be added *in addition to* the three deliverable files). The `?demo` CPU-vs-CPU mode is the primary smoke-test vehicle: load it headless, let it run, and assert turns advance, HP totals change, and no console errors occur — no synthetic input needed.

1. **State machine**: start both modes; force wins, draws (dynamite between last two worms), death-detonation chains, rematches; verify no console errors and no soft-locks across ≥5 full matches, and that a stalling match reaches sudden death at turn 20 with rising water ending it.
2. **Terrain**: fire every weapon at flat ground and at overhangs; verify craters are passable, rims render, worms fall through carved floors.
3. **Turn law**: verify the turn always passes after: OOB shot, timed-out grenade on water, shotgun double-shot, timer expiry with no shot, active worm self-kill.
4. **Physics feel**: full-power bazooka at 45° crosses ≥ 2/3 of the map under zero wind; max wind visibly bends the arc; grenade bounces settle within 3 s fuse.
5. **CPU**: over 10 CPU turns on open terrain, ≥6 shots deal damage; CPU never exceeds the turn timer, never fires backwards into a mountain at point blank (score check), and visibly aims before firing.
6. **Robustness**: background the tab 30 s mid-flight and return — timers and physics resume sanely; spam-click and spam-keys during every transition.

Expose a tiny debug hook (`window.__game`) so the smoke test can read state (`game.state`, team HP totals) without scraping pixels.
