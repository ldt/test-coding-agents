'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorm, updateAim } = require('../game.js');

test('aiming up decreases the local aim angle toward straight up, aiming down increases it', () => {
  const worm = createWorm({ id: 0, team: 0, x: 0, y: 0 });
  worm.facing = 1;
  worm.localAim = 0;
  updateAim(worm, { aimUp: true }, 0.5);
  assert.ok(worm.localAim < 0, 'aiming up should move local aim negative (toward up)');
  worm.localAim = 0;
  updateAim(worm, { aimDown: true }, 0.5);
  assert.ok(worm.localAim > 0, 'aiming down should move local aim positive (toward down)');
});

test('local aim is clamped to a 180 degree arc (-90..+90)', () => {
  const worm = createWorm({ id: 0, team: 0, x: 0, y: 0 });
  worm.facing = 1;
  worm.localAim = 0;
  for (let i = 0; i < 100; i++) updateAim(worm, { aimUp: true }, 1);
  assert.ok(worm.localAim >= -Math.PI / 2 - 1e-6);
  for (let i = 0; i < 100; i++) updateAim(worm, { aimDown: true }, 1);
  assert.ok(worm.localAim <= Math.PI / 2 + 1e-6);
});

test('facing right with local aim 0 points the world aim angle straight along +x', () => {
  const worm = createWorm({ id: 0, team: 0, x: 0, y: 0 });
  worm.facing = 1;
  worm.localAim = 0;
  updateAim(worm, {}, 0);
  assert.ok(Math.abs(Math.cos(worm.aimAngle) - 1) < 1e-6);
  assert.ok(Math.abs(Math.sin(worm.aimAngle)) < 1e-6);
});

test('flipping facing mirrors the world aim angle to the other side while up/down stays consistent', () => {
  const worm = createWorm({ id: 0, team: 0, x: 0, y: 0 });
  worm.facing = 1;
  worm.localAim = -Math.PI / 4; // aiming up-forward
  updateAim(worm, {}, 0);
  const upSignRight = Math.sign(Math.sin(worm.aimAngle)); // should be negative (up)

  worm.facing = -1;
  updateAim(worm, {}, 0);
  const upSignLeft = Math.sign(Math.sin(worm.aimAngle));
  const rightXSign = Math.sign(Math.cos(-Math.PI / 4));
  const leftXSign = Math.sign(Math.cos(worm.aimAngle));

  assert.equal(upSignRight, upSignLeft, 'pointing "up" should stay up regardless of facing');
  assert.notEqual(rightXSign, leftXSign, 'horizontal component should flip sign when facing flips');
});
