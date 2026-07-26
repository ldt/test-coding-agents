# Requirements — HTML Worms

**Feature:** A browser-playable, hot-seat artillery game in the spirit of Team17's *Worms*.

**Stack constraint:** exactly three files — `index.html`, `game.js`, `style.css`. No build step, no
external assets, no network requests. Opening `index.html` from the filesystem must work.

**Target user:** two people sharing one keyboard (hot-seat), or one person experimenting solo.

---

## Requirement 1 — Match setup

**User Story:** As a player, I want to start a match between two teams of worms on a freshly
generated battlefield, so that every game feels different.

**Acceptance Criteria:**

1. WHEN the page loads THEN the system SHALL display a title screen with the controls and a start
   control, and SHALL NOT begin simulating the match.
2. WHEN the player activates the start control THEN the system SHALL generate a new random terrain
   and place 4 worms per team, 2 teams.
3. WHEN worms are placed THEN the system SHALL guarantee each worm rests on solid ground, above the
   water line, and at least 90 world-pixels from any other worm.
4. IF a valid placement cannot be found for every worm after a bounded number of attempts THEN the
   system SHALL regenerate the terrain and retry, rather than spawning a worm in mid-air or in water.
5. WHEN the match starts THEN the system SHALL give every worm 100 health points.

## Requirement 2 — Destructible terrain

**User Story:** As a player, I want the ground to be blown apart by explosions, so that the
battlefield changes as the match progresses.

**Acceptance Criteria:**

1. WHEN the terrain is generated THEN the system SHALL produce a solid/empty bitmask covering the
   whole world, rendered as grass-topped soil with visible depth shading.
2. WHEN an explosion occurs at (x, y) with radius r THEN the system SHALL clear every terrain pixel
   within r of (x, y) from both the collision mask and the rendered image.
3. WHEN terrain is destroyed THEN the system SHALL draw a scorched rim around the resulting crater.
4. WHEN terrain under a resting worm is destroyed THEN the system SHALL make that worm fall.
5. WHILE the match runs THE system SHALL keep terrain collision queries at O(1) per sample.

## Requirement 3 — Turn structure

**User Story:** As a player, I want strict alternating turns with a clock, so that the match is fair
and paced.

**Acceptance Criteria:**

1. WHEN a turn begins THEN the system SHALL select the next living worm of the team that did not
   play last, in round-robin order within that team.
2. WHEN a turn begins THEN the system SHALL reset the turn clock to 45 seconds and randomise wind.
3. WHILE the state is AIM THE system SHALL count the turn clock down in real time.
4. WHEN the turn clock reaches zero AND the player is charging a shot THEN the system SHALL fire the
   shot at the currently charged power.
5. WHEN the turn clock reaches zero AND the player is not charging THEN the system SHALL end the turn.
6. WHEN a weapon has been fired AND all projectiles, explosions and worm motion have settled THEN
   the system SHALL grant a 5-second retreat window during which the active worm may move but not fire.
7. WHEN the retreat window expires THEN the system SHALL end the turn.
8. WHILE the state is not AIM or RETREAT THE system SHALL ignore movement and weapon input.

## Requirement 4 — Worm movement

**User Story:** As a player, I want to walk and jump my worm across uneven ground, so that I can
reach cover and firing positions.

**Acceptance Criteria:**

1. WHEN the player holds left or right THEN the system SHALL move the active worm horizontally and
   set its facing direction.
2. WHEN walking into a slope no steeper than 5 pixels per step THEN the system SHALL climb it.
3. WHEN walking into a slope steeper than that THEN the system SHALL block the movement.
4. WHEN the player presses jump AND the worm is on the ground THEN the system SHALL launch the worm
   forward in an arc.
5. WHEN a worm lands after falling more than 70 pixels THEN the system SHALL apply fall damage
   proportional to the excess distance, capped at 35 points.
6. WHEN a worm's centre passes below the water line THEN the system SHALL drown it, removing it from
   play regardless of remaining health.

## Requirement 5 — Aiming and firing

**User Story:** As a player, I want to control angle and power precisely, so that skill decides the
outcome.

**Acceptance Criteria:**

1. WHILE the state is AIM THE system SHALL display a crosshair showing the current aim angle.
2. WHEN the player presses up or down THEN the system SHALL rotate the aim angle within ±85°.
3. WHEN the player moves the mouse over the battlefield THEN the system SHALL aim at the cursor and
   update facing accordingly.
4. WHEN the player holds fire THEN the system SHALL charge power from 0 to 100% over 1.2 seconds and
   display a power gauge.
5. WHEN the player releases fire THEN the system SHALL launch the selected weapon with an initial
   speed proportional to the charged power.
6. IF power reaches 100% while still held THEN the system SHALL fire automatically.

## Requirement 6 — Weapons

**User Story:** As a player, I want a varied arsenal, so that I can pick the right tool for each
situation.

**Acceptance Criteria:**

1. WHEN the match starts THEN the system SHALL offer: Bazooka (unlimited), Grenade (unlimited),
   Cluster Bomb (3), Shotgun (3), Dynamite (2) and Airstrike (1), the counts being per team.
2. WHEN the player presses a weapon key (1-6) or clicks a weapon slot THEN the system SHALL select
   that weapon.
3. IF the selected weapon has zero ammunition remaining for the active team THEN the system SHALL
   refuse the selection and keep the previous weapon.
4. WHEN a limited-ammunition weapon is fired THEN the system SHALL decrement that team's stock by one.
5. WHEN the Bazooka or Cluster Bomb is in flight THEN the system SHALL apply wind acceleration to it;
   Grenade, Dynamite and Airstrike bombs SHALL be unaffected by wind.
6. WHEN a Grenade or Cluster Bomb hits terrain THEN the system SHALL bounce it and continue its fuse.
7. WHEN a Cluster Bomb's fuse expires THEN the system SHALL explode it and scatter 5 secondary
   bomblets that each explode on impact.
8. WHEN the Shotgun is fired THEN the system SHALL resolve it instantly as a ray, grant the player a
   second shot, and only then end the turn.
9. WHEN Dynamite is selected and fired THEN the system SHALL drop it at the worm's feet with a
   5-second fuse.
10. WHEN Airstrike is selected THEN the system SHALL enter a targeting mode; WHEN the player clicks a
    point THEN the system SHALL drop 5 bombs from off-screen along that point.

## Requirement 7 — Damage and death

**User Story:** As a player, I want explosions to hurt and shove worms realistically, so that
positioning matters.

**Acceptance Criteria:**

1. WHEN an explosion occurs THEN the system SHALL damage every living worm within its radius, scaled
   linearly from full damage at the centre to zero at the rim.
2. WHEN an explosion damages a worm THEN the system SHALL apply knockback directed away from the
   blast centre, with magnitude scaled by proximity.
3. WHEN a worm takes damage THEN the system SHALL display the amount as a floating number.
4. WHEN a worm's health reaches zero THEN the system SHALL, after a short delay, detonate it for 25
   damage in a 45-pixel radius and remove it from play.
5. WHEN a worm dies from another worm's death explosion THEN the system SHALL resolve the chain
   reaction before ending the turn.
6. WHEN friendly fire occurs THEN the system SHALL apply it identically to enemy fire.

## Requirement 8 — Presentation and feedback

**User Story:** As a player, I want to see clearly whose turn it is, what I'm holding, and what the
wind is doing, so that I can plan.

**Acceptance Criteria:**

1. WHILE a match is running THE system SHALL display, for each team, its name, colour, per-worm
   health and aggregate health bar.
2. WHILE a match is running THE system SHALL display the turn clock, the active worm's name, the
   current wind strength and direction, and the weapon dock with remaining ammunition.
3. WHEN the active worm changes THEN the system SHALL announce the new turn with a transient banner.
4. WHEN an explosion occurs THEN the system SHALL shake the camera, emit debris and smoke particles,
   and play a synthesised sound effect.
5. WHILE a projectile is airborne THE system SHALL keep the camera centred on it; otherwise the
   camera SHALL follow the active worm, clamped to the world bounds.
6. WHEN the browser window is resized THEN the system SHALL resize the canvas to match, without
   distorting the world.

## Requirement 9 — Victory

**User Story:** As a player, I want the match to end and declare a winner, so that there is a point
to playing.

**Acceptance Criteria:**

1. WHEN one team has no living worms AND the other does THEN the system SHALL end the match and
   declare the other team the winner.
2. WHEN both teams lose their last worm in the same resolution THEN the system SHALL declare a draw.
3. WHEN the match ends THEN the system SHALL show a result overlay offering a rematch.
4. WHEN the player requests a rematch THEN the system SHALL regenerate terrain and teams and start a
   fresh match without a page reload.

## Requirement 10 — Robustness

**User Story:** As a player, I want the game not to break, so that a match can be finished.

**Acceptance Criteria:**

1. WHEN a projectile leaves the world horizontally or above the ceiling THEN the system SHALL keep
   simulating it while it may still return, and discard it once it can no longer do so.
2. WHEN a projectile enters the water THEN the system SHALL remove it with a splash and no explosion.
3. IF the simulation is stalled by a projectile that never settles THEN the system SHALL force it to
   detonate after 12 seconds of flight.
4. IF a worm is knocked into a position with no support THEN the system SHALL resume gravity for it,
   including after the turn has otherwise resolved.
5. WHEN the tab loses focus THEN the system SHALL clamp the simulation step so the world does not
   jump on return.
