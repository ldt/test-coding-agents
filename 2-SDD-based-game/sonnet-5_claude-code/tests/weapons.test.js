'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WEAPONS, Terrain, createWorm, spawnProjectile, stepProjectiles,
  fireShotgun, canSelectWeapon, WORM_RADIUS,
} = require('../game.js');

function makeGame() {
  const terrain = new Terrain();
  terrain.generate(3);
  return {
    terrain,
    teams: [
      { worms: [], ammo: { cluster: 3, shotgun: 3, dynamite: 2 } },
      { worms: [], ammo: { cluster: 3, shotgun: 3, dynamite: 2 } },
    ],
    projectiles: [],
    particles: [],
    damageNumbers: [],
    camera: { shakeT: 0, shakeMag: 0 },
    wind: 0,
    time: 0,
  };
}

test('WEAPONS table defines the 5 required weapons with spec\'d stats', () => {
  assert.equal(WEAPONS.bazooka.maxDmg, 50);
  assert.equal(WEAPONS.bazooka.radius, 55);
  assert.equal(WEAPONS.bazooka.ammo, Infinity);
  assert.equal(WEAPONS.bazooka.charge, true);
  assert.equal(WEAPONS.bazooka.wind, true);

  assert.equal(WEAPONS.grenade.maxDmg, 45);
  assert.equal(WEAPONS.grenade.radius, 50);
  assert.equal(WEAPONS.grenade.ammo, Infinity);
  assert.equal(WEAPONS.grenade.wind, false);

  assert.equal(WEAPONS.cluster.maxDmg, 30);
  assert.equal(WEAPONS.cluster.radius, 40);
  assert.equal(WEAPONS.cluster.ammo, 3);
  assert.equal(WEAPONS.cluster.bomblets, 5);
  assert.equal(WEAPONS.cluster.bombletDmg, 15);
  assert.equal(WEAPONS.cluster.bombletRadius, 25);

  assert.equal(WEAPONS.shotgun.ammo, 3);
  assert.equal(WEAPONS.shotgun.dmgPerShot, 25);
  assert.equal(WEAPONS.shotgun.shots, 2);
  assert.equal(WEAPONS.shotgun.charge, false);

  assert.equal(WEAPONS.dynamite.ammo, 2);
  assert.equal(WEAPONS.dynamite.maxDmg, 75);
  assert.equal(WEAPONS.dynamite.radius, 80);
});

test('wind accelerates a bazooka shell horizontally but not a grenade', () => {
  // Fire both straight up from high altitude so neither touches terrain
  // (and therefore never bounces) during the measurement window - isolates
  // the wind force from bounce friction.
  const game = makeGame();
  game.wind = 100;
  const bazooka = spawnProjectile(game, 'bazooka', { x: 400, y: 50, aimAngle: -Math.PI / 2, facing: 1, id: 0 }, 0.3);
  const grenade = spawnProjectile(game, 'grenade', { x: 400, y: 50, aimAngle: -Math.PI / 2, facing: 1, id: 0 }, 0.3);
  const bazVxBefore = bazooka.vx;
  const grenVxBefore = grenade.vx;
  for (let i = 0; i < 20; i++) stepProjectiles(game, 1 / 60);
  assert.ok(Math.abs(bazooka.vx - bazVxBefore) > 1, 'wind should have changed the bazooka vx noticeably');
  assert.ok(Math.abs(grenade.vx - grenVxBefore) < 0.01, 'wind should not affect the grenade vx');
});

test('a bazooka shell explodes immediately on terrain contact', () => {
  const game = makeGame();
  const groundY = game.terrain.heightAt(400);
  const proj = spawnProjectile(game, 'bazooka', { x: 400, y: groundY - 5, aimAngle: Math.PI / 2, facing: 1, id: 0 }, 1);
  let steps = 0;
  while (game.projectiles.includes(proj) && steps < 300) {
    stepProjectiles(game, 1 / 60);
    steps++;
  }
  assert.ok(!game.projectiles.includes(proj), 'bazooka shell should be removed after impact');
  assert.equal(game.terrain.solidAt(proj.lastX ?? 400, groundY - 5), false);
});

test('a grenade bounces off terrain rather than exploding on impact', () => {
  const game = makeGame();
  const groundY = game.terrain.heightAt(400);
  const proj = spawnProjectile(game, 'grenade', { x: 400, y: groundY - 60, aimAngle: Math.PI / 2, facing: 1, id: 0 }, 0.3);
  let bounced = false;
  for (let i = 0; i < 60; i++) {
    const vyBefore = proj.vy;
    stepProjectiles(game, 1 / 60);
    if (vyBefore > 50 && proj.vy < 0) bounced = true;
  }
  assert.ok(bounced, 'grenade should reflect its vertical velocity off the ground at least once');
  assert.ok(game.projectiles.includes(proj), 'grenade should still be alive shortly after bouncing (3s fuse)');
});

test('a grenade explodes after its 3 second fuse regardless of terrain contact', () => {
  const game = makeGame();
  const proj = spawnProjectile(game, 'grenade', { x: 400, y: 100, aimAngle: 0, facing: 1, id: 0 }, 0.1);
  for (let i = 0; i < 60 * 4; i++) stepProjectiles(game, 1 / 60);
  assert.ok(!game.projectiles.includes(proj), 'grenade must have exploded and been removed by 4 seconds');
});

test('a cluster bomb releases exactly 5 bomblets on fuse expiry', () => {
  const game = makeGame();
  const proj = spawnProjectile(game, 'cluster', { x: 400, y: 300, aimAngle: -Math.PI / 2, facing: 1, id: 0 }, 0.5);
  // Step just past the 3s fuse and stop immediately - stepping further would
  // let the freshly-spawned bomblets fly, land, and self-destruct too.
  let steps = 0;
  while (game.projectiles.includes(proj) && steps < 60 * 4) {
    stepProjectiles(game, 1 / 60);
    steps++;
  }
  const bomblets = game.projectiles.filter((p) => p.kind === 'bomblet');
  assert.equal(bomblets.length, 5);
});

test('a projectile that flies far past the right boundary is discarded without exploding', () => {
  const game = makeGame();
  const proj = spawnProjectile(game, 'bazooka', { x: 1580, y: 50, aimAngle: 0, facing: 1, id: 0 });
  proj.vx = 3000; // guarantee it rockets off the right edge
  proj.vy = 0;
  const carveSpy = game.terrain.carve.bind(game.terrain);
  let carved = false;
  game.terrain.carve = (...args) => { carved = true; return carveSpy(...args); };
  for (let i = 0; i < 30; i++) stepProjectiles(game, 1 / 60);
  assert.ok(!game.projectiles.includes(proj), 'far-OOB projectile should be discarded');
  assert.equal(carved, false, 'OOB discard should not trigger an explosion/carve');
});

test('firing a limited-ammo weapon decrements team stock and depleted weapons cannot be selected', () => {
  const game = makeGame();
  const worm = { x: 400, y: 300, aimAngle: 0, facing: 1, id: 0, team: 0 };
  assert.equal(canSelectWeapon(game.teams[0], 'dynamite'), true);
  spawnProjectile(game, 'dynamite', worm, 1, game.teams[0]);
  assert.equal(game.teams[0].ammo.dynamite, 1);
  spawnProjectile(game, 'dynamite', worm, 1, game.teams[0]);
  assert.equal(game.teams[0].ammo.dynamite, 0);
  assert.equal(canSelectWeapon(game.teams[0], 'dynamite'), false);
});

test('fireShotgun deals 25 damage to the first worm hit along the aim ray', () => {
  const game = makeGame();
  const shooter = createWorm({ id: 0, team: 0, x: 300, y: 300 });
  shooter.aimAngle = 0; // straight along facing
  shooter.facing = 1;
  const target = createWorm({ id: 1, team: 1, x: 400, y: 300 });
  game.teams[0].worms = [shooter];
  game.teams[1].worms = [target];
  fireShotgun(game, shooter);
  assert.equal(target.hp, 100 - 25);
});
