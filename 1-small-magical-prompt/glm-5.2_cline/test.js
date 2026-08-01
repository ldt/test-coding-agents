const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));

  const url = 'file://' + __dirname + '/index.html';
  await page.goto(url, { waitUntil: 'load' });

  // Wait a bit for the game loop to run
  await page.waitForTimeout(2000);

  // Check canvas exists and has content
  const canvasInfo = await page.evaluate(() => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const imgData = ctx.getImageData(0, 0, c.width, c.height);
    // Count non-background pixels (terrain/worms drawn)
    let nonBg = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
      // Background sky top is #1a2a4a (26,42,74). Count pixels that differ significantly
      if (Math.abs(r - 26) > 30 || Math.abs(g - 42) > 30 || Math.abs(b - 74) > 30) {
        nonBg++;
      }
    }
    return { width: c.width, height: c.height, nonBgPixels: nonBg };
  });

  // Check HUD elements
  const hud = await page.evaluate(() => ({
    teamName: document.getElementById('team-name').textContent,
    wormName: document.getElementById('worm-name').textContent,
    timer: document.getElementById('timer').textContent,
    windMag: document.getElementById('wind-mag').textContent,
    weaponBtns: document.querySelectorAll('.weapon-btn').length,
    gameoverHidden: document.getElementById('gameover').classList.contains('hidden'),
  }));

  // Test weapon selection
  await page.click('.weapon-btn[data-weapon="1"]');
  await page.waitForTimeout(100);
  const grenadeSelected = await page.evaluate(() =>
    document.querySelector('.weapon-btn[data-weapon="1"]').classList.contains('selected')
  );

  // Test keyboard weapon select
  await page.keyboard.press('3');
  await page.waitForTimeout(100);
  const shotgunSelected = await page.evaluate(() =>
    document.querySelector('.weapon-btn[data-weapon="2"]').classList.contains('selected')
  );

  // Test firing a bazooka: select weapon 1, move mouse, hold, release
  await page.keyboard.press('1');
  const canvasBox = await page.locator('#game').boundingBox();
  // Aim up-right from center
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.3);
  await page.mouse.down();
  await page.waitForTimeout(800); // charge power
  await page.mouse.up();
  await page.waitForTimeout(3000); // wait for projectile + post-turn

  const afterFire = await page.evaluate(() => ({
    phase: window.Game ? window.Game.phase : 'no-game-global',
    teamName: document.getElementById('team-name').textContent,
    errors: [],
  }));

  console.log('=== TEST RESULTS ===');
  console.log('Canvas:', canvasInfo.width + 'x' + canvasInfo.height, 'non-bg pixels:', canvasInfo.nonBgPixels);
  console.log('HUD:', JSON.stringify(hud));
  console.log('Grenade selected after click:', grenadeSelected);
  console.log('Shotgun selected after key 3:', shotgunSelected);
  console.log('After fire:', JSON.stringify(afterFire));
  console.log('Errors:', errors.length ? errors : 'NONE');

  await browser.close();

  const pass = errors.length === 0 &&
    canvasInfo.nonBgPixels > 1000 &&
    hud.weaponBtns === 4 &&
    hud.gameoverHidden &&
    grenadeSelected && shotgunSelected;

  console.log(pass ? '\n✅ ALL TESTS PASSED' : '\n❌ TESTS FAILED');
  process.exit(pass ? 0 : 1);
})();