'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Terrain, createWorm, explode, WORM_RADIUS, WORM_START_HP,
} = require('../game.js');

function makeGame(worms) {
  const terrain = new Terrain();
  terrain.generate(1);
  return {
    terrain,
    teams: [{ worms }],
    particles: [],
    damageNumbers: [],
    camera: { shakeT: 0, shakeMag: 0 },
  };
}

test('explode carves the terrain at the blast center', () => {
  const game = makeGame([]);
  const before = game.terrain.solidAt(500, 500);
  game.terrain.solid[game.terrain.idx(500, 500)] = 1; // force solid for a clean test
  game.terrain.color[game.terrain.idx(500, 500) * 4 + 3] = 255;
  explode(game, 500, 500, 50, 50);
  assert.equal(game.terrain.solidAt(500, 500), false);
});

test('a worm at the blast center takes ~full max damage', () => {
  const worm = createWorm({ id: 0, team: 0, x: 500, y: 500 });
  const game = makeGame([worm]);
  explode(game, 500, 500, 60, 50);
  assert.ok(worm.hp <= WORM_START_HP - 45, `expected near-full damage, hp=${worm.hp}`);
});

test('a worm just outside the blast radius but overlapping still takes the 25% floor', () => {
  // place worm center just past the radius so raw falloff would be ~0,
  // but still within radius + WORM_RADIUS (body-circle overlap).
  const worm = createWorm({ id: 0, team: 0, x: 500 + 55, y: 500 });
  const game = makeGame([worm]);
  explode(game, 500, 500, 50, 40); // radius 50, worm at distance 55 (overlaps: 50+10=60 > 55)
  const dmg = WORM_START_HP - worm.hp;
  assert.ok(dmg >= 40 * 0.25 - 0.01, `expected at least 25% floor damage, got ${dmg}`);
  assert.ok(dmg <= 40 * 0.25 + 5, `floor damage should be close to 25%, got ${dmg}`);
});

test('a worm well outside the blast + body radius takes no damage', () => {
  const worm = createWorm({ id: 0, team: 0, x: 500 + 200, y: 500 });
  const game = makeGame([worm]);
  explode(game, 500, 500, 50, 40);
  assert.equal(worm.hp, WORM_START_HP);
});

test('damage tapers with distance from the blast center', () => {
  const near = createWorm({ id: 0, team: 0, x: 510, y: 500 });
  const far = createWorm({ id: 1, team: 0, x: 545, y: 500 });
  const gameNear = makeGame([near]);
  const gameFar = makeGame([far]);
  explode(gameNear, 500, 500, 50, 50);
  explode(gameFar, 500, 500, 50, 50);
  const dmgNear = WORM_START_HP - near.hp;
  const dmgFar = WORM_START_HP - far.hp;
  assert.ok(dmgNear > dmgFar, `nearer worm should take more damage: near=${dmgNear} far=${dmgFar}`);
});

test('explosion damages worms on every team (friendly fire enabled)', () => {
  const a = createWorm({ id: 0, team: 0, x: 505, y: 500 });
  const b = createWorm({ id: 1, team: 0, x: 495, y: 500 }); // same team as a
  const game = makeGame([a, b]);
  explode(game, 500, 500, 50, 50);
  assert.ok(a.hp < WORM_START_HP, 'own-team worm a should take damage');
  assert.ok(b.hp < WORM_START_HP, 'own-team worm b should take damage');
});

test('explosion applies knockback pushing the worm away from the blast center', () => {
  const worm = createWorm({ id: 0, team: 0, x: 550, y: 500 }); // to the right of blast
  const game = makeGame([worm]);
  explode(game, 500, 500, 60, 50);
  assert.ok(worm.vx > 0, 'worm to the right of the blast should be knocked further right');
  assert.equal(worm.atRest, false, 'knocked-back worm should become airborne');
});

test('HP never goes below 0 from a single explosion', () => {
  const worm = createWorm({ id: 0, team: 0, x: 500, y: 500 });
  worm.hp = 10;
  const game = makeGame([worm]);
  explode(game, 500, 500, 60, 500);
  assert.equal(worm.hp, 0);
});

test('explode records a floating damage number for each damaged worm', () => {
  const worm = createWorm({ id: 0, team: 0, x: 510, y: 500 });
  const game = makeGame([worm]);
  explode(game, 500, 500, 60, 50);
  assert.equal(game.damageNumbers.length, 1);
  assert.ok(game.damageNumbers[0].value > 0);
});
