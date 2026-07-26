# Tasks — Worms (HTML5 Clone)

Implementation plan. Each task references the requirements it satisfies.
(Status updated after implementation & verification.)

- [x] **1. Project scaffold** — create `index.html`, `style.css`, `game.js`; page layout
  with centered 960×540 canvas, weapon buttons, help legend. _(REQ-9.1, REQ-10.1)_
- [x] **2. Core loop & state machine** — fixed-timestep accumulator, FSM
  (title/aim/charge/projectile/retreat/settle/gameover), input plumbing. _(REQ-10.3)_
- [x] **3. Terrain generation & rendering** — sine-noise heightmap, caves, grass/dirt
  `ImageData` painter, offscreen cache, water band. _(REQ-1.1, REQ-1.2, REQ-1.5)_
- [x] **4. Worm physics & movement** — gravity, walking with 6 px step-up, jumping,
  landing snap, fall damage, drowning. _(REQ-3)_
- [x] **5. Teams & turn cycle** — 2×3 worms, round-robin cursors, 30 s turn timer,
  turn banner. _(REQ-2, REQ-9.3)_
- [x] **6. Aiming & charging** — crosshair, angle clamp, power bar, release/auto fire. _(REQ-4)_
- [x] **7. Weapons** — bazooka (wind-driven, impact detonation), grenade (bounce + 3 s
  fuse + retreat), dynamite (drop + 5 s fuse + retreat). _(REQ-5, REQ-9.5)_
- [x] **8. Wind system** — per-turn randomization, HUD arrow, bazooka deflection. _(REQ-6)_
- [x] **9. Explosions** — terrain carving + column repaint, damage falloff, knockback,
  debris/smoke/flash/shake. _(REQ-1.3, REQ-1.4, REQ-7)_
- [x] **10. Camera** — smooth follow of worm/projectile, world-bounds clamp, shake. _(REQ-8)_
- [x] **11. HUD & overlays** — team HP panels, timer, weapon slots, title & victory
  screens with restart. _(REQ-9)_
- [x] **12. Styling polish** — page chrome, retro-look CSS, responsive canvas scaling,
  button states synced with selection. _(REQ-10.1)_
- [x] **13. Demo bot** — `?demo` autoplay via synthetic key events. _(REQ-10.5)_
- [x] **14. Verification** — run in browser, exercise title → play → explosion → next
  turn, confirm zero console errors, screenshot key states. _(all REQs)_
