# Requirements Document

## Introduction

This spec defines a browser-based, turn-based artillery game inspired by Worms. Two teams of worms take turns moving across a destructible 2D terrain and firing physics-driven weapons at each other until one team is eliminated. The game must be delivered as exactly three files — `index.html`, `game.js`, `style.css` — with no external dependencies, no build step, and no network requests. It must run by opening `index.html` directly in a modern desktop browser (`file://` included).

Non-negotiable constraints for the implementing agent:

- Exactly 3 deliverable files: one HTML, one JavaScript, one CSS.
- No external libraries, fonts, images, or CDN resources. All graphics are drawn with the Canvas 2D API; all sound is synthesized with the Web Audio API (no audio files).
- Playable hot-seat (two humans sharing one keyboard). A single-player mode against a computer opponent is required as well.
- 60 FPS target on a mid-range laptop; the simulation must not break at lower frame rates (use delta-time or fixed-step physics).
- The full playfield is always visible: there is no scrolling camera. The world is rendered whole and scaled to fit the viewport.

## Requirements

### Requirement 1: Match setup and game states

**User Story:** As a player, I want a clear title screen and match flow, so that I can start, play, finish, and restart a game without reloading the page.

#### Acceptance Criteria

1. WHEN the page loads THEN the system SHALL display a title screen with the game name, a "2 Players" option, a "vs CPU" option, and a visible summary of the controls.
2. WHEN the player selects a mode THEN the system SHALL start a new match with 2 teams of 4 worms each, each worm resting on solid terrain above the water line and at least 80 px from every other worm.
3. WHEN all worms of exactly one team are dead THEN the system SHALL display a victory screen naming the winning team within 2 seconds of the last death resolving.
4. WHEN all remaining worms die in the same explosion or turn THEN the system SHALL declare a draw.
5. WHEN the victory or draw screen is shown THEN the system SHALL offer a "Rematch" action that starts a fresh match with newly generated terrain without reloading the page.
6. IF a match is in progress THEN the system SHALL ignore mode-selection input from the title screen (no state leakage between screens).
7. IF a valid placement for all 8 worms cannot be found within a bounded number of attempts THEN the system SHALL regenerate the terrain and retry, rather than spawn a worm in mid-air, in water, or overlapping another worm.

### Requirement 2: Destructible terrain

**User Story:** As a player, I want a randomly generated landscape that explosions permanently carve away, so that the battlefield evolves tactically over the match.

#### Acceptance Criteria

1. WHEN a match starts THEN the system SHALL generate random rolling terrain (e.g. layered noise or midpoint displacement) spanning the full playfield width, different on every match, and providing at least 8 distinct standing zones above the water line (so spawnability is a property of the terrain, not luck).
2. WHEN an explosion occurs THEN the system SHALL remove a circular area of terrain centered on the blast point, sized to the weapon's blast radius, within the same frame the explosion resolves.
3. WHEN terrain is removed THEN the system SHALL treat the removed area as passable air for all subsequent movement, projectile, and collision queries.
4. WHEN a worm stands on terrain that is destroyed beneath it THEN the worm SHALL fall under gravity until it lands on remaining terrain or reaches water.
5. WHEN terrain is rendered THEN the system SHALL visually distinguish a grass/surface top edge from the dirt body, and carved craters SHALL show a darkened rim.
6. IF the crater rim is visually darkened THEN the darkening SHALL be applied only to terrain pixels that already exist (the rim must be "clipped to remaining terrain"): it SHALL NOT create new solid pixels out of thin air or re-solidify any portion of the carved interior. The carved interior and the air above the surface around the blast point SHALL remain fully passable after the rim is drawn (this guarantees Requirement 2.3 — in particular, subsequent projectiles must be able to fly through a crater and worms must be able to walk into it).
7. IF the bottom of the playfield is reached THEN the system SHALL present water: any worm entering it dies instantly (Requirement 6.5).

### Requirement 3: Turn system

**User Story:** As a player, I want strict alternating turns with a visible timer, so that play is fair and keeps moving.

#### Acceptance Criteria

1. WHEN a match starts THEN the system SHALL give the first turn to a randomly chosen team and alternate teams every turn thereafter.
2. WHEN a team's turn starts THEN the system SHALL activate that team's next living worm in round-robin order and mark it with an unmistakable active-worm indicator (there is no scrolling camera to center — the full playfield is always visible).
3. WHEN a turn starts THEN the system SHALL start a visible countdown timer of 45 seconds; WHEN it reaches zero without a shot fired THEN the system SHALL end the turn, EXCEPT that IF the player is holding a charging shot at expiry THEN the system SHALL fire it at the currently charged power instead of forfeiting the turn.
4. WHEN the active worm fires a power or fuse weapon THEN the system SHALL grant a retreat window in which the worm may move but SHALL NOT fire again; the window lasts 5 seconds from the moment of firing and SHALL end early as soon as all shot effects have resolved AND the active worm is at rest (no idle waiting after the action is over).
5. WHEN the shot's effects fully resolve (all projectiles exploded, all damage applied, all falls settled) AND the retreat window has ended THEN the system SHALL pass the turn to the other team.
6. WHEN it is not a worm's turn THEN the system SHALL ignore all action input for that worm (only the active worm is controllable).
7. WHEN the active worm dies during its own turn (e.g. self-damage or drowning) THEN the system SHALL end the turn immediately after effects resolve.

### Requirement 4: Worm movement and aiming

**User Story:** As a player, I want responsive keyboard control of my worm's walking, jumping, and aiming, so that positioning and precision shots feel skillful.

#### Acceptance Criteria

1. WHEN the left/right arrow keys are held THEN the active worm SHALL walk in that direction, following terrain slopes it can climb, and SHALL face that direction.
2. IF a slope or wall is too steep to climb THEN the worm SHALL stop rather than pass through terrain.
3. WHEN the jump key (Enter or Z) is pressed THEN the active worm SHALL perform a small forward arc jump affected by gravity, fired the moment the key is pressed and independent of any movement key: the worm SHALL jump even if no left/right key is held (the jump must NOT be deferred until the worm starts moving laterally).
4. WHEN a worm walks off an edge or is airborne THEN gravity SHALL apply until it lands; WHEN it falls farther than a safe threshold THEN it SHALL take fall damage proportional to the excess fall distance.
5. WHEN the up/down arrow keys are held THEN the system SHALL rotate the aim angle smoothly through at least 180° in the facing direction, rendering a visible aim indicator (crosshair or arrow).
6. WHEN the facing direction flips THEN the aim angle SHALL mirror to the new facing side.

### Requirement 5: Weapons and firing

**User Story:** As a player, I want a small arsenal of distinct weapons with charged shots and wind, so that each turn offers meaningful tactical choice.

#### Acceptance Criteria

1. WHEN a turn is active THEN the system SHALL let the player select among at least 5 weapons: Bazooka, Grenade, Cluster Bomb, Shotgun, and Dynamite, via number keys and/or an on-screen weapon panel showing the current selection and each weapon's remaining ammunition.
2. WHEN the fire key (Space) is held with a power-based weapon (Bazooka, Grenade, Cluster Bomb) THEN the system SHALL charge a visible power gauge from 0 to 100% over ~1.5 seconds; WHEN released or full THEN the projectile SHALL launch at the aim angle with speed proportional to charge.
3. WHEN a Bazooka shell is in flight THEN wind SHALL accelerate it horizontally; WHEN it touches terrain or a worm THEN it SHALL explode immediately (~50 max damage, medium crater).
4. WHEN a Grenade is thrown THEN it SHALL bounce off terrain with damped rebounds, be unaffected by wind, and explode after a 3-second fuse (~45 max damage).
5. WHEN a Cluster Bomb's fuse expires THEN it SHALL explode (~30 max damage) and release exactly 5 small bomblets that arc outward and each explode on impact (~15 max damage each).
6. WHEN the Shotgun is fired THEN it SHALL instantly trace a ray from the worm along the aim direction, damaging the first worm or terrain hit (2 shots per turn of ~25 damage each, small craters, no wind, no charge-up); the turn timer SHALL keep running between the two shots, and the turn SHALL end after the second shot (or on timer expiry) with no retreat window — hitscan resolution leaves nothing to retreat from.
7. WHEN Dynamite is used THEN it SHALL be placed at the worm's feet with a 3-second fuse and a large blast (~75 max damage, large crater), giving the placer the retreat window to escape.
8. WHEN each turn starts THEN the system SHALL set a random wind value and display its direction and strength in the HUD.
9. WHEN a projectile leaves the playfield's left, right, or top boundary far enough that it can no longer return THEN the system SHALL discard it and proceed to end the turn.
10. WHEN a match starts THEN each team SHALL have per-team ammunition: Bazooka and Grenade unlimited, Cluster Bomb ×3, Shotgun ×3, Dynamite ×2; WHEN a limited weapon is fired THEN its team stock SHALL decrement by one, and a weapon with zero stock SHALL be shown as depleted and refuse selection.

### Requirement 6: Damage, knockback, and death

**User Story:** As a player, I want explosions to deal position-based damage and shove worms around, so that near-misses still matter and terrain hazards are part of the strategy.

#### Acceptance Criteria

1. WHEN a match starts THEN every worm SHALL have 100 HP, displayed above the worm at all times.
2. WHEN an explosion occurs THEN each worm inside the blast radius SHALL take damage scaled by proximity to the blast center (full damage at center, tapering toward 0 at the radius edge), and SHALL take no less than 25% of the weapon's max damage while the blast circle overlaps the worm's body circle.
3. WHEN an explosion damages a worm THEN the worm SHALL receive knockback velocity away from the blast center proportional to the damage, and normal gravity/fall rules SHALL then apply (including fall damage).
4. WHEN a worm's HP reaches 0 THEN, after a short (~0.5 s) delay, the worm SHALL detonate (25 max damage, 40 px blast radius, carving terrain like any explosion), leave a gravestone, and be removed from turn rotation; chain reactions from death detonations SHALL be fully resolved before the turn ends and before win/draw is evaluated.
5. WHEN any worm touches the water at the bottom of the map THEN it SHALL die immediately regardless of remaining HP, with a splash effect.
6. WHEN damage is applied THEN the system SHALL show floating damage numbers over affected worms.
7. Friendly fire SHALL be enabled: a team's own weapons damage its own worms by the same rules.

### Requirement 7: Computer opponent

**User Story:** As a solo player, I want a competent CPU team, so that the game is playable alone.

#### Acceptance Criteria

1. WHEN "vs CPU" mode is active and it is the CPU team's turn THEN the system SHALL take the turn automatically with visible, human-paced actions (brief think pause, aim adjustment, then fire) — never an instant invisible resolution.
2. WHEN the CPU selects a shot THEN it SHALL target a living enemy worm and compute angle/power that accounts for gravity (and wind for wind-affected weapons), with bounded random error so it is beatable but credible — landing shots within damage range on most open-terrain turns.
3. WHEN no reasonable direct shot exists THEN the CPU SHALL still act within the turn timer (e.g. reposition and/or take its best available shot) rather than stalling.
4. WHEN the CPU's shot resolves THEN the standard turn-passing rules (Requirement 3) SHALL apply unchanged.
5. WHILE the CPU is computing its shot THEN the game SHALL stay responsive: no single frame longer than 50 ms — the shot search SHALL be bounded and, if necessary, spread across the frames of the visible think pause.

### Requirement 8: HUD, feedback, and presentation

**User Story:** As a player, I want a readable HUD and juicy feedback, so that game state is always clear and hits feel satisfying.

#### Acceptance Criteria

1. WHEN a match is running THEN the HUD SHALL show: current team, turn timer, wind indicator, selected weapon with remaining ammunition, remaining power gauge while charging, each team's total remaining health or worm count, and a sudden-death indicator once sudden death is active.
2. WHEN an explosion occurs THEN the system SHALL render a visible blast effect (flash/particles) and briefly shake the screen proportionally to blast size.
3. WHEN teams are rendered THEN the two teams SHALL be clearly distinguishable by color, and the active worm SHALL carry an unmistakable marker.
4. WHEN the game is running on any screen THEN there SHALL be no console errors.
5. WHEN the canvas is resized or the browser zoomed THEN the playfield SHALL remain fully visible and playable.
6. WHEN text or UI is displayed THEN it SHALL use only system fonts and CSS — no external assets (per the global constraints).
7. WHEN a shot is fired, an explosion resolves, a worm drowns, or the turn changes THEN the system SHALL play a short synthesized sound effect (Web Audio API, created on first user gesture); audio failure or blocking SHALL disable sound without affecting gameplay.

### Requirement 9: Robustness

**User Story:** As a player, I want the game to never soft-lock, so that a match can always be finished.

#### Acceptance Criteria

1. WHEN any shot is fired THEN the turn SHALL always eventually pass: every projectile SHALL have a hard timeout (≤10 s) after which it is force-resolved.
2. WHEN worms are falling or physics is settling THEN the turn hand-off SHALL wait, but never longer than a hard cap (≤8 s), after which positions are force-settled.
3. WHEN input arrives during state transitions (turn change, death resolution, screen changes) THEN the system SHALL ignore it rather than corrupt state.
4. WHEN the browser tab loses focus and regains it THEN the game SHALL not have advanced timers unfairly or exploded the simulation (clamp delta time).
5. WHEN the page is loaded with a `?demo` URL parameter THEN the system SHALL start a CPU-vs-CPU match automatically (no user input required), suitable for headless smoke testing; a `window.__game` debug handle exposing at least the current state and team health totals SHALL be available in all modes.

### Requirement 10: Sudden death (bounded match length)

**User Story:** As a player, I want stalling to be impossible, so that every match ends in bounded time.

#### Acceptance Criteria

1. WHEN each team has completed 10 turns (20 turns total) THEN sudden death SHALL begin, announced visibly in the HUD.
2. WHEN sudden death begins THEN every living worm's HP SHALL immediately be capped at 30 (worms below 30 keep their current HP).
3. WHEN each turn starts during sudden death THEN the water level SHALL rise by 12 px, permanently submerging terrain below it; standard drowning rules (Requirement 6.5) apply to worms it reaches.
4. WHILE sudden death is active THEN the rising water SHALL guarantee the match terminates: if the water reaches the top of the terrain, the last surviving worm's team wins, or a draw is declared per Requirement 1.4.
