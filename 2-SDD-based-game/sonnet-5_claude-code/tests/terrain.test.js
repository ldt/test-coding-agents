'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terrain, WORLD_W, WORLD_H } = require('../game.js');

test('Terrain.generate produces a full-width heightmap with >= 8 standing zones', () => {
  const t = new Terrain(WORLD_W, WORLD_H);
  t.generate(12345);
  assert.equal(t.width, WORLD_W);
  assert.equal(t.height, WORLD_H);
  const zones = t.findStandingZones();
  assert.ok(zones.length >= 8, `expected >=8 standing zones, got ${zones.length}`);
});

test('Terrain.generate is different across seeds (randomized)', () => {
  const a = new Terrain(WORLD_W, WORLD_H);
  a.generate(1);
  const b = new Terrain(WORLD_W, WORLD_H);
  b.generate(2);
  let diff = 0;
  for (let x = 0; x < WORLD_W; x += 17) {
    if (a.heightAt(x) !== b.heightAt(x)) diff++;
  }
  assert.ok(diff > 0, 'two different seeds produced identical terrain');
});

test('Terrain.solidAt is true underground and false above the surface / out of bounds', () => {
  const t = new Terrain(WORLD_W, WORLD_H);
  t.generate(7);
  const groundY = t.heightAt(400);
  assert.equal(t.solidAt(400, groundY + 20), true, 'well below surface should be solid');
  assert.equal(t.solidAt(400, groundY - 50), false, 'well above surface should be air');
  assert.equal(t.solidAt(-10, 100), false, 'left of world is air');
  assert.equal(t.solidAt(WORLD_W + 10, 100), false, 'right of world is air');
  assert.equal(t.solidAt(400, -10), false, 'above top of world is air');
});

test('Terrain.carve removes a circular area and it becomes passable air', () => {
  const t = new Terrain(WORLD_W, WORLD_H);
  t.generate(99);
  const cx = 500;
  const cy = t.heightAt(cx) + 10;
  assert.equal(t.solidAt(cx, cy), true, 'sanity: point starts solid');
  t.carve(cx, cy, 30);
  assert.equal(t.solidAt(cx, cy), false, 'carved center must be air');
  assert.equal(t.solidAt(cx, cy - 25), false, 'within radius must be air');
});

test('Terrain.carve leaves untouched terrain far away still solid', () => {
  const t = new Terrain(WORLD_W, WORLD_H);
  t.generate(99);
  const farX = 1200;
  const farY = t.heightAt(farX) + 10;
  const before = t.solidAt(farX, farY);
  t.carve(200, 200, 20);
  assert.equal(t.solidAt(farX, farY), before, 'carve at a distant point must not affect terrain here');
});

test('Terrain.findStandingZones spacing sample points are >= 80px apart', () => {
  const t = new Terrain(WORLD_W, WORLD_H);
  t.generate(42);
  const points = t.findSpawnPoints(8);
  assert.equal(points.length, 8);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      assert.ok(d >= 80, `spawn points ${i},${j} too close: ${d}`);
    }
  }
});

test('Terrain never spawns below the water line', () => {
  const t = new Terrain(WORLD_W, WORLD_H);
  t.generate(321);
  const points = t.findSpawnPoints(8);
  for (const p of points) {
    assert.ok(p.y < t.waterY, 'spawn point must be above water line');
  }
});
