# PoolSide S 2.1 — Worms (agent: Pool)

A from-scratch, zero-dependency implementation of the turn-based artillery
game described in the SDD under `2-SDD-based-game/`. It lives in this subfolder and
is one of several agent implementations sharing the same specification; this one
was produced following red/green TDD.

- **Model name:** PoolSide S 2.1
- **Agent name:** Pool
- **Branch:** `test-2-poolside-s-2.1-pool` (forked from `test-2-template-branch`)

---

## Files

```
2-SDD-based-game/poolside-s-2.1_pool/
├── index.html              # canvas + DOM HUD (the 3 deliverable files)
├── game.js                 # all game logic, rendering, CPU, debug handle
├── style.css               # system-font UI styling
├── playwright.config.js    # test runner config (testDir = test/)
└── test/
    ├── helpers.js          # file:// URL + runSteps helpers
    ├── smoke.spec.js       # load / demo termination / rematch stability
    ├── terrain.spec.js     # ≥8 standing zones, 8 worms above water, carve
    ├── damage.spec.js      # blast falloff: max@center → 0.25×max floor
    └── sudden.spec.js      # sudden death at turn 20, HP cap 30, termination
```

The playable game is exactly the three files above. The `test/` folder and
`playwright.config.js` are the reviewed TDD harness (the SDD's *Testing
Strategy* explicitly allows a `test/` directory in addition to the deliverables).

---

## How to run

### Play (any browser, no server needed)

Open `index.html` directly — it is `file://` friendly.

- `index.html` — title screen with **2-Player**, **vs CPU**, and **Demo**
  buttons.
- `index.html?demo` — skips the title and starts a CPU-vs-CPU match
  immediately. This is the mode the tests use.

### Controls (PvP / vs-CPU)

| Input | Action |
|-------|--------|
| `1`–`5` | Select weapon (1=Bazooka, 2=Grenade, 3=Cluster, 4=Shotgun, 5=Dynamite) — only in `AIMING` |
| `Space` | Fire / start charging (charge for Bazooka/Grenade/Cluster; detonates Dynamite in place) |
| `↑` / `↓` (or `W`/`S`) | Adjust aim |
| `←` / `→` (or `A`/`D`) | Walk |
| `Enter` / `Z` | Jump (only while on ground) |

### Run the tests

Playwright is installed at the repository root, so from this folder:

```bash
cd 2-SDD-based-game/poolside-s-2.1_pool
npx playwright test        # auto-discovers playwright.config.js
```

The suite runs headless Chromium. Each spec loads `?demo` and drives the
deterministic fixed-step simulator through the `window.__game.runSteps(n)` hook,
so matches finish in milliseconds instead of real time.

---

## Technical choices

### Architecture
- **Single IIFE, no dependencies.** Everything (state machine, physics,
  terrain generation, rendering, CPU) lives in `game.js`. No bundler, no npm
  package.json, no frameworks — just a `<script>` tag. This keeps the game
  truly `file://` runnable and reviewable.
- **Fixed time-step simulation at 60 Hz** (`STEP = 1/60`). The `rAF` loop
  accumulates real wall-clock `dt` and runs `fixedStep()` in a tight loop
  (capped at 12 steps/frame to avoid spiral-of-death stalls). This decouples
  simulation determinism from display framerate.
- **`window.__game` debug handle** (Req 9.5). Exposes read-only getters
  (`state`, `turnCount`, `suddenDeath`, `waterY`, `wind`, `teams`,
  `projectiles`, `selectedWeapon`), `teamHP()`, `activeTeam()`, plus `runSteps(n)`
  (advances `n` fixed steps synchronously and returns diagnostics) and a `test.*`
  namespace (`terrainStandingZones`, `terrainSolidAt`/`solidAt`, `carve`,
  `damageAt`, `inspect`, `restart`) used by the specs. `runSteps` flips the
  `_testPaused` guard so the real `rAF` loop won't double-step during tests.

### Terrain — a dedicated offscreen canvas for solidity
- The height map is 3–4 octaves of value noise (`hash1` integer-hash, centered
  to `[-1,1]`) plus a 6-hump sine sway, clamped to `[240, waterY-28]`. Fewer than
  8 standing zones → regenerate, bounded to 8 attempts (Req 1.7/2.1).
- **Terrain renders to a private offscreen `<canvas>`**. The alpha cache used by
  `solidAt` is read *only* from this bitmap, so the water layer (drawn on the
  display canvas during `render()`) is never mistaken for solid ground. (This was
  the single most important correctness fix — see *Bug #2* below.)
- Carving (`destination-out` circle) immediately refreshes the whole alpha cache
  (correctness over perf; the playfield is small).

### Physics & combat
- **Blast damage** is a single `explode()` choke point: carve terrain, apply
  radial damage `(1 - d/radius)` floored at `25%` of `maxDmg` (Req 6.3), and
  knock worms/projectiles back. All explosions — weapon detonations, grenade
  clusters, and **death detonations** (25 dmg / 40 px, 0.5 s delay) — feed back
  through this one path, so chain reactions resolve for free and simultaneous
  kills follow the draw rule (Req 1.4).
- **Worms**: 100 HP, radius 12, gravity 800 px/s², walk 120/s, jump 160/-360.
  Fall damage only past `SAFE_FALL = 26 px` (`(fall - 26) * 0.55`). Worms clamp
  horizontally to map edges; nothing survives water (instant death, Req 6.5).
- **Weapons are data-driven** (`WEAPONS` table) rather than switch-cased, so
  balance numbers (radius, damage, fuse, ammo) live in one place and the fire
  path is generic.

### CPU ("no special bot code, just `isCpu`")
- The **same** input handler runs for humans and bots; CPU teams set the same
  flags programmatically: wander along the ground, aim (with overshoot/undershoot
  and a reaction spread), walk during retreat, then charge and fire. Per the SDD
  (design.md §106) this means `?demo` is a faithful CPU-vs-CPU stress test, not
  a shortcut path.

### Sudden death (Req 10)
- Starts at **turn 20** (10 turns/team). Living worms' HP is capped at **30**.
- At **each SD turn-start the water line rises 12 px** (smaller Y = water climbs).
  The water rises *unstopped* until it has climbed past the highest terrain, so
  any match that survives by turtling is forced to terminate (last survivor's
  team wins, or a draw). This guarantees bounded match length for *every* random
  seed.

---

## Functional choices worth noting

- **Turn hand-off never soft-locks.** `SETTLING` waits for all worms at rest, no
  live projectiles, and no pending death detonations — but a hard 8 s cap
  (`SETTLE_CAP`) force-zeroes velocities and snaps worms to the nearest solid
  (or drowns them) so a wedged projectile or airborne worm can never hang a turn
  (Req 9.2).
- **Death resolution is turn-boundary only** (Req 6.7): HP hits apply mid-flight,
  but a 0-HP worm is flagged `dying` (0.5 s timer) and only detonates in
  `SETTLING → TURN_END`, so a worm killed during its own turn still gets its
  death detonation resolved before win/draw is evaluated.
- **Audio** uses the Web Audio API, created on first user gesture; any failure
  disables sound silently without affecting gameplay (Req 8.4).
- **No console errors on any screen** (Req 8.4) — verified by the smoke test
  across multiple rematches.

---

## Bugs found and fixed during TDD

1. **`solidAt` didn't floor fractional Y.** Terrain queries received floats like
   `554.04`; without flooring, the pixel index `(y*W + x)` read the wrong column,
   so worms' feet tested as "air" and they fell through the world and drowned
   within the first frame (the original all-wipe at turn 0, `hp:[0,0]`, with no
   explosions). Fix: floor both coordinates in `solidAt`.

2. **Water counted as solid ground.** `Terrain` originally drew onto the main
   canvas, so after the first explosion's `_refreshAlpha` the alpha cache
   included the opaque water pixels. Worms then *rested on the rising water* at
   the top of the screen, the drowning check (`y + r >= waterY`) read false, and
   the demo hung in `SETTLING` forever on seeds where explosions didn't wipe a
   team. Fix: give `Terrain` a private offscreen canvas for its solidity bitmap;
   `render()` already blits it onto the display, so water now lives only on the
   display canvas and never pollutes `solidAt`.

3. **Sudden-death water had a floor cap of 60.** Terrain is never generated below
   y = 240, so capping water at 60 meant it could never reach any worm on high
   ground — SD would loop forever on some seeds. Fix: the water rises unstopped
   (floored only at 0) so the highest terrain is eventually submerged, matching
  Req 10.4's "rising water guarantees the match terminates."

These three together turned a demo that died instantly (or hung) into one that
reliably reaches `GAME_OVER` for any random seed, as the `sudden`/`smoke` specs
assert.
