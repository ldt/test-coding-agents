# Worms HTML Game - Implementation Tasks

## Phase 1: Foundation (Core Infrastructure)

- [ ] 1.1 **Project Setup**
  - Create index.html with Canvas element and script imports
  - Create style.css with basic styling and layout
  - Set up game.js with module structure and main Game class
  - _Requirements: US-001_

- [ ] 1.2 **Game Loop**
  - Implement requestAnimationFrame loop
  - Add delta time calculation
  - Create game state machine (setup, playing, paused, gameover)
  - _Requirements: US-003_

- [ ] 1.3 **Input Manager**
  - Add keyboard event listeners (arrow keys, space, enter)
  - Add mouse event listeners (click, move)
  - Create input state tracking
  - _Requirements: US-004, US-009_

## Phase 2: Terrain System

- [ ] 2.1 **Terrain Generation**
  - Implement Perlin noise function for heightmap
  - Create terrain pixel array from heightmap
  - Add water/void areas below sea level
  - _Requirements: US-002_

- [ ] 2.2 **Terrain Rendering**
  - Draw terrain to canvas using ImageData
  - Add color gradient (grass, dirt, rock)
  - Render water with transparency
  - _Requirements: US-002_

- [ ] 2.3 **Terrain Destruction**
  - Create circular explosion mask
  - Remove terrain pixels within radius
  - Update collision boundaries after destruction
  - _Requirements: US-002_

## Phase 3: Entity System

- [ ] 3.1 **Worm Class**
  - Create Worm class with position, health, team
  - Add state machine (idle, moving, jumping, falling, dead)
  - Implement basic movement (left/right)
  - _Requirements: US-004_

- [ ] 3.2 **Worm Rendering**
  - Draw worm body (ellipse or rectangle)
  - Add health bar above worm
  - Show team color
  - _Requirements: US-008_

- [ ] 3.3 **Worm Physics**
  - Apply gravity to worms
  - Detect terrain collision
  - Handle worm falling off screen (death)
  - _Requirements: US-004, US-021_

- [ ] 3.4 **Projectile Class**
  - Create Projectile class with position, velocity
  - Add time-to-live for auto-destruction
  - Implement physics (gravity, air resistance)
  - _Requirements: US-006_

- [ ] 3.5 **Projectile Rendering**
  - Draw projectile (small circle or sprite)
  - Add trail effect (optional)
  - _Requirements: US-008_

## Phase 4: Collision System

- [ ] 4.1 **Terrain Collision**
  - Check if point is in solid terrain
  - Find terrain surface at x coordinate
  - Handle worm-terrain interaction
  - _Requirements: US-002, US-004_

- [ ] 4.2 **Projectile-Terrain Collision**
  - Detect when projectile hits terrain
  - Trigger explosion on collision
  - Remove projectile after impact
  - _Requirements: US-006_

- [ ] 4.3 **Projectile-Worm Collision**
  - Detect when projectile hits worm
  - Calculate damage based on distance
  - Apply damage to worm
  - _Requirements: US-006_

- [ ] 4.4 **Worm-Worm Collision**
  - Prevent worms from overlapping
  - Handle push mechanics
  - _Requirements: US-004_

## Phase 5: Weapon System

- [ ] 5.1 **Weapon Definitions**
  - Create weapon data structure
  - Implement bazooka (default weapon)
  - Add ammo tracking
  - _Requirements: US-005_

- [ ] 5.2 **Weapon UI**
  - Display current weapon name
  - Show ammo count
  - Add weapon selection (future)
  - _Requirements: US-014_

- [ ] 5.3 **Aiming System**
  - Track mouse position for aim direction
  - Calculate aim angle from worm to mouse
  - Show aim indicator (line or arrow)
  - _Requirements: US-009_

- [ ] 5.4 **Firing System**
  - Launch projectile in aim direction
  - Apply power based on charge time (optional)
  - Create projectile with correct velocity
  - _Requirements: US-009, US-015_

- [ ] 5.5 **Trajectory Preview**
  - Calculate and draw trajectory arc
  - Show predicted landing point
  - Update in real-time as aiming
  - _Requirements: US-015_

## Phase 6: Combat System

- [ ] 6.1 **Explosion Effect**
  - Create expanding circle animation
  - Add screen shake (optional)
  - Flash screen white briefly
  - _Requirements: US-008, US-024_

- [ ] 6.2 **Damage Calculation**
  - Calculate damage based on distance from center
  - Apply damage falloff (closer = more damage)
  - Apply force push to nearby worms
  - _Requirements: US-006, US-017_

- [ ] 6.3 **Damage Display**
  - Show floating damage numbers
  - Animate damage text rising and fading
  - _Requirements: US-008, US-025_

- [ ] 6.4 **Worm Death**
  - Check if health reaches 0
  - Remove worm from game
  - Play death animation (optional)
  - _Requirements: US-020_

## Phase 7: Turn System

- [ ] 7.1 **Turn Manager**
  - Implement team rotation logic
  - Track current team and worm
  - Handle turn start/end events
  - _Requirements: US-003_

- [ ] 7.2 **Turn Timer**
  - Add 30-second countdown timer
  - Display timer on screen
  - Auto-end turn when timer expires
  - _Requirements: US-008_

- [ ] 7.3 **Turn Controls**
  - Enable/disable input based on turn state
  - Highlight active worm
  - Show team turn indicator
  - _Requirements: US-007, US-026_

- [ ] 7.4 **Turn Actions**
  - Allow movement during turn
  - Allow weapon use (ends turn)
  - Add skip turn option
  - _Requirements: US-003, US-009_

## Phase 8: Game Setup & UI

- [ ] 8.1 **Team Setup**
  - Create 2 teams with 4 worms each
  - Assign team colors and names
  - Position worms randomly on terrain
  - _Requirements: US-001_

- [ ] 8.2 **HUD Elements**
  - Display current team name
  - Show worm health bars
  - Add turn indicator
  - _Requirements: US-008_

- [ ] 8.3 **Game Start Screen**
  - Show "Click to Start" prompt
  - Brief instructions
  - _Requirements: US-001_

- [ ] 8.4 **Victory Screen**
  - Detect win condition (one team left)
  - Display winner announcement
  - Add restart button
  - _Requirements: US-007, US-022, US-023_

## Phase 9: Polish & Effects

- [ ] 9.1 **Sound Effects** (Optional)
  - Add explosion sound
  - Add worm hurt sound
  - Add turn change sound
  - _Requirements: US-008_

- [ ] 9.2 **Visual Polish**
  - Add terrain texture (noise pattern)
  - Add sky gradient background
  - Add cloud effects (optional)
  - _Requirements: US-008_

- [ ] 9.3 **Animation Polish**
  - Smooth worm movement
  - Particle effects for explosions
  - Screen shake on big explosions
  - _Requirements: US-008_

## Phase 10: Testing & Refinement

- [ ] 10.1 **Functional Testing**
  - Test full game cycle
  - Verify all weapons work
  - Check turn system logic
  - _Requirements: All_

- [ ] 10.2 **Edge Case Testing**
  - Test worm falling off map
  - Test multiple worms in explosion
  - Test weapon ammo depletion
  - _Requirements: All_

- [ ] 10.3 **Performance Testing**
  - Verify 60fps rendering
  - Test with large terrain destruction
  - Optimize collision detection
  - _Requirements: All_

- [ ] 10.4 **Final Polish**
  - Fix any bugs found
  - Improve UI/UX
  - Add loading states
  - _Requirements: All_

## Dependencies

```
Phase 1 (Foundation) ──► Phase 2 (Terrain) ──► Phase 3 (Entities)
                    └──► Phase 3 (Entities) ──► Phase 4 (Collision)
                                              └──► Phase 5 (Weapons)
Phase 4 (Collision) ──► Phase 6 (Combat)
Phase 5 (Weapons) ──► Phase 6 (Combat)
Phase 6 (Combat) ──► Phase 7 (Turns)
Phase 3 (Entities) ──► Phase 7 (Turns)
Phase 7 (Turns) ──► Phase 8 (UI)
Phase 8 (UI) ──► Phase 9 (Polish)
Phase 9 (Polish) ──► Phase 10 (Testing)
```

## Estimated Effort

- Phase 1-2: 4-6 hours (Foundation)
- Phase 3-4: 6-8 hours (Core mechanics)
- Phase 5-6: 4-6 hours (Combat)
- Phase 7-8: 4-6 hours (Game flow)
- Phase 9-10: 4-6 hours (Polish)
- **Total: 22-32 hours**

## Success Criteria

1. Two teams of 4 worms each
2. Turn-based gameplay with 30-second timer
3. Destructible terrain with Perlin noise generation
4. Bazooka weapon with projectile physics
5. Collision detection for terrain and worms
6. Damage calculation and health system
7. Win condition (last team standing)
8. Visual effects for explosions and damage
9. Intuitive mouse+keyboard controls
10. Smooth 60fps performance
