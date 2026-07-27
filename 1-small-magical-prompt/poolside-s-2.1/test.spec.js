const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Worms HTML Game', () => {
    test.beforeEach(async ({ page }) => {
        const filePath = path.resolve(__dirname, '../poolside-s-2.1/index.html');
        await page.goto('file://' + filePath);
        // Wait for game to initialize
        await page.waitForFunction(() => window.game !== undefined, { timeout: 5000 });
    });

    test('page loads and game initializes', async ({ page }) => {
        const game = await page.evaluate(() => window.game);
        expect(game).toBeDefined();
        expect(game.worms.length).toBe(8); // 4 red + 4 blue
        expect(game.terrain).toBeDefined();
        expect(game.gameState).toBe('aiming');
    });

    test('terrain is generated with solid pixels', async ({ page }) => {
        const hasSolid = await page.evaluate(() => {
            const t = window.game.terrain;
            // Check that there are solid pixels in the terrain
            let count = 0;
            for (let i = 0; i < t.data.length; i += 4) {
                if (t.data[i + 3] > 0) count++;
            }
            return count > 100;
        });
        expect(hasSolid).toBe(true);
    });

    test('worms are placed on terrain', async ({ page }) => {
        const wormPositions = await page.evaluate(() => {
            return window.game.worms.map(w => ({
                x: Math.round(w.x),
                y: Math.round(w.y),
                team: w.team,
                hp: w.hp,
                alive: w.isAlive()
            }));
        });
        expect(wormPositions.length).toBe(8);
        for (const w of wormPositions) {
            expect(w.alive).toBe(true);
            expect(w.hp).toBe(100);
            expect(w.x).toBeGreaterThanOrEqual(0);
            expect(w.x).toBeLessThan(1024);
            expect(w.y).toBeGreaterThan(0);
            expect(w.y).toBeLessThan(576);
        }
    });

    test('red team starts first', async ({ page }) => {
        const team = await page.evaluate(() => window.game.currentTeam);
        expect(team).toBe('red');
    });

    test('active worm is selected', async ({ page }) => {
        const activeWorm = await page.evaluate(() => {
            const w = window.game.activeWorm;
            return w ? { team: w.team, selected: w.selected } : null;
        });
        expect(activeWorm).not.toBeNull();
        expect(activeWorm.team).toBe('red');
        expect(activeWorm.selected).toBe(true);
    });

    test('UI elements are present', async ({ page }) => {
        const turnText = await page.textContent('#turnTeam');
        expect(turnText).toBe('RED');

        const healthValue = await page.textContent('#healthValue');
        expect(healthValue).toBe('100');

        const redCount = await page.textContent('#redCount .count');
        expect(redCount).toBe('4');

        const blueCount = await page.textContent('#blueCount .count');
        expect(blueCount).toBe('4');
    });

    test('skip turn switches to blue team', async ({ page }) => {
        await page.click('#skipTurnBtn');
        const team = await page.evaluate(() => window.game.currentTeam);
        expect(team).toBe('blue');
        const turnText = await page.textContent('#turnTeam');
        expect(turnText).toBe('BLUE');
    });

    test('firing a projectile switches to firing state', async ({ page }) => {
        // Simulate aiming and firing
        await page.evaluate(() => {
            const game = window.game;
            game.aimAngle = 45;
            game.aimPower = 50;
            game.fireProjectile();
        });
        const state = await page.evaluate(() => window.game.gameState);
        expect(state).toBe('firing');
        const projCount = await page.evaluate(() => window.game.projectiles.length);
        expect(projCount).toBeGreaterThan(0);
    });

    test('projectile flies and eventually explodes or goes out of bounds', async ({ page }) => {
        // Fire a projectile
        await page.evaluate(() => {
            const game = window.game;
            game.aimAngle = 45;
            game.aimPower = 80;
            game.fireProjectile();
        });

        // Wait for projectile to finish (should take a few seconds at most)
        await page.waitForFunction(() => {
            const game = window.game;
            return game.projectiles.length === 0 || game.gameState === 'aiming';
        }, { timeout: 10000 });

        const state = await page.evaluate(() => window.game.gameState);
        expect(state).toBe('aiming');
    });

    test('terrain is destructible', async ({ page }) => {
        // Get initial solid pixel count
        const initialCount = await page.evaluate(() => {
            const t = window.game.terrain;
            let count = 0;
            for (let i = 0; i < t.data.length; i += 4) {
                if (t.data[i + 3] > 0) count++;
            }
            return count;
        });

        // Dig a circle
        await page.evaluate(() => {
            const t = window.game.terrain;
            t.digCircle(500, 300, 30);
        });

        // Check that solid pixel count decreased
        const afterCount = await page.evaluate(() => {
            const t = window.game.terrain;
            let count = 0;
            for (let i = 0; i < t.data.length; i += 4) {
                if (t.data[i + 3] > 0) count++;
            }
            return count;
        });

        expect(afterCount).toBeLessThan(initialCount);
    });

    test('restart button resets the game', async ({ page }) => {
        // Skip a few turns to change state
        await page.click('#skipTurnBtn');
        await page.click('#skipTurnBtn');

        // Restart
        await page.click('#restartBtn');

        const team = await page.evaluate(() => window.game.currentTeam);
        expect(team).toBe('red');
        const wormCount = await page.evaluate(() => window.game.worms.length);
        expect(wormCount).toBe(8);
        const state = await page.evaluate(() => window.game.gameState);
        expect(state).toBe('aiming');
    });

    test('wind is set', async ({ page }) => {
        const wind = await page.evaluate(() => window.game.wind);
        expect(typeof wind).toBe('number');
        expect(Math.abs(wind)).toBeLessThanOrEqual(3.0);
    });

    test('game over screen appears when all worms on one team die', async ({ page }) => {
        // Kill all red worms
        await page.evaluate(() => {
            const game = window.game;
            for (const w of game.worms) {
                if (w.team === 'red') {
                    w.hp = 0;
                }
            }
            game.checkWinCondition();
        });

        const overlayVisible = await page.evaluate(() => {
            return !document.getElementById('messageOverlay').classList.contains('hidden');
        });
        expect(overlayVisible).toBe(true);

        const title = await page.textContent('#messageTitle');
        expect(title).toBe('BLUE TEAM WINS!');
    });
});
