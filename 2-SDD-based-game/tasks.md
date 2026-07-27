# Implementation Plan

Execute tasks in order; each builds on the previous. Keep the whole game runnable after every task (stub what isn't built yet). All code goes in exactly `index.html`, `game.js`, `style.css` in this folder.

- [ ] 1. Scaffold page, loop, and state machine
  - Create `index.html` with the canvas, HUD containers (timer, wind, weapon panel, team bars), title-screen and victory-screen overlays; link `style.css` and `game.js`.
  - Implement the rAF loop with a clamped-delta fixed-step accumulator (120 Hz sim) and the state enum (`TITLE`, `TURN_START`, `AIMING`, `CHARGING`, `PROJECTILE`, `RETREAT`, `SETTLING`, `TURN_END`, `GAME_OVER`) with per-state `enter/update` handlers and an `allowedInputs` filter.
  - Wire the title screen: "2 Players" / "vs CPU" buttons set `game.mode` and start a match; controls summary visible.
  - Expose `window.__game` debug handle.
  - _Requirements: 1.1, 1.6, 9.3, 9.4_

- [ ] 2. Terrain generation and bitmap collision
  - Build the `Terrain` offscreen canvas: layered value-noise height map, dirt fill with grass top band, water band at the bottom; alpha cache and `solidAt(x, y)`.
  - Implement `carve(x, y, r)` with destination-out erase, darkened crater rim, and dirty-rect alpha refresh.
  - Render sky gradient, terrain blit, and animated water in the main draw pass.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

- [ ] 3. Worm spawning, gravity, and rendering
  - Create the two 4-worm teams with distinct colors and names; randomized non-overlapping spawn drops onto terrain.
  - Implement worm physics: gravity, circle-vs-terrain landing, `atRest` tracking, fall-distance recording and fall damage; drowning on water contact.
  - Render worms with team color, HP label above, facing, and an active-worm marker.
  - _Requirements: 1.2, 2.4, 4.4, 6.1, 6.5, 8.3_

- [ ] 4. Turn controller and timers
  - Random first team; per-team round-robin cursor over living worms; 45 s turn timer with HUD display; turn passes on timeout.
  - Implement `TURN_END` → win/draw detection → `GAME_OVER` with victory/draw overlay and Rematch (fresh terrain, same page).
  - Handle active-worm-death-ends-turn and input lockout for non-active worms.
  - _Requirements: 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.6, 3.7_

- [ ] 5. Worm movement and aiming input
  - Keyboard map (arrows walk, up/down aim, Enter/Z jump); step-up slope walking with steepness limit; arc jump; facing flips mirror the aim.
  - Smooth 180° aim sweep with rendered crosshair.
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

- [ ] 6. Explosion resolver and damage model
  - Implement the single `explode(x, y, radius, maxDmg)` path: carve, proximity-scaled damage, knockback impulses (friendly fire on), particles, screen shake, floating damage numbers.
  - Defer death resolution to `SETTLING`/`TURN_END`; add gravestones and splash-drown effects.
  - _Requirements: 2.2, 6.2, 6.3, 6.4, 6.6, 6.7, 8.2_

- [ ] 7. Projectiles and the weapons table
  - Data-driven `WEAPONS` table; weapon selection via number keys + on-screen panel with current-selection highlight.
  - Charged firing (power gauge over ~1.5 s, release/full fires at aim angle); per-turn wind (random, HUD arrow) affecting bazooka only.
  - Implement bazooka (impact), grenade (bounce + 3 s fuse), cluster (fuse burst → 4–6 bomblets), shotgun (2 instant rays), dynamite (placed, big blast); swept collision so fast shells never tunnel.
  - OOB discard rule and 10 s projectile hard timeout.
  - _Requirements: 5.1–5.9, 9.1_

- [ ] 8. Retreat window and settle phase
  - After firing: 5 s retreat sub-timer (move only, no firing); `SETTLING` waits on projectiles/worm rest with the 8 s force-settle cap; then `TURN_END`.
  - Verify the turn always passes across: OOB shot, water-drowned grenade, shotgun double-shot, timer expiry, self-kill.
  - _Requirements: 3.4, 3.5, 9.1, 9.2_

- [ ] 9. CPU opponent
  - Phase-scripted turn (think → optional reposition → visible aim sweep → charge → fire) always inside the turn timer.
  - Shot search: simulate angle×power grid with the real integrator (wind included) against the alpha cache; score by closest approach to the chosen enemy; Gaussian aim error; grenade-lob fallback; least-bad shot if blocked.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 10. HUD polish and presentation pass
  - Team totals (health bars/worm counts), wind strength indicator, charging gauge, weapon panel styling in `style.css` (system fonts only).
  - Particles for explosions and dirt, water splash, screen-shake tuning; resize/zoom handling keeps the playfield fully visible.
  - _Requirements: 8.1, 8.2, 8.4, 8.5_

- [ ] 11. Final acceptance sweep
  - Run the manual test passes from design.md §Testing Strategy (state machine, terrain, turn law, physics feel, CPU competence, robustness incl. tab-background test); fix everything found.
  - Optionally add `test/smoke.js` (Playwright, preinstalled at repo root) asserting: page loads with no console errors, a match starts, a fired bazooka changes team HP, and turn passes — using `window.__game`.
  - Confirm the deliverable is exactly 3 files, zero external requests, playable from `file://`.
  - _Requirements: all_
