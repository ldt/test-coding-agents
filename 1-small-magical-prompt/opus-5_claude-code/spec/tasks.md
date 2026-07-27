# Tasks — HTML Worms

Sequencing is foundation-first for the world (terrain and physics are what everything else stands
on), then feature-slice per weapon. Each task states what it produces and which requirements it
serves.

- [x] 1. Project skeleton
- [x] 1.1 Create `index.html` with the canvas, HUD containers, weapon dock, banner and overlay nodes
  - Semantic containers only; no logic, no inline styles
  - _Requirements: 8.1, 8.2, 8.3, 9.3_
- [x] 1.2 Create `style.css`: layout, team-coloured HUD, dock slots, overlays, banner animation
  - CSS custom properties for team colours so JS only sets variables
  - _Requirements: 8.1, 8.2, 8.6_
- [x] 1.3 Create `game.js` shell: strict-mode IIFE, constants, utility helpers, rAF loop with a
      fixed-step accumulator and delta clamping
  - _Requirements: 10.5_

- [x] 2. Terrain
- [x] 2.1 Fractal height-map generation into a `Uint8Array` mask plus cave subtraction
  - _Requirements: 1.2, 2.1_
- [x] 2.2 Render the mask into an offscreen canvas with grass/soil strata and per-pixel noise
  - _Requirements: 2.1_
- [x] 2.3 `solid(x, y)` O(1) query and `surfaceY(x)` column probe
  - _Requirements: 2.5, 1.3_
- [x] 2.4 `carve(cx, cy, r)`: mask clearing, `destination-out` hole, `source-atop` scorch rim
  - _Requirements: 2.2, 2.3_

- [x] 3. Camera and world rendering
- [x] 3.1 Sky gradient, parallax hill layers, drifting clouds, animated water band
  - _Requirements: 8.5_
- [x] 3.2 Camera follow with damping, world clamping and decaying shake
  - _Requirements: 8.4, 8.5_
- [x] 3.3 Canvas resize handling with device-pixel-ratio scaling
  - _Requirements: 8.6_

- [x] 4. Worms
- [x] 4.1 Worm model, ellipse hull collision sampling, spawn placement with spacing and retries
  - _Requirements: 1.3, 1.4, 1.5_
- [x] 4.2 Walking with slope climb/block, facing, footstep audio
  - _Requirements: 4.1, 4.2, 4.3_
- [x] 4.3 Gravity, sub-stepped airborne integration, landing, fall damage, drowning
  - _Requirements: 4.5, 4.6, 10.4_
- [x] 4.4 Jump
  - _Requirements: 4.4_
- [x] 4.5 Worm drawing: body, team band, eyes tracking the aim, name plate and health bar, active
      worm marker
  - _Requirements: 8.1_

- [x] 5. Turn state machine
- [x] 5.1 Team/worm round-robin selection, turn clock, wind randomisation, turn banner
  - _Requirements: 3.1, 3.2, 3.3, 8.3_
- [x] 5.2 States AIM / TARGET / FLIGHT / SETTLE / RETREAT / END_TURN with input gating
  - _Requirements: 3.6, 3.7, 3.8_
- [x] 5.3 Clock expiry behaviour (fire if charging, otherwise end turn)
  - _Requirements: 3.4, 3.5_
- [x] 5.4 Win/draw detection and the result overlay with rematch
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 6. Aiming and firing
- [x] 6.1 Keyboard aim clamped to ±85°, crosshair rendering
  - _Requirements: 5.1, 5.2_
- [x] 6.2 Mouse aiming with facing update
  - _Requirements: 5.3_
- [x] 6.3 Power charging, gauge rendering, auto-fire at full power
  - _Requirements: 5.4, 5.5, 5.6_

- [x] 7. Projectiles and explosions
- [x] 7.1 Projectile integration with wind, gravity, sub-stepping, smoke trail
  - _Requirements: 6.5, 10.1_
- [x] 7.2 Terrain collision with mask-gradient normals and bouncing; worm contact detonation
  - _Requirements: 6.6_
- [x] 7.3 Water removal with splash; 12-second life cap
  - _Requirements: 10.2, 10.3_
- [x] 7.4 `explode()`: crater, falloff damage, knockback, floating numbers, particles, shake, sound
  - _Requirements: 2.2, 2.4, 7.1, 7.2, 7.3, 7.6, 8.4_
- [x] 7.5 Death detonation with delay, chain reactions, removal from play
  - _Requirements: 7.4, 7.5_

- [x] 8. Arsenal
- [x] 8.1 Weapon table, dock rendering from data, selection by key and click, ammo gating
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
- [x] 8.2 Bazooka and Grenade
  - _Requirements: 6.5, 6.6_
- [x] 8.3 Cluster Bomb with 5 bomblets
  - _Requirements: 6.7_
- [x] 8.4 Shotgun ray with two shots per use
  - _Requirements: 6.8_
- [x] 8.5 Dynamite dropped at the feet
  - _Requirements: 6.9_
- [x] 8.6 Airstrike targeting mode and bomb run
  - _Requirements: 6.10_

- [x] 9. Feedback layer
- [x] 9.1 Particle system (debris, smoke, sparks, splash) and floating damage text
  - _Requirements: 7.3, 8.4_
- [x] 9.2 WebAudio synthesis for explosion, fire, jump, step, splash, select, and turn change
  - _Requirements: 8.4_
- [x] 9.3 `syncHud()` writing team health, clock, wind gauge, worm name and ammo counts
  - _Requirements: 8.1, 8.2_

- [x] 10. Validation
- [x] 10.1 Syntax check `game.js`
- [x] 10.2 Playwright smoke test: load, start, play input, assert no console errors and that state
      advanced; capture a screenshot
  - _Requirements: all_
