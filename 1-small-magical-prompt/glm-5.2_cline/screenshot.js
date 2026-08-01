const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const url = 'file://' + __dirname + '/index.html';
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: __dirname + '/screenshot.png', fullPage: false });
  console.log('Screenshot saved to: ' + __dirname + '/screenshot.png');
  await browser.close();
})();
