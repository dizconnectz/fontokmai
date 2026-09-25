import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

function read(scenario: string, file: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../../../contracts/v1/examples/${scenario}/${file}.json`, import.meta.url),
      'utf8',
    ),
  );
}
async function prepare(page: Page, scenario = 'active') {
  await page.clock.install({ time: new Date(read(scenario, 'manifest').generated_at) });
  await page.route('**/config.json', (route) =>
    route.fulfill({ json: { DATA_BASE_URL: `/examples/${scenario}/`, DATA_MODE: 'example' } }),
  );
  // The contract tests stay independent of the external basemap service.
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e7ede8' } },
        ],
      },
    }),
  );
}

test('search, read a linked official alert and persist a local bookmark', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await expect(page.getByText('กำลังแสดงชุดข้อมูลตัวอย่าง')).toBeVisible();
  await page.getByRole('searchbox').fill('ปทุมธานี');
  await expect(page.getByTestId('alert-card')).toHaveCount(1);
  const card = page.getByTestId('alert-card');
  await card.getByRole('button', { name: /^บันทึกประกาศ/ }).click();
  await card.getByRole('button', { name: /พื้นที่เสี่ยงภัยฝนตกหนักมาก/ }).click();
  await expect(page.getByTestId('alert-detail')).toContainText('ปทุมธานี');
  await expect(
    page.getByTestId('alert-detail').getByRole('link', { name: 'อ่านต้นฉบับ' }),
  ).toHaveAttribute('href', /^https:\/\/www.tmd.go.th\/uploads\/CAP\//);
  await expect(page).toHaveURL(/alert=tmd/);
  await page.reload();
  await expect(page.getByTestId('alert-detail')).toBeVisible();
  await page.getByRole('button', { name: 'บันทึกไว้', exact: true }).click();
  await expect(page.getByTestId('alert-card')).toHaveCount(1);
  await page.getByRole('button', { name: /^เลิกบันทึกประกาศ/ }).click();
  await expect(page.getByText('ยังไม่มีประกาศที่บันทึกไว้ในรายการนี้')).toBeVisible();
});

test('unavailable data stays unknown, list view works and the layout does not overflow', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'พยากรณ์ 7 วัน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ยังไม่มีข้อมูล', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'มุมมองรายการ', exact: true }).click();
  await expect(page.getByText('อ่านประกาศได้โดยไม่ใช้แผนที่')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('searchbox').fill('ตำบลที่ไม่มีในข้อมูล');
  await expect(page.getByText('ไม่พบประกาศที่ตรงกับคำค้น')).toBeVisible();
  await expect(
    page.getByText('ไม่มีข้อมูลหรือไม่พบประกาศ ไม่ได้แปลว่าพื้นที่ปลอดภัย'),
  ).toBeVisible();
});

test('stale detection works from the browser clock even while the publisher is frozen', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await expect(page.getByText(/^ข้อมูลไม่อัปเดต ตั้งแต่/)).toHaveCount(0);
  await page.clock.fastForward(31 * 60_000);
  await expect(page.getByText(/^ข้อมูลไม่อัปเดต ตั้งแต่/)).toBeVisible();
  await page.clock.fastForward(25 * 60 * 60_000);
  await expect(page.getByTestId('alert-card')).toHaveCount(0);
  await expect(page.getByText('ไม่พบประกาศที่มีผลในชุดนี้')).toBeVisible();
});

test('partial source keeps known alerts with last-success time', async ({ page }) => {
  await prepare(page, 'source-failed');
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await expect(page.getByText('แหล่งข้อมูลส่งข้อมูลไม่ครบ')).toBeVisible();
  await expect(page.locator('.source-times')).toContainText('18:05');
  await expect(page.locator('.source-times')).toContainText('ดึงข้อมูลไม่สำเร็จ');
});

test('pending and estimated expiry have explicit labels', async ({ page }) => {
  await prepare(page, 'pending');
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await expect(page.getByTestId('alert-card').filter({ hasText: 'เริ่มมีผลภายหลัง' })).toHaveCount(
    1,
  );
  await expect(
    page.getByTestId('alert-card').filter({ hasText: 'เวลาสิ้นสุดเป็นค่าประมาณ' }),
  ).toHaveCount(1);
});

test('cancel arriving out of order cannot appear as an active alert', async ({ page }) => {
  await prepare(page, 'out-of-order');
  await page.goto('/');
  await expect(page.getByText('ไม่พบประกาศที่มีผลในชุดนี้')).toBeVisible();
  await expect(page.getByTestId('alert-card')).toHaveCount(0);
  await page.getByText('ประกาศที่สิ้นสุดในชุดข้อมูล (1)', { exact: true }).click();
  await expect(page.locator('.history-details li')).toContainText('ยกเลิก');
});

test('mixed snapshots and a subsequent network failure preserve the previous complete set', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  const before = await page.getByTestId('alert-card').allTextContents();
  let requests = 0;
  const mixedManifest = read('mixed-generation', 'manifest');
  mixedManifest.generation_id = 'new-generation';
  await page.route('**/examples/active/manifest.json?*', (route) => {
    requests++;
    return route.fulfill({ json: mixedManifest });
  });
  await page.route('**/examples/active/alerts.json?*', (route) =>
    route.fulfill({ json: read('mixed-generation', 'alerts') }),
  );
  await page.getByRole('button', { name: 'ตรวจข้อมูลอีกครั้ง' }).click();
  await expect(page.getByText('กำลังอัปเดต · ไฟล์ข้อมูลยังไม่ตรงกัน')).toBeVisible();
  expect(requests).toBe(2);
  expect(await page.getByTestId('alert-card').allTextContents()).toEqual(before);
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await page.getByRole('button', { name: 'ตรวจข้อมูลอีกครั้ง' }).click();
  await expect(page.getByText('โหลดข้อมูลไม่สำเร็จ', { exact: true })).toBeVisible();
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
});

test('a first-load mixed generation does not show unchecked alerts', async ({ page }) => {
  await prepare(page, 'mixed-generation');
  await page.goto('/');
  await expect(page.getByText('กำลังอัปเดต · ไฟล์ข้อมูลยังไม่ตรงกัน')).toBeVisible();
  await expect(page.getByTestId('alert-card')).toHaveCount(0);
  await expect(page.getByText('ยังไม่มีข้อมูลประกาศ', { exact: true })).toBeVisible();
});

test('WebGL failure leaves an accessible list available', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith('webgl') || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByText('อุปกรณ์นี้เปิดแผนที่ไม่ได้')).toBeVisible();
  await page.getByRole('button', { name: 'ดูรายการประกาศ', exact: true }).click();
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
});

test('the bundled map worker renders selectable CAP geometry on the production build', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('map-surface')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'กลับไปดูแผนที่ประเทศไทย' })).toBeVisible();
  const canvas = page.getByLabel(/^แผนที่ขอบเขตประกาศกรมอุตุนิยมวิทยา/);
  await canvas.click();
  await expect(page.getByTestId('alert-detail')).toBeVisible();
});

test('a missing map chunk leaves the rest of the page usable', async ({ page }) => {
  await prepare(page);
  await page.route('**/assets/AlertMap-*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('โหลดส่วนแผนที่ไม่สำเร็จ')).toBeVisible();
  await page.getByRole('button', { name: 'ดูรายการประกาศ', exact: true }).click();
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
});

test('Thai UI and details have no detected WCAG A/AA violations', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'มุมมองรายการ', exact: true }).click();
  await page
    .getByTestId('alert-card')
    .first()
    .getByRole('button', { name: /ดูพื้นที่และรายละเอียด/ })
    .click();
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = result.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
  }));
  expect(violations).toEqual([]);
});

test('static sources and method pages remain readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://localhost:4173/sources/');
  await expect(page.getByRole('heading', { name: 'แหล่งข้อมูลและเครดิต' })).toBeVisible();
  await expect(
    page.getByText('fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยา', {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto('http://localhost:4173/method/');
  await expect(page.getByRole('heading', { name: 'อ่านแผนที่อย่างไร' })).toBeVisible();
  await context.close();
});
