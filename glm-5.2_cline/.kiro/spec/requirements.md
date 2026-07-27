# Requirements

## Functional Requirements

### FR1: Game Setup
- The game shall be a 2D turn-based artillery game inspired by Worms.
- The game shall support 2 teams (Red and Blue), each with 4 worms.
- Each worm shall start with 100 health points (HP).
- The game shall generate a random destructible terrain each new game.

### FR2: Terrain
- The terrain shall be a 2D side-view landscape rendered on an HTML5 canvas.
- The terrain shall be destructible — explosions shall remove circular regions from the terrain.
- Worms shall be subject to gravity and rest on the terrain surface.
- Worms that fall off the bottom of the map shall die.

### FR3: Turn System
- Teams shall alternate turns.
- Each turn shall have a 45-second timer; if the timer expires, the turn is forfeited.
- The active worm shall be highlighted and controllable by the current player.
- After a weapon is fired, a 3-second post-turn delay shall occur before the next team's turn begins.

### FR4: Aiming & Firing
- The player shall aim by moving the mouse; the aim angle shall be indicated by a line from the active worm to the cursor.
- The player shall set fire power by holding the left mouse button (power charges from 0 to 100%); releasing fires the weapon.
- A power bar shall be displayed while charging.

### FR5: Weapons
- **Bazooka**: Fires a projectile affected by gravity and wind. Explodes on impact with terrain or a worm. Deals splash damage.
- **Grenade**: Fires a projectile that bounces on terrain. Has a 3-second fuse. Explodes on fuse expiry or on worm impact. Deals splash damage.
- **Shotgun**: Fires an instant-hit spread of pellets in the aim direction. Short range, high damage. No projectile physics.
- **Airstrike**: Targets a horizontal position; after a 2-second delay, 3 bombs fall from the top of the screen at that x-position with slight spread. Each bomb explodes on impact.
- The player shall switch weapons using number keys 1–4 or by clicking weapon buttons in the UI.

### FR6: Wind
- A wind value (direction and magnitude) shall be randomly generated at the start of each turn.
- Wind shall affect bazooka projectiles (horizontal acceleration).
- Wind shall be displayed as an arrow indicator with magnitude text.

### FR7: Damage & Health
- Explosions shall deal damage based on proximity: closer worms take more damage.
- Direct hits shall deal significant damage.
- Worms knocked off the map bottom shall die instantly.
- A worm at 0 HP shall be removed from play with a final explosion.
- Fall damage shall be applied when a worm lands after a significant fall.

### FR8: Win Condition
- The game shall end when all worms on one team are eliminated.
- The surviving team shall be declared the winner.
- A victory screen shall be displayed with an option to restart.

### FR9: UI
- Health bars shall be displayed above each worm, colored by team.
- The current team, active worm name, and turn timer shall be displayed.
- Weapon selection buttons shall be visible and clickable.
- Wind indicator shall be displayed.
- A game-over overlay shall show the winning team and a "Play Again" button.

### FR10: Controls
- Mouse move: aim.
- Mouse hold (left button): charge power.
- Mouse release: fire weapon.
- Keys 1–4: select weapon.
- Key Space or Enter: skip turn.
- Key R: restart game (when game over).

## Non-Functional Requirements

### NFR1: Performance
- The game shall run at 60 FPS on modern browsers.
- Terrain destruction shall use efficient pixel-based collision detection.

### NFR2: Compatibility
- The game shall work in modern browsers (Chrome, Firefox, Safari, Edge).
- No external dependencies or libraries shall be used (vanilla HTML/CSS/JS only).

### NFR3: Responsiveness
- The canvas shall scale to fit the browser window while maintaining aspect ratio.

### NFR4: Code Quality
- The JavaScript shall be organized into clear modules: game state, terrain, physics, weapons, rendering, input, UI.
- Code shall be commented and readable.