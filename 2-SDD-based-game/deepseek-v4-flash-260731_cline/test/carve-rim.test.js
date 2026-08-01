// TDD regression test for the crater rim bug (Req 2.3, 2.5, design.md
// "clipped to remaining terrain").
//
// Red (bug): before the fix, carve() painted the dark rim ring over the
// blast point with "source-over". The blast point sits at the terrain
// surface, so the upper arc of the rim annulus passed through *air*: those
// pixels were written with alpha ~140 > 127, turning them into solid
// terrain. The result was an invisible floating "lip" at the crater edge
// that blocked worms from dropping into the crater and made skimming
// projectiles explode early.
//
// Green (fix): the rim is painted with "source-atop", so it can only
// darken pixels that already have terrain alpha; it can never turn an air
// pixel into a solid one ("clipped to remaining terrain").
//
// Strategy: build a fresh, isolated Terrain via the game's own class
// (window.__game.terrain.constructor) so the live CPU demo cannot move
// worms into the blast site mid-test. Snapshot the alpha of every pixel in
// the rim band BEFORE carving, then assert no pixel that was air (alpha 0)
// became solid (alpha > 127) after carving. Also verifies the crater
// interior stays open air and that crater floor + adjacent ground remain
// walkable.
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const assert = require('assert');

const GAME_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const WORM_R = 14;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(GAME_URL + '?demo', { timeout: 15000 });

    // wait until the game is booted and exposes its Terrain class
    await page.waitForFunction(() => {
      const g = window.__game;
      return g && g.terrain && g.terrain.constructor && typeof g.terrain.generate === 'function';
    }, null, { timeout: 15000 });

    const result = await page.evaluate(() => {
      const g = window.__game;
      const W = 1600, H = 900;

      // Fresh, isolated terrain built with the game's own Terrain class —
      // no live worms nearby, deterministic.
      const t = new g.terrain.constructor();
      t.generate(12345);

      const R = 40; // blast radius

      // pick a blast site: needs a full crater below, far above water, and
      // room on both sides (for the left/right walkable-ground checks).
      const MARGIN = R + 60;
      let sx = -1, sy = -1;
      for (let x = MARGIN; x < W - MARGIN; x += 3) {
        const y = t.surfaceHeight(x);
        if (y >= t.waterY - R - 20 || y + R >= H - 4) continue;
        sx = x; sy = y; break;
      }
      if (sx < 0) return { ok: false, reason: 'no suitable blast site in generated terrain' };

      // Snapshot the full 360° rim annulus (R-6..R+5) around the blast
      // point — both above and below the surface. Any pixel that was air
      // (alpha 0) before carving must stay air: a leak appears wherever the
      // rim paint re-solidifies carved-away pixels inside the crater cavity
      // (below the surface) or into the sky (above the surface).
      const bandPixels = [];
      for (let dx = -(R + 6); dx <= R + 6; dx++) {
        for (let dy = -(R + 6); dy <= R + 6; dy++) {
          const d = Math.hypot(dx, dy);
          if (d >= R - 6 && d <= R + 5) {
            bandPixels.push({ px: sx + dx, py: sy + dy });
          }
        }
      }
      const beforeAlpha = new Map();
      for (const { px, py } of bandPixels) {
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        beforeAlpha.set(px * 2000 + py, t.alpha[py * W + px]);
      }

      // --- reproduce the bug: blast at the surface of the terrain ---
      t.carve(sx, sy, R);

      // A) No air pixel in the rim band may become solid (the leak).
      const newSolids = [];
      for (const { px, py } of bandPixels) {
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const before = beforeAlpha.get(px * 2000 + py);
        if (before === 0 && t.solidAt(px, py)) {
          newSolids.push({ px, py, afterAlpha: t.alpha[py * W + px] });
        }
      }

      // B) The crater interior is open air down to the floor at the blast
      //    column and +/-8px.
      const midFloor = t.surfaceHeight(sx);
      const columnsBlocked = [];
      for (const cx of [sx - 8, sx, sx + 8]) {
        const floor = t.surfaceHeight(cx);
        for (let y = sy - 2; y < floor; y += 2) {
          if (t.solidAt(cx, y)) columnsBlocked.push({ x: cx, y });
        }
      }

      // C) A worm (real game placement: center = floor - WORM_R - 1) can
      //    stand on the crater floor.
      const centerWy = midFloor - WORM_R - 1;
      let centerBlocked = false;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        if (t.solidAt(Math.round(sx + Math.cos(a) * WORM_R), Math.round(centerWy + Math.sin(a) * WORM_R))) {
          centerBlocked = true;
          break;
        }
      }

      // D) Intact ground beside the crater is still walkable: scan outward
      //    for a clean worm footprint within R+30 on both sides. (This checks
      //    the ground collider only — drowning is a separate game rule.)
      let leftStand = null, rightStand = null;
      for (let dx = R + 4; dx <= R + 34; dx++) {
        if (!leftStand) {
          const gx = sx - dx, gy = t.surfaceHeight(gx);
          const wy = gy - WORM_R - 1;
          let blocked = false;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            if (t.solidAt(Math.round(gx + Math.cos(a) * WORM_R), Math.round(wy + Math.sin(a) * WORM_R))) {
              blocked = true; break;
            }
          }
          if (!blocked) leftStand = { x: gx, y: wy };
        }
        if (!rightStand) {
          const gx = sx + dx, gy = t.surfaceHeight(gx);
          const wy = gy - WORM_R - 1;
          let blocked = false;
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            if (t.solidAt(Math.round(gx + Math.cos(a) * WORM_R), Math.round(wy + Math.sin(a) * WORM_R))) {
              blocked = true; break;
            }
          }
          if (!blocked) rightStand = { x: gx, y: wy };
        }
      }

      return {
        ok: true,
        sx, sy, midFloor,
        newSolids,
        newSolidsCount: newSolids.length,
        columnsBlocked,
        centerBlocked, centerWy,
        leftStand, rightStand,
      };
    });

    assert(result.ok !== false, result.reason || 'setup failure');

    // --- green criteria ----------------------------------------------------
    // A) carving must never turn an air pixel into a solid pixel
    assert(
      result.newSolidsCount === 0,
      'rim ring leaks solid pixels into the air (' + result.newSolidsCount +
      ' pixels, e.g. ' + JSON.stringify(result.newSolids.slice(0, 6)) + ')'
    );
    // B) crater interior stays open air (Req 2.3)
    assert(
      result.columnsBlocked.length === 0,
      'crater interior is not open air: ' + JSON.stringify(result.columnsBlocked)
    );
    // C) a worm can stand on the crater floor (same placement as landWorm/createWorm)
    assert(
      !result.centerBlocked,
      'worm cannot stand on the crater floor at (x=' + result.sx + ', y=' + result.centerWy + ')'
    );
    // D) intact ground beside the crater remains walkable on both sides
    assert(result.leftStand, 'no walkable ground found left of the crater');
    assert(result.rightStand, 'no walkable ground found right of the crater');
    // sanity: carve dug a real crater (R = 40, so the floor must be >= 32px
    // below the original surface)
    assert(
      result.midFloor - result.sy >= 32,
      'carve did not dig a crater (floor=' + result.midFloor + ' surface=' + result.sy + ')'
    );

    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
    console.log('PASS carve-rim: no air->solid leak, crater open, floor & surroundings walkable');
    await page.close();
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('ALL TESTS PASSED');
})();