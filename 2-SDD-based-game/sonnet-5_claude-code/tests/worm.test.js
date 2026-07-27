'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Terrain, createWorm, stepWormPhysics, fallDamage, spawnTeams,
  WORM_RADIUS, WORM_START_HP, SAFE_FALL_DIST,
} = require('../game.js');

test('fallDamage is zero within the safe fall distance', () => {
  assert.equal(fallDamage(0), 0);
  assert.equal(fallDamage(SAFE_FALL_DIST), 0);
  assert.equal(fallDamage(SAFE_FALL_DIST - 5), 0);
});

test('fallDamage grows proportionally beyond the safe distance', () => {
  const d1 = fallDamage(SAFE_FALL_DIST + 50);
  const d2 = fallDamage(SAFE_FALL_DIST + 100);
  assert.ok(d1 > 0, 'damage should be positive past the threshold');
  assert.ok(d2 > d1, 'more excess fall distance should deal more damage');
});

test('a worm dropped in mid-air falls under gravity and lands at rest on terrain', () => {
  const t = new Terrain();
  t.generate(5);
  const groundY = t.heightAt(300);
  const worm = createWorm({ id: 0, team: 0, x: 300, y: groundY - 200 });
  assert.equal(worm.atRest, false);
  let steps = 0;
  while (!worm.atRest && steps < 600) {
    stepWormPhysics(worm, t, 1 / 60, { left: false, right: false, jump: false });
    steps++;
  }
  assert.ok(worm.atRest, 'worm should come to rest within a bounded number of steps');
  assert.ok(worm.y <= groundY, 'worm should land on top of the ground, not sink into it');
  assert.ok(worm.y > groundY - WORM_RADIUS - 5, 'worm should rest close to the surface');
});

test('a worm falling farther than the safe distance takes fall damage on landing', () => {
  const t = new Terrain();
  t.generate(5);
  const groundY = t.heightAt(300);
  const worm = createWorm({ id: 0, team: 0, x: 300, y: groundY - 400 });
  let steps = 0;
  while (!worm.atRest && steps < 600) {
    stepWormPhysics(worm, t, 1 / 60, { left: false, right: false, jump: false });
    steps++;
  }
  assert.ok(worm.hp < WORM_START_HP, 'a long fall should have damaged the worm');
});

test('a worm resting on flat ground and given no input does not slide or take damage', () => {
  const t = new Terrain();
  t.generate(5);
  const groundY = t.heightAt(300);
  const worm = createWorm({ id: 0, team: 0, x: 300, y: groundY - WORM_RADIUS - 1 });
  for (let i = 0; i < 30; i++) stepWormPhysics(worm, t, 1 / 60, {});
  assert.equal(worm.hp, WORM_START_HP);
});

test('a worm walking right increases x and faces right', () => {
  const t = new Terrain();
  t.generate(5);
  const groundY = t.heightAt(300);
  const worm = createWorm({ id: 0, team: 0, x: 300, y: groundY - WORM_RADIUS - 1 });
  for (let i = 0; i < 10; i++) stepWormPhysics(worm, t, 1 / 60, { right: true });
  assert.ok(worm.x > 300, 'worm should have moved right');
  assert.equal(worm.facing, 1);
});

test('spawnTeams creates 2 teams of 4 worms each, full HP, spaced >= 80px, above water, on solid ground', () => {
  const t = new Terrain();
  t.generate(2024);
  const teams = spawnTeams(t, ['Red', 'Blue']);
  assert.equal(teams.length, 2);
  const allWorms = [];
  for (const team of teams) {
    assert.equal(team.worms.length, 4);
    for (const w of team.worms) {
      assert.equal(w.hp, WORM_START_HP);
      assert.equal(w.alive, true);
      assert.ok(t.solidAt(w.x, w.y + WORM_RADIUS + 1), 'worm should rest above solid ground');
      assert.ok(w.y < t.waterY, 'worm must spawn above the water line');
      allWorms.push(w);
    }
  }
  for (let i = 0; i < allWorms.length; i++) {
    for (let j = i + 1; j < allWorms.length; j++) {
      const a = allWorms[i], b = allWorms[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(d >= 80, `worms ${i},${j} spawned too close: ${d}`);
    }
  }
});
