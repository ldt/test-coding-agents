'use strict';
// Playwright smoke test (design.md's "Testing Strategy": the ?demo CPU-vs-CPU
// mode is the primary smoke-test vehicle). Not one of the 3 deliverable
// files - kept alongside the other tests for review.
//
// Playwright's Node API ("playwright") is only installed globally in this
// environment (no local node_modules/package.json for this game folder, by
// design - the deliverable itself must stay dependency-free). Resolve it
// via the global npm root if a plain require() can't find it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  const { execSync } = require('node:child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(path.join(globalRoot, 'playwright'));
}

const { chromium } = loadPlaywright();
const indexPath = path.join(__dirname, '..', 'index.html');
const indexUrl = `file://${indexPath}?demo`;

test('headless ?demo run: no console errors, turns advance, HP totals change, window.__game is exposed', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    const externalRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('file://')) externalRequests.push(url);
    });

    await page.goto(indexUrl);
    await page.waitForFunction(() => window.__game != null, { timeout: 10000 });

    const initial = await page.evaluate(() => ({
      state: window.__game.state,
      turnCount: window.__game.turnCount,
      totalHp: window.__game.teams.reduce((s, t) => s + t.worms.reduce((s2, w) => s2 + w.hp, 0), 0),
    }));

    // Let the CPU-vs-CPU demo play out several turns.
    await page.waitForFunction(
      (startTurnCount) => window.__game.turnCount > startTurnCount + 1,
      initial.turnCount,
      { timeout: 30000 },
    );
    await page.waitForTimeout(3000); // a bit more time for combat/HP changes to land

    const later = await page.evaluate(() => ({
      state: window.__game.state,
      turnCount: window.__game.turnCount,
      totalHp: window.__game.teams.reduce((s, t) => s + t.worms.reduce((s2, w) => s2 + w.hp, 0), 0),
      teamsLen: window.__game.teams.length,
      wormsPerTeam: window.__game.teams.map((t) => t.worms.length),
    }));

    assert.equal(externalRequests.length, 0, `expected zero network requests, got: ${externalRequests.join(', ')}`);
    assert.deepEqual(consoleErrors, [], 'expected no console errors during the demo run');
    assert.ok(later.turnCount > initial.turnCount, 'turn count should have advanced');
    assert.ok(later.totalHp < initial.totalHp, 'combat should have reduced total HP across teams');
    assert.equal(later.teamsLen, 2);
    assert.deepEqual(later.wormsPerTeam, [4, 4]);
  } finally {
    await browser.close();
  }
});

test('the title screen loads cleanly with no console errors and no network requests (non-demo path)', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    const externalRequests = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('file://')) externalRequests.push(url);
    });

    await page.goto(`file://${indexPath}`);
    await page.waitForSelector('#title-screen:not(.hidden)');
    const title = await page.textContent('#title-screen h1');
    assert.equal(title.trim(), 'WORMS DUEL');

    assert.equal(externalRequests.length, 0);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
});
