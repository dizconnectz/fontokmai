import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.WEB_PREVIEW_URL ?? 'http://localhost:4173';
const browser = await chromium.launch();
await mkdir('test-results/live', { recursive: true });
try {
  for (const [name, options] of [
    ['desktop', { viewport: { width: 1440, height: 1080 } }],
    ['mobile', { ...devices['Pixel 7'] }],
  ]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [],
      failures = [],
      glyphs = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => failures.push(new URL(request.url()).pathname));
    page.on('response', (response) => {
      if (response.url().includes('/fonts/'))
        glyphs.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    const manifestRequest = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/manifest.json'),
    );
    await page.goto(origin);
    const manifest = await (await manifestRequest).json();
    await page.waitForFunction(() => document.querySelector('.source-times small'));
    const mapReady = await page
      .locator('.map-reset')
      .waitFor({ timeout: 30_000 })
      .then(
        () => true,
        () => false,
      );
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.locator('.map-canvas').evaluate((element) => element.clientHeight > 300),
      'Map container must have visible height',
    );
    // Capture a real rendered map after initial tile requests settle.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    assert.equal(
      await page.locator('.example-banner').count(),
      0,
      'Live data must not use demo mode',
    );
    assert.equal(
      await page.locator('.notice.warning').filter({ hasText: 'โหลดข้อมูลไม่สำเร็จ' }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: `test-results/live/${name}.png`, fullPage: true });
    await page.locator('.map-panel').screenshot({ path: `test-results/live/${name}-map.png` });
    console.log(
      JSON.stringify(
        {
          viewport: name,
          generation_id: manifest.generation_id,
          published_at: manifest.generated_at,
          alerts_visible: await page.getByTestId('alert-card').count(),
          glyphs,
          failed_requests: failures,
          map_ready: mapReady,
          map_notice: await page.locator('.map-notice').allTextContents(),
          map_fallback: await page.locator('.map-unavailable').allTextContents(),
          js_errors: errors,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(errors, []);
    assert.equal(
      mapReady,
      true,
      'Live basemap did not become ready; inspect the screenshot and requests',
    );
    await context.close();
  }
} finally {
  await browser.close();
}
