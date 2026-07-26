# Worms HTML Game — Requirements

## User Story
As a player, I want to play a turn-based artillery game where I control a team of worms and defeat the enemy team using projectile weapons on a destructible terrain.

## Acceptance Criteria

### Terrain
REQ-TERRAIN-1: WHEN the game loads THEN terrain SHALL be procedurally generated using sine waves
REQ-TERRAIN-2: WHEN a projectile explodes THEN terrain SHALL be destructible in a circular radius
REQ-TERRAIN-3: WHEN terrain is destroyed THEN collision SHALL update dynamically
REQ-TERRAIN-4: WHEN a worm falls below the terrain surface into water THEN the worm SHALL die

### Worms & Teams
REQ-WORM-1: WHEN the game starts THEN 2 teams SHALL exist, each with 3 worms
REQ-WORM-2: EACH worm SHALL have 100 hit points
REQ-WORM-3: WHEN a worm's HP reaches 0 THEN the worm SHALL die and be removed
REQ-WORM-4: WHEN one team loses all worms THEN the other team SHALL win
REQ-WORM-5: Worms SHALL be colored by team (blue team, red team)

### Movement & Controls
REQ-CTRL-1: WHEN the player presses LEFT/RIGHT THEN the active worm SHALL walk in that direction along the terrain surface
REQ-CTRL-2: WHEN the player presses UP/DOWN THEN the aim angle SHALL adjust
REQ-CTRL-3: WHEN the player holds SPACE THEN power SHALL charge; WHEN released SHALL fire
REQ-CTRL-4: WHEN the player presses TAB THEN the worm SHALL jump

### Weapons & Physics
REQ-WEAPON-1: WHEN fired THEN a projectile SHALL follow a parabolic trajectory with gravity
REQ-WEAPON-2: Wind SHALL affect the projectile's horizontal velocity
REQ-WEAPON-3: WHEN the projectile hits terrain or a worm THEN it SHALL explode
REQ-WEAPON-4: WHEN explosion occurs THEN damage SHALL decrease with distance from center
REQ-WEAPON-5: Projectiles SHALL ricochet off terrain once before exploding on second impact

### Turn System
REQ-TURN-1: Players SHALL alternate turns between teams
REQ-TURN-2: EACH turn SHALL have a 30-second timer
REQ-TURN-3: WHEN timer expires OR weapon is fired THEN turn SHALL end
REQ-TURN-4: AFTER turn ends SHALL switch to next alive worm on the other team

### Computer Opponent
REQ-AI-1: The red team SHALL be computer-controlled
REQ-AI-2: AI SHALL aim toward the nearest enemy worm
REQ-AI-3: AI SHALL account for wind when aiming
REQ-AI-4: AI SHALL fire with variable power

### UI
REQ-UI-1: HUD SHALL display current team, worm HP, wind strength, and timer
REQ-UI-2: A power bar SHALL show current charge level
REQ-UI-3: WHEN game ends SHALL show victory screen with restart option
REQ-UI-4: Camera SHALL follow the active worm and any in-flight projectile

## Edge Cases
EC-1: WHEN all worms on a team are dead simultaneously THEN the surviving team SHALL win
EC-2: WHEN a worm falls into water it SHALL be removed regardless of HP
EC-3: WHEN wind is zero SHALL show "calm" indicator
EC-4: WHEN terrain is fully destroyed in an area THEN worms SHALL fall with gravity
