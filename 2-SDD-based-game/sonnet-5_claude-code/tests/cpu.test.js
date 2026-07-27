'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame, startTurn, stepGame, STATE, WORM_START_HP,
} = require('../game.js');

const DT = 1 / 60;

function runUntil(game, predicate, maxSteps) {
  let steps = 0;
  while (!predicate(game) && steps < maxSteps) {
    stepGame(game, DT, {});
    steps++;
  }
  return steps;
}

test('a CPU turn always eventually fires and passes the turn within bounded steps', () => {
  const game = createGame('cpu', { seed: 21, firstTeam: 1 }); // team 1 is CPU
  startTurn(game);
  assert.equal(game.teams[game.activeTeam].isCpu, true);
  const turnCountBefore = game.turnCount;
  // Generous bound: 0.8s think + aim sweep + charge + full projectile/settle cycle.
  const steps = runUntil(game, (g) => g.turnCount > turnCountBefore, 60 * 20);
  assert.ok(steps < 60 * 20, `CPU turn did not pass within the bounded step budget (took ${steps})`);
});

test('the CPU never runs more than a small bounded number of shot simulations per frame', () => {
  const game = createGame('cpu', { seed: 22, firstTeam: 1 });
  startTurn(game);
  let maxJump = 0;
  let prevIx = 0;
  for (let i = 0; i < 60; i++) {
    stepGame(game, DT, {});
    if (game.cpuCandidateIx != null) {
      maxJump = Math.max(maxJump, game.cpuCandidateIx - prevIx);
      prevIx = game.cpuCandidateIx;
    }
    if (game.state !== STATE.AIMING && game.state !== STATE.CHARGING) break;
  }
  assert.ok(maxJump <= 8, `CPU processed more than 8 shot sims in a single frame (${maxJump})`);
});

test('the CPU aims generally toward the living enemy worm before firing', () => {
  const game = createGame('cpu', { seed: 23, firstTeam: 1 });
  startTurn(game);
  const worm = game.activeWorm;
  const enemy = game.teams[1 - game.activeTeam].worms.find((w) => w.alive);
  const towardSign = Math.sign(enemy.x - worm.x) || 1;
  // Run through THINK + most of AIM.
  runUntil(game, (g) => g.cpuPhase === 'ACT' || g.state !== STATE.AIMING, 60 * 3);
  assert.equal(Math.sign(Math.cos(worm.aimAngle)) || 1, towardSign, 'aim should generally face the enemy horizontally');
});

test('over several CPU turns on the same open match, at least 6/10 shots deal damage to the enemy team (design.md CPU acceptance bar)', () => {
  let successfulTurns = 0;
  const totalTrials = 10;
  for (let trial = 0; trial < totalTrials; trial++) {
    const game = createGame('demo', { seed: 100 + trial, firstTeam: 0 });
    // Force team 1 (defender) to stay put and just measure whether team 0 (CPU attacker) damages it.
    game.teams[1].isCpu = false;
    startTurn(game);
    if (!game.teams[game.activeTeam].isCpu) continue; // ensure attacker's turn
    const totalHpBefore = game.teams[1].worms.reduce((s, w) => s + w.hp, 0);
    const turnCountBefore = game.turnCount;
    runUntil(game, (g) => g.turnCount > turnCountBefore, 60 * 25);
    const totalHpAfter = game.teams[1].worms.reduce((s, w) => s + w.hp, 0);
    if (totalHpAfter < totalHpBefore) successfulTurns++;
  }
  assert.ok(successfulTurns >= totalTrials * 0.6, `expected >=6/10 CPU turns to land damage, got ${successfulTurns}/${totalTrials}`);
});
