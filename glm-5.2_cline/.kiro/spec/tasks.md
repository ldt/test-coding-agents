# Tasks

## T1: Project Scaffolding
- [x] T1.1: Create subfolder `glm-5.2_cline`.
- [x] T1.2: Create `.kiro/spec/` with requirements.md, design.md, tasks.md.
- [x] T1.3: Create `index.html` with canvas and UI overlay markup.
- [x] T1.4: Create `styles.css` with layout and theming.
- [x] T1.5: Create `game.js` with game loop skeleton.

## T2: Terrain System
- [x] T2.1: Implement `Terrain` class with offscreen canvas + ImageData buffer.
- [x] T2.2: Implement procedural heightmap generation (sine waves + noise).
- [x] T2.3: Implement `isSolid(x, y)` collision check.
- [x] T2.4: Implement `eraseCircle(x, y, radius)` destruction.
- [x] T2.5: Implement `findSurface(x)` to locate top solid pixel.

## T3: Worms & Physics
- [x] T3.1: Implement `Worm` object creation and placement on terrain.
- [x] T3.2: Implement gravity + terrain collision for worms.
- [x] T3.3: Implement fall damage on hard landings.
- [x] T3.4: Implement walking (A/D keys) with per-turn distance limit.
- [x] T3.5: Render worms with health bars, names, active highlight.

## T4: Turn System
- [x] T4.1: Implement team/worm cycling and active worm selection.
- [x] T4.2: Implement 45s turn timer with auto-skip on expiry.
- [x] T4.3: Implement 3s post-turn delay.
- [x] T4.4: Implement wind randomization per turn.

## T5: Aiming & Firing
- [x] T5.1: Implement mouse aim angle calculation.
- [x] T5.2: Implement power charging on mouse hold (0–100%).
- [x] T5.3: Render aim line and power bar.

## T6: Weapons
- [x] T6.1: Implement Bazooka (gravity + wind projectile, splash damage).
- [x] T6.2: Implement Grenade (bouncing, 3s fuse, splash damage).
- [x] T6.3: Implement Shotgun (instant raycast, spread, short range).
- [x] T6.4: Implement Airstrike (delayed falling bombs at target x).
- [x] T6.5: Implement explosion logic (terrain erase + damage + knockback).

## T7: Win Condition & UI
- [x] T7.1: Implement win detection (team elimination).
- [x] T7.2: Implement game-over overlay with winner and Play Again.
- [x] T7.3: Wire weapon selection buttons (1–4 keys + click).
- [x] T7.4: Display HUD: team, worm, timer, wind indicator.

## T8: Polish & Testing
- [x] T8.1: Responsive canvas scaling.
- [x] T8.2: Verify 60 FPS performance.
- [x] T8.3: Test all weapons and turn flow.
- [x] T8.4: Final code cleanup and comments.
