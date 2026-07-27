# Worms HTML Game - Requirements Specification

## Project Overview

Create a browser-based implementation of the classic Worms turn-based strategy game using HTML5, CSS3, and vanilla JavaScript.

## User Stories

### Primary User Stories

**US-001: Game Setup**
As a player, I want to set up a game with multiple teams so that I can play against friends or AI opponents.

**US-002: Terrain Destruction**
As a player, I want to destroy terrain using weapons so that I can create tactical advantages and harm opponents.

**US-003: Turn-Based Combat**
As a player, I want to take turns moving my worms and using weapons so that we can compete fairly.

**US-004: Worm Movement**
As a player, I want to move my worms across the terrain so that I can position them strategically.

**US-005: Weapon System**
As a player, I want to use different weapons with varying effects so that I can choose the best attack strategy.

**US-006: Health and Damage**
As a player, I want worms to have health points that decrease when damaged so that the game has clear win/lose conditions.

**US-007: Win Condition**
As a player, I want the game to end when only one team has worms remaining so that there's a clear winner.

### Secondary User Stories

**US-008: Visual Feedback**
As a player, I want visual effects for explosions and damage so that the game feels dynamic and engaging.

**US-009: UI Controls**
As a player, I want intuitive controls for aiming and firing weapons so that the game is easy to play.

**US-010: Game Reset**
As a player, I want to restart the game so that I can play multiple rounds.

## Acceptance Criteria (EARS Format)

### Game Setup
1. WHEN player starts new game THEN system SHALL create 2 teams with 4 worms each
2. WHEN game starts THEN system SHALL randomly position worms on terrain
3. WHEN game starts THEN system SHALL assign random team colors

### Terrain
4. WHEN terrain is generated THEN system SHALL create random hills and valleys
5. WHEN explosion occurs THEN system SHALL remove terrain pixels in explosion radius
6. WHEN terrain is destroyed THEN system SHALL update collision boundaries

### Turn System
7. WHEN it's player's turn THEN system SHALL highlight active worm
8. WHEN player moves worm THEN system SHALL consume turn time (30 seconds max)
9. WHEN player attacks THEN system SHALL end turn after weapon is used
10. WHEN all worms of one team are eliminated THEN system SHALL declare opposing team winner

### Movement
11. WHEN player presses left/right arrow THEN system SHALL move worm in that direction
12. WHEN worm reaches terrain edge THEN system SHALL prevent further movement
13. WHEN worm falls due to gravity THEN system SHALL apply physics until landing

### Weapons
14. WHEN player selects weapon THEN system SHALL show weapon name and ammo count
15. WHEN player aims THEN system SHALL show trajectory preview
16. WHEN player fires bazooka THEN system SHALL launch projectile with gravity
17. WHEN projectile hits terrain THEN system SHALL create explosion and destroy terrain
18. WHEN projectile hits worm THEN system SHALL deal damage based on distance from center

### Health System
19. WHEN worm takes damage THEN system SHALL decrease health by damage amount
20. WHEN worm health reaches 0 THEN system SHALL remove worm from game
21. WHEN worm falls into water or off screen THEN system SHALL instantly kill worm

### Win Condition
22. WHEN only one team has living worms THEN system SHALL display victory message
23. WHEN victory occurs THEN system SHALL offer restart option

### Visual Feedback
24. WHEN explosion occurs THEN system SHALL display expanding circle animation
25. WHEN worm takes damage THEN system SHALL show damage number
26. WHEN turn changes THEN system SHALL display team turn indicator

## Constraints

- Must work in modern browsers (Chrome, Firefox, Safari, Edge)
- No external libraries or frameworks
- All graphics rendered via Canvas API
- Game must run at 60 FPS
- Single HTML file with embedded CSS/JS OR separate files (user preference)

## Out of Scope

- Multiplayer networking
- Sound effects
- Complex AI opponents
- Saving/loading game state
- Mobile touch controls (future enhancement)
