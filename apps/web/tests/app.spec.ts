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
  // Area names: the Bangkok + Pathum Thani cut of the shipped gazetteer.
  await page.route('**/ref/places.json?*', (route) =>
    route.fulfill({
      body: readFileSync(
        new URL('../../../contracts/v1/examples/places/places.json', import.meta.url),
      ),
      contentType: 'application/json',
    }),
  );
  // The camera registry the producer ships
  await page.route('**/ref/cctv.json?*', (route) =>
    route.fulfill({
      body: readFileSync(
        new URL('../../../pipeline/src/fontokmai/ref_data/cctv.json', import.meta.url),
      ),
      contentType: 'application/json',
    }),
  );
  // No landmark search leaves the test browser unless a test answers for Photon itself.
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
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

test('the map keeps the zoom someone chose while the data refreshes', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  const surface = page.getByTestId('map-surface');
  await expect(surface).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  // selecting an alert fits the map to its area once
  await page
    .getByTestId('alert-card')
    .filter({ hasText: 'ฝนตกหนักมาก' })
    .getByRole('button', { name: /ดูพื้นที่และรายละเอียด/ })
    .click();
  await expect(page.getByTestId('alert-detail')).toBeVisible();
  await expect(surface).not.toHaveAttribute('data-zoom', '5');
  const fitted = Number(await surface.getAttribute('data-zoom'));
  // then the person zooms in to look for their street
  const zoomIn = page.getByRole('button', { name: 'ขยายแผนที่' });
  for (let step = 1; step <= 3; step++) {
    await zoomIn.click();
    // one step at a time: a click during the zoom animation starts from a half-way zoom
    await expect
      .poll(async () => Number(await surface.getAttribute('data-zoom')))
      .toBeGreaterThanOrEqual(fitted + step - 0.05);
  }
  const chosen = await surface.getAttribute('data-zoom');
  // the 15-second clock tick and the 1-minute refresh rebuild the alert list
  await page.clock.fastForward(61_000);
  await expect(page.getByTestId('alert-detail')).toBeVisible();
  await page.waitForTimeout(700);
  await expect(surface).toHaveAttribute('data-zoom', chosen!);
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
  const search = page.getByRole('combobox', { name: 'ค้นหาสถานที่' });
  await search.fill('ถนนสุขุมวิท');
  await page.getByRole('option', { name: /^ถ\.สุขุมวิท เคยมีรายงานน้ำท่วม 7 วัน/ }).click();
  const card = page.getByTestId('road-card');
  await expect(card).toContainText('เคยมีรายงานน้ำท่วม 7 วัน');
  await expect(card).toContainText('ไม่ได้แปลว่าไม่เคยท่วม');
  await search.fill('ถนนที่ไม่มีในข้อมูล');
  await expect(page.getByText(/ไม่พบรายงานของถนนนี้/)).toBeVisible();
});

test('searching an area flies there, names the pin and summarises that area', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('map-surface')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
  const search = page.getByRole('combobox', { name: 'ค้นหาสถานที่' });
  await search.fill('คลองหนึ่ง');
  const option = page.getByRole('option', { name: /^ต\.คลองหนึ่ง อ\.คลองหลวง จ\.ปทุมธานี/ });
  await expect(option).toBeVisible();
  // the open list is part of the accessibility check
  const result = await new AxeBuilder({ page })
    .include('.place-search')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await option.click();
  const card = page.getByTestId('pin-card');
  await expect(card.getByRole('heading', { name: 'ต.คลองหนึ่ง', exact: true })).toBeVisible();
  await expect(card).toContainText('อ.คลองหลวง จ.ปทุมธานี · จุดอ้างอิงกรมการปกครอง');
  // the very heavy rain alert of the example lists ปทุมธานี
  await expect(card).toContainText('มีประกาศครอบคลุม ต.คลองหนึ่ง');
  await expect(page.locator('.pin-tag')).toHaveText('ต.คลองหนึ่ง');
  await expect(page).toHaveURL(/pin=14\.06600(?:,|%2C)100\.60700/);
  await expect(search).toHaveValue('ต.คลองหนึ่ง');
});

test('the keyboard picks a result and landmarks come from Photon', async ({ page }) => {
  await prepare(page);
  const asked: URL[] = [];
  await page.route('https://photon.komoot.io/**', (route) => {
    asked.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [100.6184, 13.989] },
            properties: {
              name: 'Future Park Rangsit',
              osm_type: 'W',
              osm_id: 1,
              type: 'house',
              county: 'อำเภอธัญบุรี',
              state: 'จังหวัดปทุมธานี',
            },
          },
        ],
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  const search = page.getByRole('combobox', { name: 'ค้นหาสถานที่' });
  await search.fill('บางนา');
  await expect(page.getByRole('option').first()).toContainText('เขตบางนา');
  await search.press('Enter');
  await expect(
    page.getByTestId('pin-card').getByRole('heading', { name: 'เขตบางนา', exact: true }),
  ).toBeVisible();

  await search.fill('future park');
  await page.getByRole('option', { name: /^Future Park Rangsit/ }).click();
  const card = page.getByTestId('pin-card');
  await expect(
    card.getByRole('heading', { name: 'Future Park Rangsit', exact: true }),
  ).toBeVisible();
  await expect(card).toContainText('อ.ธัญบุรี จ.ปทุมธานี · ตำแหน่งจาก OpenStreetMap');
  await expect(card).toContainText('สถานที่ที่ค้นหา');
  // only the typed words and the Thailand box leave the browser: no position
  expect(asked.length).toBeGreaterThan(0);
  const last = asked.at(-1)!;
  expect(last.searchParams.get('q')).toBe('future park');
  expect(last.searchParams.get('bbox')).toBe('97.3,5.6,105.7,20.5');
  expect(last.searchParams.has('lat') || last.searchParams.has('lon')).toBe(false);
});

test('a pin never says "no alert" in green when the alert data could not be checked', async ({
  page,
}) => {
  // the alert file fails from the first load: nothing to check against
  await prepare(page);
  await page.route('**/examples/active/alerts.json?*', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await page.goto('/?pin=13.9,100.6');
  const heading = page.getByTestId('pin-card').locator('#pin-now');
  await expect(heading).toHaveText('ยังตรวจประกาศของจุดนี้ไม่ได้');
  await expect(heading).toHaveClass(/heading-unknown/);
  await expect(page.getByTestId('pin-card')).toContainText('ไม่ได้แปลว่าไม่มีประกาศ');
});

test('a first load of mixed files cannot clear a pin either', async ({ page }) => {
  await prepare(page, 'mixed-generation');
  await page.goto('/?pin=13.9,100.6');
  await expect(page.getByTestId('pin-card').locator('#pin-now')).toHaveText(
    'ยังตรวจประกาศของจุดนี้ไม่ได้',
  );
});

test('only fresh and complete alert data can clear a pin', async ({ page }) => {
  await prepare(page, 'out-of-order');
  await page.goto('/?pin=13.9,100.6');
  const heading = page.getByTestId('pin-card').locator('#pin-now');
  await expect(heading).toHaveText('ไม่มีประกาศเตือนภัยครอบคลุมจุดนี้');
  await expect(heading).toHaveClass(/heading-ok/);
  // the publisher stops: the same data is no longer enough to say "no alert"
  await page.clock.fastForward(31 * 60_000);
  await expect(heading).toHaveText('ไม่พบประกาศครอบคลุมจุดนี้ในข้อมูลล่าสุดที่มี');
  await expect(heading).toHaveClass(/heading-unknown/);
  await expect(page.getByTestId('pin-card')).toContainText('ข้อมูลไม่อัปเดตตั้งแต่');
});

test('a partial round and an alert without a boundary keep a pin undecided', async ({ page }) => {
  await prepare(page, 'source-failed');
  await page.goto('/?pin=7.0,100.5');
  const heading = page.getByTestId('pin-card').locator('#pin-now');
  await expect(heading).toHaveText('ไม่พบประกาศครอบคลุมจุดนี้ในข้อมูลล่าสุดที่มี');
  await expect(page.getByTestId('pin-card')).toContainText('รอบล่าสุดดึงประกาศได้ไม่ครบ');

  const other = await page.context().newPage();
  await prepare(other);
  const feed = read('active', 'alerts');
  for (const alert of feed.alerts) alert.geometry = null;
  await other.route('**/examples/active/alerts.json?*', (route) => route.fulfill({ json: feed }));
  await other.goto('/?pin=7.0,100.5');
  const card = other.getByTestId('pin-card');
  await expect(card.locator('#pin-now')).toHaveText('ไม่พบประกาศที่มีขอบเขตครอบคลุมจุดนี้');
  await expect(card).toContainText('มีประกาศ 3 ฉบับที่ไม่ระบุขอบเขตพิกัด');
  await expect(card.getByTestId('alert-card')).toHaveCount(3);
});

test('the camera list tells a failed, removed or older registry apart from "no camera here"', async ({
  page,
}) => {
  await prepare(page);
  const registry = {
    schema_version: '1',
    updated: '2026-09-26',
    cameras: [
      {
        id: 'test-cam',
        name_th: 'กล้องทดสอบคลองรังสิต',
        owner_th: 'ผู้ทดสอบ',
        kind: 'canal',
        location: [100.61, 13.91],
        position: 'source',
        page_url: 'https://example.org/cam',
        note_th: null,
      },
    ],
    notes_th: [],
  };
  let cctv: 'fail' | 'ok' = 'fail';
  await page.route('**/ref/cctv.json?*', (route) =>
    cctv === 'ok' ? route.fulfill({ json: registry }) : route.fulfill({ status: 503, body: '' }),
  );
  const manifest = read('active', 'manifest');
  const listed = (sha: string | null) => ({
    ...manifest,
    files: [
      ...manifest.files.filter((f: { path: string }) => f.path !== 'ref/cctv.json'),
      ...(sha ? [{ path: 'ref/cctv.json', sha256: sha.repeat(64), size: 1, revision: 1 }] : []),
    ],
  });
  let current = listed('a');
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: current }),
  );
  const refresh = () => page.getByRole('button', { name: 'ตรวจข้อมูลอีกครั้ง' }).click();
  await page.goto('/?pin=13.9,100.6');
  const card = page.getByTestId('pin-card');
  // 1. the first load fails
  await expect(card).toContainText('โหลดทะเบียนกล้องไม่สำเร็จ');
  await expect(card).not.toContainText('ยังไม่มีกล้องในทะเบียนของเราใกล้จุดนี้');
  // 2. a new version loads
  cctv = 'ok';
  current = listed('b');
  await refresh();
  await expect(card.getByRole('link', { name: /กล้องทดสอบคลองรังสิต/ })).toBeVisible();
  // 3. the next version fails: the older copy stays, labelled
  cctv = 'fail';
  current = listed('c');
  await refresh();
  await expect(card).toContainText('ทะเบียนกล้องชุดก่อน');
  await expect(card.getByRole('link', { name: /กล้องทดสอบคลองรังสิต/ })).toBeVisible();
  // 4. the manifest drops the file: nothing old is shown
  current = listed(null);
  await refresh();
  await expect(card).toContainText('ชุดข้อมูลนี้ยังไม่มีทะเบียนกล้อง');
  await expect(card.getByRole('link', { name: /กล้องทดสอบคลองรังสิต/ })).toHaveCount(0);
  // 5. and lists it again
  cctv = 'ok';
  current = listed('d');
  await refresh();
  await expect(card.getByRole('link', { name: /กล้องทดสอบคลองรังสิต/ })).toBeVisible();
  await expect(card).not.toContainText('ชุดก่อน');
});

test('the timeline slides from now into the forecast and the map and pin follow', async ({
  page,
}) => {
  await prepare(page);
  const manifest = read('active', 'manifest');
  manifest.files.push({ path: 'forecast/rain.json', sha256: 'f'.repeat(64), size: 1, revision: 1 });
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: manifest }),
  );
  const forecast = JSON.parse(
    readFileSync(
      new URL('../../../contracts/v1/examples/forecast/rain.json', import.meta.url),
      'utf8',
    ),
  );
  await page.route('**/forecast/rain.json?*', (route) => route.fulfill({ json: forecast }));
  // Bangkok is a lattice point of the example (col 1, row 1 → index 4)
  await page.goto('/?pin=13.75,100.5');
  const card = page.getByTestId('pin-card');
  await expect(card.getByTestId('forecast-days').locator('li')).toHaveCount(7);
  await expect(card.getByTestId('forecast-days')).toContainText('พรุ่งนี้');
  await expect(card).toContainText('Open-Meteo.com (CC BY 4.0)');

  const slider = page.getByRole('slider', { name: 'เลื่อนดูเวลาของแผนที่' });
  await expect(slider).toHaveAttribute('aria-valuetext', /^ตอนนี้/);
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', /^พยากรณ์ · \S+ \d\d:\d\d–\d\d:\d\d น\.$/);
  await expect(page.locator('.timeline')).toHaveClass(/is-forecast/);
  await expect(page.locator('.map-legend')).toContainText('พยากรณ์ฝน');
  // the forecast key is its own scale and says where colouring starts (contract section 12)
  await expect(page.locator('.map-legend')).toContainText('ระบายสีตั้งแต่ 0.5 มม./ชม.');
  const first = forecast.rain[0][4] / 10;
  await expect(card.locator('#pin-rain')).toHaveText(/ฝนที่พยากรณ์ตรงจุดนี้/);
  await expect(card).toContainText(
    first >= 0.1 ? `ราว ${first.toFixed(1)} มม. ในชั่วโมงนั้น` : 'ไม่มีฝนในพยากรณ์ชั่วโมงนั้น',
  );
  // the accessibility check covers the timeline in forecast mode
  const result = await new AxeBuilder({ page })
    .include('.timeline')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  // play moves forward on its own, and "back to now" returns to the present
  await page.getByRole('button', { name: 'เล่นต่อเนื่องไปข้างหน้า' }).click();
  await page.clock.fastForward(1_500);
  await expect(slider).not.toHaveValue('1');
  await page.getByRole('button', { name: 'กลับมาตอนนี้' }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', /^ตอนนี้/);
  await expect(card.locator('#pin-rain')).toHaveText(/ฝนตอนนี้ตรงจุดนี้/);
});

test('a flood report opens on the map without leaving the list, and its popup leads to the pin card', async ({
  page,
}) => {
  await prepare(page);
  const manifest = read('active', 'manifest');
  manifest.files.push({ path: 'live/floods.json', sha256: 'a'.repeat(64), size: 1, revision: 1 });
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: manifest }),
  );
  const now = Date.parse(manifest.generated_at);
  const iso = (ms: number) => new Date(ms).toISOString();
  await page.route('**/live/floods.json?*', (route) =>
    route.fulfill({
      json: {
        schema_version: '1',
        fetched_at: iso(now - 5 * 60_000),
        source_url: 'https://traffic.longdo.com/',
        credit_th: 'iTIC และ Longdo Traffic (CC BY 4.0)',
        notes_th: [],
        reports: [
          {
            id: 'longdo:1',
            title_th: 'น้ำท่วม ซอยทดสอบ',
            road_th: 'ซอยทดสอบ',
            location: [100.6, 13.9],
            start: iso(now - 10 * 60_000),
            stop: iso(now + 50 * 60_000),
            reporter: 'public',
            url: 'https://traffic.longdo.com/e/A00000001',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'รายงานน้ำท่วมตอนนี้ 1 จุด' })).toBeVisible();
  await expect(page.getByTestId('map-surface')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
  // choosing a report opens it on the map only: the list stays and marks the open report
  const item = page.getByRole('button', { name: /ซอยทดสอบ/ });
  await item.click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('น้ำท่วม ซอยทดสอบ');
  await expect(item).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('pin-card')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1280) < 900) {
    // on a phone the map sits above the list: a chip leads back to the report
    await page.getByRole('button', { name: 'กลับไปที่รายการน้ำท่วม' }).click();
    await expect(item).toBeInViewport();
  }
  // the spot's own data opens in the side panel only when asked for
  await popup.getByRole('button', { name: 'ดูฝนและประกาศตรงนี้' }).click();
  await expect(popup).toHaveCount(0);
  const here = page.getByTestId('pin-card').getByTestId('floods-here');
  await expect(here).toContainText('ซอยทดสอบ');
  await expect(here).toContainText('เมื่อ 10 นาทีก่อน · ผู้ใช้รายงาน');
  // past floods are still there, folded and labelled as the past
  const history = page.getByTestId('pin-card').locator('.flood-history');
  await expect(history).not.toHaveAttribute('open');
  await expect(history.locator('summary')).toContainText('ข้อมูลย้อนหลัง ไม่ใช่ตอนนี้');
});

test("today's report of flooded main roads lists roads and matches those near a pin by name", async ({
  page,
}) => {
  await prepare(page);
  const manifest = read('active', 'manifest');
  for (const [path, sha] of [
    ['bkk/flooding.json', 'd'],
    ['ref/road_flood_history.json', '0'],
  ])
    manifest.files.push({ path, sha256: sha.repeat(64), size: 1, revision: 1 });
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route('**/ref/road_flood_history.json?*', (route) =>
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
  const at = Date.parse(manifest.generated_at);
  const iso = (ms: number) => new Date(ms).toISOString();
  const report = (road: string, area: string) => ({
    district_th: 'คลองเตย',
    road_th: road,
    area_th: area,
    depth_cm: 15,
    length_m: 200,
    lanes_th: '1-2 เลน',
    flood_start: iso(at - 90 * 60_000),
    dry_at: null,
    rain_mm: 0,
  });
  let fetchedAt = at;
  let reportDate = iso(at).slice(0, 10);
  await page.route('**/bkk/flooding.json?*', (route) =>
    route.fulfill({
      json: {
        schema_version: '1',
        fetched_at: iso(fetchedAt),
        report_date: reportDate,
        updated_at: iso(at - 10 * 60_000),
        source_url: 'https://dds.bangkok.go.th/flood_report.php',
        credit_th: 'สำนักการระบายน้ำ กรุงเทพมหานคร (ผ่านระบบ DXS)',
        reports: [
          report('สุขุมวิท', 'ซอยสุขุมวิท 26 ช่วงกลางซอย'),
          report('พหลโยธิน', 'หน้าม.เกษตร'),
        ],
        notes_th: [],
      },
    }),
  );
  await page.goto('/');
  const list = page.getByTestId('road-flooding');
  await expect(list.getByRole('heading')).toHaveText('ถนนสายหลัก กทม. ที่ยังท่วม 2 จุด');
  await expect(list).toContainText('ถ.สุขุมวิท · ซอยสุขุมวิท 26 ช่วงกลางซอย');
  await expect(list).toContainText('ถนนที่ไม่มีในรายการไม่ได้แปลว่าไม่ท่วม');
  // a road opens on the map only; the list stays
  await list.getByRole('button', { name: /ถ\.สุขุมวิท/ }).click();
  await expect(list).toBeVisible();
  await expect(page.getByTestId('road-card')).toHaveCount(0);
  // at a pin on Sukhumvit only the report on Sukhumvit is shown, and it says the match is by name
  await page.goto('/?pin=13.701,100.601');
  const here = page.getByTestId('road-report-here');
  await expect(here).toContainText('ถ.สุขุมวิท · ซอยสุขุมวิท 26 ช่วงกลางซอย');
  await expect(here).not.toContainText('พหลโยธิน');
  await expect(here).toContainText('จับคู่จากชื่อถนน');
  // a one-off fetch from two hours ago says when it was, and "still flooded" only held then
  fetchedAt = at - 2 * 3_600_000;
  await page.goto('/');
  await expect(list.getByRole('heading')).toContainText('รายงานถนนท่วม กทม. เมื่อ');
  await expect(list).toContainText('ไม่ได้อัปเดตอัตโนมัติ');
  await expect(list).toContainText('ยังท่วมตอนรายงาน');
  // another day's report is never shown as now
  reportDate = '2026-09-24';
  await page.goto('/');
  await expect(page.getByTestId('alert-card').first()).toBeVisible();
  await expect(page.getByTestId('road-flooding')).toHaveCount(0);
});

test('Bangkok rain gauges and canal levels show as measured values near a pin', async ({
  page,
}) => {
  await prepare(page);
  const manifest = read('active', 'manifest');
  manifest.files.push({ path: 'bkk/water.json', sha256: 'b'.repeat(64), size: 1, revision: 1 });
  manifest.files.push({ path: 'bkk/rain.json', sha256: 'c'.repeat(64), size: 1, revision: 1 });
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: manifest }),
  );
  // the producer's examples, moved to five minutes before this snapshot
  const at = Date.parse(manifest.generated_at);
  const recent = (file: string) => {
    const data = JSON.parse(
      readFileSync(new URL(`../../../contracts/v1/examples/bkk/${file}`, import.meta.url), 'utf8'),
    );
    data.fetched_at = new Date(at).toISOString();
    for (const item of data.stations ?? data.gauges)
      if (item.observed_at) item.observed_at = new Date(at - 5 * 60_000).toISOString();
    return data;
  };
  await page.route('**/bkk/water.json?*', (route) => route.fulfill({ json: recent('water.json') }));
  await page.route('**/bkk/rain.json?*', (route) => route.fulfill({ json: recent('rain.json') }));
  await page.goto('/?pin=13.7065,100.5703'); // at the example pumping station ส.คลองเตย
  const here = page.getByTestId('measured-here');
  // the nearest gauge is 2.3 km away; the one 13 km away is not "near"
  await expect(here).toContainText('ฝน 1 ชม. 0 มม. · 24 ชม. 1.5 มม.');
  await expect(here).toContainText('สถานีสถานีสูบน้ำพระโขนง ห่าง 2.3 กม.');
  await expect(here.getByTestId('water-here')).toContainText('ส.คลองเตย · ด้านใน 1.78 ม.รทก.');
  await expect(here.getByTestId('water-here').locator('li')).toHaveCount(1);
  await expect(here).toContainText('ไม่ใช่ความลึกน้ำท่วมบนถนน');
  await page.getByRole('button', { name: 'ชั้นข้อมูล' }).click();
  await expect(page.getByRole('button', { name: 'ระดับน้ำคลอง กทม.' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the department situation text and the Chao Phraya dams show, with a note once a day old', async ({
  page,
}) => {
  await prepare(page);
  const manifest = read('active', 'manifest');
  manifest.files.push({ path: 'bkk/news.json', sha256: 'e'.repeat(64), size: 1, revision: 1 });
  manifest.files.push({ path: 'water/dams.json', sha256: 'f'.repeat(64), size: 1, revision: 1 });
  await page.route('**/examples/active/manifest.json?*', (route) =>
    route.fulfill({ json: manifest }),
  );
  const at = Date.parse(manifest.generated_at);
  let fetchedAt = at;
  const example = (file: string) => {
    const data = JSON.parse(
      readFileSync(new URL(`../../../contracts/v1/examples/bkk/${file}`, import.meta.url), 'utf8'),
    );
    data.fetched_at = new Date(fetchedAt).toISOString();
    return data;
  };
  await page.route('**/bkk/news.json?*', (route) => route.fulfill({ json: example('news.json') }));
  await page.route('**/water/dams.json?*', (route) =>
    route.fulfill({ json: example('dams.json') }),
  );
  await page.goto('/');
  const situation = page.getByTestId('situation');
  await expect(situation).toContainText('รายงานสถานการณ์ทดสอบประจำวัน');
  await expect(situation).toContainText('ฝนเล็กน้อย & ลมแรง');
  await expect(situation).toContainText('ไม่ใช่ประกาศเตือนภัยของกรมอุตุฯ');
  const dams = page.getByTestId('dams');
  await expect(dams).toContainText('เขื่อนภูมิพล · น้ำ 62.68%');
  await expect(dams).toContainText('เขื่อนป่าสักชลสิทธิ์');
  await expect(dams).not.toContainText('ไม่ใช่ข้อมูลเรียลไทม์');
  // choosing a dam moves the map only
  await dams.getByRole('button', { name: /เขื่อนภูมิพล/ }).click();
  await expect(dams).toBeVisible();
  // fetched two days before: both say it is not real time and give the date
  fetchedAt = at - 2 * 24 * 3_600_000;
  await page.goto('/');
  await expect(page.getByTestId('situation')).toContainText(
    'ข้อมูลนี้ไม่ใช่ข้อมูลเรียลไทม์ · ข้อมูล ณ วันที่',
  );
  await expect(page.getByTestId('dams')).toContainText('ข้อมูลนี้ไม่ใช่ข้อมูลเรียลไทม์');
});

test('the Bangkok layers have no switch until their files are published', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'ชั้นข้อมูล' }).click();
  await expect(page.getByRole('button', { name: 'กล้อง CCTV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ระดับน้ำคลอง กทม.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ฝนวัดจริง กทม.' })).toHaveCount(0);
});

test('one place can be saved as "my place" and opened again from the map or the overview', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/?pin=13.9,100.6');
  // the saved name is the area name once the list of subdistricts has loaded
  await expect(page.getByTestId('pin-card').locator('.place-name')).toHaveText('แถวแขวงสีกัน');
  const save = page.getByRole('button', { name: 'ตั้งเป็นที่ของฉัน' });
  await save.click();
  await expect(page.getByRole('button', { name: 'ที่ของฉัน', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // later, without a pin in the link
  await page.goto('/');
  await expect(page.getByTestId('map-surface')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
  const card = page.locator('.favorite-card');
  await expect(card).toContainText('ที่ของฉัน · แขวงสีกัน'); // named after the nearest subdistrict
  await page.getByRole('button', { name: /^ไปที่ของฉัน/ }).click();
  await expect(page.getByTestId('pin-card')).toBeVisible();
  await expect(page).toHaveURL(/pin=13\.90000(?:,|%2C)100\.60000/);
  // and it can be taken off again
  await page.getByRole('button', { name: 'ที่ของฉัน', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ตั้งเป็นที่ของฉัน' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ไปที่ของฉัน/ })).toHaveCount(0);
});

test('dark mode follows the device, can be switched, and stays readable (WCAG A/AA)', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('alert-card')).toHaveCount(3);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // the strip under the header shows the most severe alert in effect
  await expect(page.locator('.situation-strip')).toHaveClass(/situation-extreme/);
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  // a choice made with the button wins over the device and is remembered
  await page.getByRole('button', { name: 'เปลี่ยนเป็นโหมดสว่าง' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
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
