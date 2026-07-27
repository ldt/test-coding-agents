'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Terrain, createWorm, spawnTeams, createGame, startTurn, endTurn,
  checkWinDraw, advanceRoundRobin, STATE, SUDDEN_DEATH_TURN,
  SUDDEN_DEATH_HP_CAP, SUDDEN_DEATH_WATER_RISE,
} = require('../game.js');

function makeTeam(hps) {
  return {
    name: 'T', color: '#fff', isCpu: false,
    ammo: { cluster: 3, shotgun: 3, dynamite: 2 },
    activeWormCursor: 0,
    worms: hps.map((hp, i) => {
      const w = createWorm({ id: i, team: 0, x: 100 + i * 20, y: 100 });
      w.hp = hp;
      w.alive = hp > 0;
      return w;
    }),
  };
}

test('advanceRoundRobin skips dead worms and cycles back to the first living one', () => {
  const team = makeTeam([100, 0, 100, 0]); // worm 1 and 3 are dead
  team.activeWormCursor = 0;
  const first = advanceRoundRobin(team);
  assert.equal(first.id, 0);
  const second = advanceRoundRobin(team);
  assert.equal(second.id, 2, 'should skip the dead worm at index 1');
  const third = advanceRoundRobin(team);
  assert.equal(third.id, 0, 'should wrap back around, skipping dead worm at index 3');
});

test('advanceRoundRobin returns null when the whole team is dead', () => {
  const team = makeTeam([0, 0, 0, 0]);
  assert.equal(advanceRoundRobin(team), null);
});

test('checkWinDraw: one team wiped out declares the other the winner', () => {
  const teams = [makeTeam([0, 0, 0, 0]), makeTeam([50, 100, 0, 0])];
  const result = checkWinDraw(teams);
  assert.equal(result.over, true);
  assert.equal(result.draw, false);
  assert.equal(result.winner, 1);
});

test('checkWinDraw: both teams wiped out simultaneously is a draw', () => {
  const teams = [makeTeam([0, 0, 0, 0]), makeTeam([0, 0, 0, 0])];
  const result = checkWinDraw(teams);
  assert.equal(result.over, true);
  assert.equal(result.draw, true);
  assert.equal(result.winner, null);
});

test('checkWinDraw: both teams still have living worms means no result yet', () => {
  const teams = [makeTeam([100, 0, 0, 0]), makeTeam([50, 0, 0, 0])];
  const result = checkWinDraw(teams);
  assert.equal(result.over, false);
});

test('createGame builds two 4-worm teams and starts in TURN_START with turnCount 0', () => {
  const game = createGame('cpu', { seed: 7 });
  assert.equal(game.teams.length, 2);
  assert.equal(game.teams[0].worms.length, 4);
  assert.equal(game.turnCount, 0);
  assert.equal(game.suddenDeath, false);
});

test('startTurn activates a worm, sets a fresh 45s timer, and rolls new wind', () => {
  const game = createGame('cpu', { seed: 3 });
  startTurn(game);
  assert.equal(game.state, STATE.AIMING);
  assert.ok(game.activeWorm, 'an active worm should be set');
  assert.equal(game.turnTimer, 45);
  assert.equal(typeof game.wind, 'number');
});

test('endTurn alternates the active team each time', () => {
  const game = createGame('cpu', { seed: 11 });
  startTurn(game);
  const firstTeam = game.activeTeam;
  endTurn(game);
  assert.notEqual(game.activeTeam, firstTeam);
});

test('endTurn increments the turn counter', () => {
  const game = createGame('cpu', { seed: 11 });
  startTurn(game);
  endTurn(game);
  assert.equal(game.turnCount, 1);
});

test('reaching the sudden-death turn threshold caps HP at 30 and starts raising water', () => {
  const game = createGame('cpu', { seed: 9 });
  game.turnCount = SUDDEN_DEATH_TURN - 1; // about to cross the threshold
  const waterYBefore = game.terrain.waterY;
  startTurn(game); // this call's endTurn bumped turnCount to threshold conceptually
  // simulate the turnCount actually reaching the threshold via endTurn:
  game.turnCount = SUDDEN_DEATH_TURN;
  for (const team of game.teams) for (const w of team.worms) w.hp = 100;
  startTurn(game);
  assert.equal(game.suddenDeath, true);
  for (const team of game.teams) {
    for (const w of team.worms) {
      assert.ok(w.hp <= SUDDEN_DEATH_HP_CAP, `worm hp ${w.hp} should be capped at ${SUDDEN_DEATH_HP_CAP}`);
    }
  }
  // y grows downward, so "rising" water means waterY decreases (the
  // surface climbs toward the top of the screen), submerging more terrain.
  assert.equal(game.terrain.waterY, waterYBefore - SUDDEN_DEATH_WATER_RISE);
});

test('a worm below the sudden-death HP cap keeps its current (lower) HP', () => {
  const game = createGame('cpu', { seed: 9 });
  game.turnCount = SUDDEN_DEATH_TURN;
  game.teams[0].worms[0].hp = 10;
  startTurn(game);
  assert.equal(game.teams[0].worms[0].hp, 10);
});

test('game over is detected when a team is wiped out at turn end', () => {
  const game = createGame('cpu', { seed: 5 });
  startTurn(game);
  for (const w of game.teams[1].worms) { w.hp = 0; w.alive = false; }
  endTurn(game);
  assert.equal(game.state, STATE.GAME_OVER);
  assert.equal(game.winner, 0);
});
