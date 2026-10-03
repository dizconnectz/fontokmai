import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/v1/examples/${name}.json`, import.meta.url), 'utf8'),
  );
async function prepare(
  page: Page,
  options: { missing?: boolean; stale?: boolean; incomplete?: boolean } = {},
) {
  const data = read('outlook/outlook');
  if (options.stale) data.fetched_at = '2026-09-23T18:20:00+07:00';
  if (options.incomplete)
    data.points.forEach((p: any) =>
      p.models.forEach((m: any) => m.members.forEach((member: any) => member.rain_mm.fill(null))),
    );
  const body = JSON.stringify(data);
  const manifest = read('active/manifest');
  if (!options.missing)
    manifest.files.push({
      path: 'forecast/outlook.json',
      sha256: createHash('sha256').update(body).digest('hex'),
      size: Buffer.byteLength(body),
      revision: 1,
    });
  await page.clock.install({ time: new Date(manifest.generated_at) });
  await page.route('**/config.json', (route) =>
    route.fulfill({ json: { DATA_BASE_URL: '/examples/active/', DATA_MODE: 'example' } }),
  );
  await page.route('**/manifest.json?*', (route) => route.fulfill({ json: manifest }));
  await page.route('**/forecast/outlook.json?*', (route) =>
    route.fulfill({ body, contentType: 'application/json' }),
  );
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
  await page.goto('/');
  const card = page.getByTestId('rain-outlook');
  await card.locator('details > summary').first().click();
  return card;
}

test('shows seven future days, the weighted ensemble and hydraulic limitations without overflowing', async ({
  page,
}) => {
  const card = await prepare(page);
  await expect(card.locator('tbody tr')).toHaveCount(7);
  await expect(card.getByRole('button', { name: 'วันที่ 8–14' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card.getByText('ทดลอง', { exact: true })).toBeVisible();
  await expect(card.getByText(/ไม่ใช่โอกาสน้ำท่วม/)).toBeVisible();
  await card.getByRole('button', { name: 'วันที่ 1–7' }).click();
  await expect(card.locator('tbody tr')).toHaveCount(7);
  await card.getByLabel('จุดตัวอย่าง').selectOption('ping-r01');
  await expect(card.getByLabel('จุดตัวอย่าง')).toHaveValue('ping-r01');
  await card.getByText('ข้อมูลสำหรับคำนวณน้ำ', { exact: true }).click();
  await expect(card.getByText(/ยังคำนวณน้ำล้นตลิ่งไม่ได้/)).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((el) => el.clientWidth),
  );
  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="rain-outlook"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await card.getByRole('button', { name: 'ดูจุดนี้บนแผนที่' }).click();
  await expect(page.getByTestId('pin-card')).toBeVisible();
  await expect(page).toHaveURL(/pin=19\.52500%2C98\.92500/);
  await page.screenshot({
    path: `test-results/outlook-${page.viewportSize()!.width}.png`,
    fullPage: true,
  });
});

test('missing or incomplete members never read as no rain', async ({ page }) => {
  const card = await prepare(page, { incomplete: true });
  await expect(card.locator('tbody tr')).toHaveCount(7);
  await expect(card.getByRole('cell', { name: 'ประเมินไม่ได้', exact: true })).toHaveCount(7);
  await expect(card.getByRole('cell', { name: '0%', exact: true })).toHaveCount(0);
});

test('marks an old dataset visibly and handles a missing manifest file', async ({ page }) => {
  const card = await prepare(page, { stale: true });
  await expect(card.getByText('ข้อมูลเก่า · แนวโน้มอาจเปลี่ยนแล้ว')).toBeVisible();
  await page.unrouteAll();
  const missing = await prepare(page, { missing: true });
  await expect(missing.getByText('ยังไม่มีข้อมูลแนวโน้มฝน 14 วัน')).toBeVisible();
});
