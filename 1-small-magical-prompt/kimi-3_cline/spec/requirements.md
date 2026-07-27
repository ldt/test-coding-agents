# Requirements — Worms (HTML5 Clone)

## Introduction

This document specifies the requirements for a browser-based, 2-player hot-seat clone of the
classic artillery game **Worms**. Two teams of worms battle on a procedurally generated,
fully destructible 2D terrain. Players take turns moving a worm, aiming, and firing weapons
whose projectiles are affected by gravity and wind. Explosions carve craters into the
terrain, damage and knock back worms. The last team with a living worm wins.

The deliverable is a static web page (1 HTML file, 1 CSS file, 1 JavaScript file) that runs
in any modern desktop browser with no build step and no network dependencies.

## Glossary

- **System**: the Worms web game.
- **Match**: one complete battle from terrain generation to victory/draw.
- **Turn**: a time-boxed period in which one worm (the *active worm*) may act.
- **Terrain**: the destructible pixel map worms stand on.
- **World**: the full playfield (larger than the visible viewport).

## Requirements

### REQ-1 — Procedural, destructible terrain
**User story:** As a player, I want a unique battleground every match, so that each game feels fresh.

**Acceptance criteria:**
1. WHEN a new match starts THEN the System SHALL generate a terrain heightmap using layered
   sinusoidal noise with random phases, producing rolling hills and valleys.
2. WHEN a match starts THEN the System SHALL guarantee spawn-safe ground: at least 6 distinct
   standing zones above the waterline.
3. WHEN an explosion occurs THEN the System SHALL remove all terrain cells inside the blast
   radius, leaving a permanent crater for the rest of the match.
4. WHEN terrain is removed THEN the System SHALL expose grass-topped edges on newly uncovered
   column tops.
5. WHEN terrain below the waterline exists THEN the System SHALL render it submerged beneath
   animated water.

### REQ-2 — Turn-based team combat
**User story:** As a player, I want structured alternating turns, so that both players play fairly.

**Acceptance criteria:**
1. WHEN a match starts THEN the System SHALL create 2 teams (Red, Blue) of 3 worms each with
   100 HP per worm.
2. WHEN a turn ends THEN the System SHALL pass control to the next living worm of the opposing
   team (round-robin within each team).
3. WHEN a turn starts THEN the System SHALL randomize the wind and reset the turn timer to 30 s.
4. IF the turn timer reaches zero before a weapon is fired THEN the System SHALL end the turn
   without firing.
5. WHEN the active worm dies or takes fall damage during its own turn THEN the System SHALL
   end the turn after a short settle delay.

### REQ-3 — Worm movement and jumping
**User story:** As a player, I want to walk and jump around the terrain, so that I can reach
good firing positions.

**Acceptance criteria:**
1. WHILE the active worm is on the ground and the Left/Right arrow is held THEN the System
   SHALL walk the worm horizontally at a constant speed.
2. WHEN a walking worm meets an upward slope of 6 px or less THEN the System SHALL step the
   worm up automatically; steeper walls SHALL block movement.
3. WHEN the player presses Enter (or the worm is walked off a ledge) THEN the System SHALL
   apply gravity physics so the worm jumps/falls and lands on terrain.
4. IF a worm lands with vertical speed above the safe threshold THEN the System SHALL apply
   fall damage proportional to the excess speed and end the worm's turn.
5. IF a worm touches the water THEN the System SHALL kill it immediately (drowning).

### REQ-4 — Aiming and power charging
**User story:** As a player, I want to control shot angle and power, so that I can skillfully
land shots.

**Acceptance criteria:**
1. WHILE in the aiming state THEN the System SHALL display a crosshair showing aim direction
   relative to the worm's facing.
2. WHILE Up/Down arrows are held THEN the System SHALL rotate the aim angle within
   [-75°, +90°].
3. WHEN the player holds Space THEN the System SHALL fill a power meter from 0% to 100% over
   ~1.3 s.
4. WHEN the player releases Space THEN the System SHALL fire the selected weapon with muzzle
   velocity proportional to the charged power.
5. IF the power meter reaches 100% THEN the System SHALL fire automatically.

### REQ-5 — Weapons
**User story:** As a player, I want multiple weapons with distinct behaviours, so that I can
choose tactics.

**Acceptance criteria:**
1. WHEN the player presses 1/2/3 or clicks a weapon button THEN the System SHALL select the
   Bazooka, Grenade, or Dynamite respectively.
2. WHEN the Bazooka is fired THEN the System SHALL launch a projectile that is deflected by
   wind and explodes instantly on contact with terrain or a worm (blast radius 45 px,
   max 50 damage).
3. WHEN the Grenade is thrown THEN the System SHALL simulate a bouncing projectile unaffected
   by wind that detonates on a 3 s fuse (blast radius 40 px, max 45 damage), and the player
   SHALL retain worm control during the fuse (retreat).
4. WHEN the Dynamite is used THEN the System SHALL drop the charge at the worm's feet with a
   5 s fuse (blast radius 62 px, max 75 damage), and the player SHALL retain worm control
   during the fuse.
5. WHEN a projectile leaves the world horizontally or sinks in water THEN the System SHALL
   remove it and end the turn.

### REQ-6 — Wind
**User story:** As a player, I want wind to affect shots, so that long shots require judgement.

**Acceptance criteria:**
1. WHEN a turn starts THEN the System SHALL randomize wind in the range [-3, +3].
2. WHILE a Bazooka round is in flight THEN the System SHALL apply continuous horizontal
   acceleration proportional to the wind.
3. WHILE a turn is in progress THEN the System SHALL display wind direction and strength in
   the HUD.

### REQ-7 — Explosion damage, knockback and feedback
**User story:** As a player, I want juicy, consequential explosions, so that hits feel rewarding.

**Acceptance criteria:**
1. WHEN an explosion occurs THEN the System SHALL apply damage to every worm within 1.5× blast
   radius, scaled linearly with distance from the blast centre.
2. WHEN an explosion occurs THEN the System SHALL impart a radial knockback impulse to every
   affected worm.
3. WHEN an explosion occurs THEN the System SHALL spawn debris/smoke particles, a light flash,
   and camera shake.
4. WHEN a worm's HP reaches 0 THEN the System SHALL remove it from play immediately.

### REQ-8 — Camera
**User story:** As a player, I want the view to follow the action, so that I never lose track
of what matters.

**Acceptance criteria:**
1. WHILE in the aiming state THEN the System SHALL centre the camera on the active worm with
   smooth interpolation.
2. WHILE a projectile is airborne THEN the System SHALL track the projectile.
3. WHILE the camera moves THEN the System SHALL clamp the viewport to world bounds.

### REQ-9 — HUD and game states
**User story:** As a player, I want clear information and screens, so that I understand the
game state at all times.

**Acceptance criteria:**
1. WHEN the page loads THEN the System SHALL show a title screen listing controls and start
   the match on Enter or click.
2. WHILE a match runs THEN the System SHALL display: both teams' total HP bars and worm
   counts, wind indicator, turn timer, selected weapon, and a power bar while charging.
3. WHEN a turn begins THEN the System SHALL flash a banner naming the team and worm.
4. WHEN all worms of a team are dead THEN the System SHALL show a victory screen naming the
   winning team (or "Draw") and offer restart via R key or click.
5. WHEN the Grenade/Dynamite fuse is live THEN the System SHALL display the remaining fuse
   time.

### REQ-10 — Technical constraints
1. The System SHALL consist of exactly three source files: `index.html`, `style.css`,
   `game.js`.
2. The System SHALL render on a single HTML5 canvas at a fixed 960×540 viewport with a
   1600×640 world.
3. The System SHALL run at a stable frame rate using a fixed-timestep simulation with a
   render loop.
4. The System SHALL have no external runtime dependencies (no libraries, fonts, images, or
   network calls).
5. The System SHALL support a `?demo` URL parameter that starts an autoplaying bot for
   smoke-testing.
