# Worms HTML Game — Tasks

- [ ] 1. Project Scaffolding
  - [ ] 1.1 Create index.html with canvas, HUD containers, and script/style links
  - [ ] 1.2 Create style.css with game layout, HUD styling, overlays
  - [ ] 1.3 Create game.js with initial module structure
  - _Requirements: REQ-UI-1, REQ-UI-2, REQ-UI-3_

- [ ] 2. Terrain System
  - [ ] 2.1 Implement terrain generation with layered sine waves
  - [ ] 2.2 Implement terrain rendering (fill above surface, water below)
  - [ ] 2.3 Implement circular terrain destruction on explosion
  - [ ] 2.4 Implement terrain collision detection (isCollision, getSurfaceY)
  - _Requirements: REQ-TERRAIN-1, REQ-TERRAIN-2, REQ-TERRAIN-3, REQ-TERRAIN-4_

- [ ] 3. Worm System
  - [ ] 3.1 Implement Worm class with position, HP, team, state
  - [ ] 3.2 Implement worm movement along terrain surface
  - [ ] 3.3 Implement worm jumping with gravity
  - [ ] 3.4 Implement worm rendering (body, eyes, health bar, team color)
  - [ ] 3.5 Implement damage, death, water fall detection
  - _Requirements: REQ-WORM-1, REQ-WORM-2, REQ-WORM-3, REQ-WORM-4, REQ-WORM-5_

- [ ] 4. Weapons & Projectiles
  - [ ] 4.1 Implement Projectile class with position and velocity
  - [ ] 4.2 Implement projectile physics (gravity, wind)
  - [ ] 4.3 Implement terrain collision and ricochet
  - [ ] 4.4 Implement explosion (terrain destruction, damage falloff)
  - [ ] 4.5 Implement projectile trail rendering
  - _Requirements: REQ-WEAPON-1, REQ-WEAPON-2, REQ-WEAPON-3, REQ-WEAPON-4, REQ-WEAPON-5_

- [ ] 5. Player Controls
  - [ ] 5.1 Implement keyboard input handling
  - [ ] 5.2 Implement worm movement (left/right along terrain)
  - [ ] 5.3 Implement aiming angle adjustment (up/down)
  - [ ] 5.4 Implement power charging and firing (space bar)
  - [ ] 5.5 Implement jump (tab)
  - _Requirements: REQ-CTRL-1, REQ-CTRL-2, REQ-CTRL-3, REQ-CTRL-4_

- [ ] 6. Turn System
  - [ ] 6.1 Implement game state machine
  - [ ] 6.2 Implement turn timer (30 seconds)
  - [ ] 6.3 Implement turn switching between teams
  - [ ] 6.4 Implement auto-switch when timer expires
  - [ ] 6.5 Implement game over detection and screen
  - _Requirements: REQ-TURN-1, REQ-TURN-2, REQ-TURN-3, REQ-TURN-4_

- [ ] 7. AI Opponent
  - [ ] 7.1 Implement target selection (nearest enemy worm)
  - [ ] 7.2 Implement aim calculation with wind compensation
  - [ ] 7.3 Implement variable power selection
  - [ ] 7.4 Add delay before AI fires for natural feel
  - _Requirements: REQ-AI-1, REQ-AI-2, REQ-AI-3, REQ-AI-4_

- [ ] 8. Camera System
  - [ ] 8.1 Implement Camera class with smooth follow
  - [ ] 8.2 Follow active worm during gameplay
  - [ ] 8.3 Follow projectile during flight
  - _Requirements: REQ-UI-4_

- [ ] 9. HUD & UI
  - [ ] 9.1 Implement team indicator and active worm display
  - [ ] 9.2 Implement health bars for all worms
  - [ ] 9.3 Implement wind indicator
  - [ ] 9.4 Implement turn timer
  - [ ] 9.5 Implement power bar for charging
  - [ ] 9.6 Implement game over screen with restart
  - _Requirements: REQ-UI-1, REQ-UI-2, REQ-UI-3_

- [ ] 10. Polish & Edge Cases
  - [ ] 10.1 Handle all worms of a team dying simultaneously
  - [ ] 10.2 Handle worm falling into water
  - [ ] 10.3 Handle "calm" wind display
  - [ ] 10.4 Handle terrain fully destroyed under worm (fall with gravity)
  - [ ] 10.5 Test and fix any bugs
  - _Requirements: EC-1, EC-2, EC-3, EC-4_
