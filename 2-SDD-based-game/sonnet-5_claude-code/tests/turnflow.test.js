'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, startTurn, stepGame, STATE } = require('../game.js');

const DT = 1 / 60;

function runUntil(game, predicate, maxSteps, input = {}) {
  let steps = 0;
  while (!predicate(game) && steps < maxSteps) {
    stepGame(game, DT, input);
    steps++;
  }
  return steps;
}

test('the turn timer expiring with no shot fired still ends the turn', () => {
  const game = createGame('pvp', { seed: 1, firstTeam: 0 });
  startTurn(game);
  game.turnTimer = 0.02; // about to expire
  const firstTeam = game.activeTeam;
  const turnCountBefore = game.turnCount;
  const steps = runUntil(
    game,
    (g) => g.turnCount > turnCountBefore,
    60 * 12, // generous bound: timer + settle cap
    {},
  );
  assert.ok(steps < 60 * 12, 'turn should have passed within the bounded step budget');
  assert.notEqual(game.activeTeam, firstTeam, 'active team should have alternated');
});

test('timer expiry while charging fires the shot at current power instead of forfeiting', () => {
  const game = createGame('pvp', { seed: 2, firstTeam: 0 });
  startTurn(game);
  game.selectedWeapon = 'bazooka';
  // Hold fire to enter CHARGING.
  stepGame(game, DT, { fireHeld: true, fire: true });
  assert.equal(game.state, STATE.CHARGING);
  // Charge partway, then force the timer to expire while still holding fire.
  for (let i = 0; i < 10; i++) stepGame(game, DT, { fireHeld: true });
  assert.ok(game.chargePower > 0, 'some charge should have accumulated');
  game.turnTimer = 0.001;
  stepGame(game, DT, { fireHeld: true });
  assert.equal(game.state, STATE.PROJECTILE, 'expiry mid-charge should fire, not forfeit');
  assert.equal(game.projectiles.length, 1);
});

test('an OOB bazooka shot still ends the turn (discard, not stuck)', () => {
  const game = createGame('pvp', { seed: 3, firstTeam: 0 });
  startTurn(game);
  const worm = game.activeWorm;
  worm.x = game.terrain.width - 5;
  worm.aimAngle = 0; // straight out toward the right edge
  game.selectedWeapon = 'bazooka';
  game.wind = 0;
  stepGame(game, DT, { fireHeld: true, fire: true }); // enters CHARGING
  stepGame(game, DT, { fireHeld: false }); // release immediately -> low power shot, still fires
  const turnCountBefore = game.turnCount;
  const steps = runUntil(game, (g) => g.turnCount > turnCountBefore, 60 * 15, {});
  assert.ok(steps < 60 * 15, 'turn should still pass after an OOB shot');
});

test('shotgun fires two shots with the timer running between them and no retreat window', () => {
  const game = createGame('pvp', { seed: 4, firstTeam: 0 });
  startTurn(game);
  game.selectedWeapon = 'shotgun';
  const worm = game.activeWorm;
  worm.aimAngle = -Math.PI / 2; // straight up, away from any worm, so both shots just hit terrain/sky
  stepGame(game, DT, { fire: true }); // first shot
  assert.equal(game.state, STATE.PROJECTILE);
  assert.equal(game.shotsLeft, 1);
  assert.equal(game.retreatTimer, 0, 'shotgun turns never get a retreat window');
  stepGame(game, DT, { fire: true }); // second shot
  assert.equal(game.shotsLeft, 0);
  const turnCountBefore = game.turnCount;
  const steps = runUntil(game, (g) => g.turnCount > turnCountBefore, 60 * 10, {});
  assert.ok(steps < 60 * 10, 'turn should end promptly after the second shotgun shot');
});

test('the active worm dying during its own turn ends the turn immediately after effects resolve', () => {
  const game = createGame('pvp', { seed: 5, firstTeam: 0 });
  startTurn(game);
  const worm = game.activeWorm;
  worm.hp = 0; // simulate self-inflicted lethal damage
  const turnCountBefore = game.turnCount;
  const gravesBefore = game.graves.length;
  const steps = runUntil(game, (g) => g.turnCount > turnCountBefore, 60 * 8, {});
  assert.ok(steps < 60 * 8, 'turn should end after the self-kill resolves');
  assert.ok(game.graves.length > gravesBefore, 'the dead worm should have detonated and left a gravestone');
  assert.equal(worm.alive, false);
});

test('firing a full-charge bazooka eventually settles and passes the turn (happy path)', () => {
  const game = createGame('pvp', { seed: 6, firstTeam: 0 });
  startTurn(game);
  const worm = game.activeWorm;
  worm.aimAngle = -Math.PI / 3; // up and forward
  game.selectedWeapon = 'bazooka';
  game.wind = 0;
  stepGame(game, DT, { fireHeld: true, fire: true });
  for (let i = 0; i < 96; i++) stepGame(game, DT, { fireHeld: true }); // ~1.6s of charge
  stepGame(game, DT, { fireHeld: false });
  assert.equal(game.state, STATE.PROJECTILE);
  const turnCountBefore = game.turnCount;
  const steps = runUntil(game, (g) => g.turnCount > turnCountBefore, 60 * 20, {});
  assert.ok(steps < 60 * 20, 'a normal full shot should resolve and pass the turn well within the hard caps');
});
