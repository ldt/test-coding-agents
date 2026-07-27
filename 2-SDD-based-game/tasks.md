# Implementation Plan

Execute tasks in order; each builds on the previous. Keep the whole game runnable after every task (stub what isn't built yet). All code goes in exactly `index.html`, `game.js`, `style.css` in this folder.

- [ ] 1. Scaffold page, loop, and state machine
  - Create `index.html` with the canvas, HUD containers (timer, wind, weapon panel, team bars), title-screen and victory-screen overlays; link `style.css` and `game.js`.
  - Implement the rAF loop with a clamped-delta fixed-step accumulator (60 Hz sim, swept ≤3 px projectile sub-steps) and the state enum (`TITLE`, `TURN_START`, `AIMING`, `CHARGING`, `PROJECTILE`, `RETREAT`, `SETTLING`, `TURN_END`, `GAME_OVER`) with per-state `enter/update` handlers and an `allowedInputs` filter.
  - Wire the title screen: "2 Players" / "vs CPU" buttons set `game.mode` and start a match; controls summary visible.
  - Expose `window.__game` debug handle.
  - _Requirements: 1.1, 1.6, 9.3, 9.4_

- [ ] 2. Terrain generation and bitmap collision
  - Build the `Terrain` offscreen canvas: layered value-noise height map, dirt fill with grass top band, water band at the bottom; alpha cache and `solidAt(x, y)`; mutable `waterY`.
  - Enforce the standing-zones guarantee: count flat-enough runs above the water line after generation; fewer than 8 → regenerate (bounded attempts).
  - Implement `carve(x, y, r)` with destination-out erase, darkened crater rim, and dirty-rect alpha refresh.
  - Render sky gradient, terrain blit, and animated water in the main draw pass.
  - _Requirements: 1.7, 2.1, 2.2, 2.3, 2.5, 2.6_

- [ ] 3. Worm spawning, gravity, and rendering
  - Create the two 4-worm teams with distinct colors and names; spawn each worm on a standing zone with ≥80 px spacing; on placement failure after bounded retries, regenerate terrain (never spawn in air/water/overlap).
  - Implement worm physics: gravity, circle-vs-terrain landing, `atRest` tracking, fall-distance recording and fall damage; drowning on water contact.
  - Render worms with team color, HP label above, facing, and an active-worm marker.
  - _Requirements: 1.2, 1.7, 2.4, 4.4, 6.1, 6.5, 8.3_

- [ ] 4. Turn controller and timers
  - Random first team; per-team round-robin cursor over living worms; 45 s turn timer with HUD display; turn passes on timeout — except a held charging shot fires at current power on expiry.
  - Implement `TURN_END` → win/draw detection → `GAME_OVER` with victory/draw overlay and Rematch (fresh terrain, same page).
  - Handle active-worm-death-ends-turn and input lockout for non-active worms.
  - Implement sudden death: at 20 total turns, announce in HUD, cap all HP at 30, raise `waterY` 12 px at each subsequent turn start.
  - _Requirements: 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.6, 3.7, 10.1–10.4_

- [ ] 5. Worm movement and aiming input
  - Keyboard map (arrows walk, up/down aim, Enter/Z jump); step-up slope walking with steepness limit; arc jump; facing flips mirror the aim.
  - Smooth 180° aim sweep with rendered crosshair.
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

- [ ] 6. Explosion resolver and damage model
  - Implement the single `explode(x, y, radius, maxDmg)` path: carve, proximity-scaled damage with the 25%-of-max floor while overlapping, knockback impulses (friendly fire on), particles, screen shake, floating damage numbers.
  - Defer death resolution to `SETTLING`/`TURN_END`: flag 0-HP worms `dying` (0.5 s), detonate them through `explode()` (25 dmg, 40 px) for chain reactions, leave gravestones; splash-drown effects.
  - _Requirements: 2.2, 6.2, 6.3, 6.4, 6.6, 6.7, 8.2_

- [ ] 7. Projectiles and the weapons table
  - Data-driven `WEAPONS` table with per-team ammo (cluster ×3, shotgun ×3, dynamite ×2); selection via number keys + on-screen panel showing selection and ammo; depleted weapons refuse selection; firing decrements stock.
  - Charged firing (power gauge over ~1.5 s, release/full fires at aim angle); per-turn wind (random, HUD arrow) affecting bazooka only.
  - Implement bazooka (impact), grenade (bounce + 3 s fuse), cluster (fuse burst → exactly 5 bomblets), shotgun (2 instant rays, timer keeps running between them, no retreat), dynamite (placed, big blast); swept collision so fast shells never tunnel.
  - OOB discard rule and 10 s projectile hard timeout.
  - _Requirements: 5.1–5.10, 9.1_

- [ ] 8. Retreat window and settle phase
  - After firing a power/fuse weapon: retreat sub-timer (move only, no firing), max 5 s, ended early once shot effects have resolved and the worm is at rest; `SETTLING` waits on projectiles/worm rest/pending death detonations with the 8 s force-settle cap; then `TURN_END`.
  - Verify the turn always passes across: OOB shot, water-drowned grenade, shotgun double-shot, timer expiry, timer expiry mid-charge, self-kill.
  - _Requirements: 3.3, 3.4, 3.5, 9.1, 9.2_

- [ ] 9. CPU opponent and demo mode
  - Phase-scripted turn (think → optional reposition → visible aim sweep → charge → fire) always inside the turn timer.
  - Shot search: simulate angle×power grid with the real integrator (wind included) against the alpha cache; score by closest approach to the chosen enemy; Gaussian aim error; grenade-lob fallback; least-bad shot if blocked. Time-slice the search across think-pause frames (≤8 sims/frame, no frame >50 ms).
  - Implement `?demo`: skip title, start CPU-vs-CPU using the same controller on both teams.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 9.5_

- [ ] 10. HUD, audio, and presentation pass
  - Team totals (health bars/worm counts), wind strength indicator, charging gauge, weapon panel with ammo counts, sudden-death indicator; styling in `style.css` (system fonts only).
  - Web Audio synthesized effects (fire, explosion, splash, turn change) created on first gesture, failure-safe.
  - Particles for explosions and dirt, water splash, screen-shake tuning; resize/zoom handling keeps the playfield fully visible; no console errors on any screen.
  - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7_

- [ ] 11. Final acceptance sweep
  - Run the manual test passes from design.md §Testing Strategy (state machine incl. sudden death and death-detonation chains, terrain, turn law, physics feel, CPU competence, robustness incl. tab-background test); fix everything found.
  - Optionally add `test/smoke.js` (Playwright, preinstalled at repo root) driving `index.html?demo` headless: assert no console errors, turns advance, team HP totals change, and the match ends — via `window.__game`.
  - Confirm the deliverable is exactly 3 files, zero external requests, playable from `file://`.
  - _Requirements: all_
