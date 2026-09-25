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

test('official alerts show their severity and a one-line summary, then open in full', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/');
  const cards = page.getByTestId('alert-card');
  await expect(cards).toHaveCount(3);
  await expect(page.getByText('กำลังแสดงชุดข้อมูลตัวอย่าง')).toBeVisible();
  const veryHeavy = cards.filter({ hasText: 'ฝนตกหนักมาก' });
  await expect(veryHeavy).toContainText('รุนแรงมาก');
  await expect(veryHeavy).toContainText('30 จังหวัด รวม กทม.');
  await veryHeavy.getByRole('button', { name: /ดูพื้นที่และรายละเอียด/ }).click();
  const detail = page.getByTestId('alert-detail');
  await expect(detail).toContainText('ปทุมธานี');
  await expect(detail.getByRole('link', { name: 'อ่านต้นฉบับ' })).toHaveAttribute(
    'href',
    /^https:\/\/www.tmd.go.th\/uploads\/CAP\//,
  );
  await expect(page).toHaveURL(/alert=tmd/);
  await page.reload();
  await expect(page.getByTestId('alert-detail')).toBeVisible();
  await page.getByRole('button', { name: 'ปิดรายละเอียดประกาศ' }).click();
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
});

test('no active alert is never shown as a safe area, and ended alerts stay in the history', async ({
  page,
}) => {
  await prepare(page, 'out-of-order');
  await page.goto('/');
  await expect(page.getByText('ไม่พบประกาศที่มีผลในชุดนี้')).toBeVisible();
  await expect(
    page.getByText('ไม่มีข้อมูลหรือไม่พบประกาศ ไม่ได้แปลว่าพื้นที่ปลอดภัย'),
  ).toBeVisible();
  await expect(page.getByTestId('alert-card')).toHaveCount(0);
  await page.getByText('ประกาศที่สิ้นสุดในชุดข้อมูล (1)', { exact: true }).click();
  await expect(page.locator('.history-details li')).toContainText('ยกเลิก');
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

test('WebGL failure keeps every alert readable in the side panel', async ({ page }) => {
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

test('a click on the map drops a pin and summarises that place', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('map-surface')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
  // the map opens centred on central Thailand, inside the very-heavy-rain zone of the example
  await page.getByLabel(/^แผนที่ประเทศไทย/).click();
  const card = page.getByTestId('pin-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('มีประกาศครอบคลุมจุดนี้');
  await expect(card).toContainText('ฝน 7 วัน');
  await expect(page).toHaveURL(/pin=/);
  await page.getByRole('button', { name: 'ปิดหมุด' }).click();
  await expect(page.getByTestId('pin-card')).toHaveCount(0);
});

test('road search answers "has this road flooded" from the producer example', async ({ page }) => {
  await prepare(page);
  const manifest = read('active', 'manifest');
  manifest.files.push({
    path: 'ref/road_flood_history.json',
    sha256: '0'.repeat(64),
    size: 1,
    revision: 1,
  });
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route('**/examples/active/ref/road_flood_history.json?*', (route) =>
    route.fulfill({
      body: readFileSync(
        new URL(
          '../../../contracts/v1/examples/road-flood-history/road_flood_history.json',
          import.meta.url,
        ),
      ),
      contentType: 'application/json',
    }),
  );
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  const search = page.getByRole('searchbox', { name: 'ค้นหาถนนที่เคยน้ำท่วม' });
  await search.fill('ถนนสุขุมวิท');
  await page.getByRole('button', { name: /^ถ\.สุขุมวิท 7 วัน/ }).click();
  const card = page.getByTestId('road-card');
  await expect(card).toContainText('เคยมีรายงานน้ำท่วม 7 วัน');
  await expect(card).toContainText('ไม่ได้แปลว่าไม่เคยท่วม');
  await search.fill('ถนนที่ไม่มีในข้อมูล');
  await expect(page.getByText(/ไม่พบรายงานของถนนนี้/)).toBeVisible();
});

test('a missing map chunk leaves the rest of the page usable', async ({ page }) => {
  await prepare(page);
  await page.route('**/assets/MapView-*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('โหลดส่วนแผนที่ไม่สำเร็จ')).toBeVisible();
  await page.getByRole('button', { name: 'ดูรายการประกาศ', exact: true }).click();
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
});

test('the layout never scrolls sideways', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('Thai UI and details have no detected WCAG A/AA violations', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
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
