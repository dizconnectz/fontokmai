import {
  test,
  expect,
} from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { readFileSync } from "node:fs";

const read = (file) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${file}`, import.meta.url),
      "utf8",
    ),
  );
const NOW = "2026-09-30T11:00:00+07:00";

async function prepare(page, files) {
  await page.clock.setFixedTime(new Date(NOW));
  const manifest = read("active/manifest.json");
  manifest.generated_at = NOW;
  manifest.source_status = manifest.source_status.filter(
    (s) => s.source_id !== "bma_dxs",
  );
  const alerts = read("active/alerts.json");
  alerts.alerts = [];
  files = { "alerts.json": alerts, ...files };
  manifest.files = Object.keys(files).map((path) => ({
    path,
    sha256: "a".repeat(64),
    size: 1,
    revision: 1,
  }));
  await page.route("**/config.json", (r) =>
    r.fulfill({
      json: { DATA_BASE_URL: "/review-data/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/review-data/manifest.json?*", (r) =>
    r.fulfill({ json: manifest }),
  );
  for (const [path, json] of Object.entries(files))
    await page.route(`**/review-data/${path}?*`, (r) => r.fulfill({ json }));
  await page.route("https://tiles.openfreemap.org/**", (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
  await page.route("https://photon.komoot.io/**", (r) =>
    r.fulfill({ json: { features: [] } }),
  );
}

test("dam card states the baseline date and measured daily release without a guessed arrival time", async ({
  page,
}) => {
  const dams = read("bkk/dams.json");
  dams.fetched_at = NOW;
  dams.report_date = "2026-09-30";
  dams.previous_report_date = "2026-09-29";
  dams.dams = [{ ...dams.dams[0], outflow_mcm: 3, previous_outflow_mcm: 2 }];
  await prepare(page, { "water/dams.json": dams });
  await page.goto("/");
  const card = page.getByTestId("dams");
  await expect(card).toContainText("ระบายเพิ่มมาก จาก 2 (29 ก.ย.)");
  await expect(card).toContainText("ล้าน ลบ.ม.");
  await expect(card).toContainText(/ทดลอง/);
  await expect(card).not.toContainText(/ถึงกรุงเทพ.*ชั่วโมง/);
});

test("M35: refetching yesterday's situation must not remove its past-report warning", async ({
  page,
}) => {
  const news = read("bkk/news.json");
  Object.assign(news, {
    fetched_at: NOW,
    subject_th: "รายงานสถานการณ์ประจำวันอังคารที่ 29 กันยายน 2569",
    text_th:
      "วันที่ 29 กันยายน 2569 เวลา 17.00 น. /พื้นที่ กทม.ไม่พบกลุ่มฝน / อุณหภูมิที่สำนักการระบายน้ำ 31 องศาเซลเซียส ความชื้นสัมพัทธ์ 71%",
    created_at: "2026-09-29T00:00:00+07:00",
    updated_at: "2026-09-29T17:00:00+07:00",
  });
  await prepare(page, { "bkk/news.json": news });
  await page.goto("/");
  const card = page.getByTestId("situation");
  await expect(card).toBeVisible();
  await expect(card).toContainText(
    /รายงานย้อนหลัง|ไม่ใช่สถานการณ์ปัจจุบัน|ไม่ใช่ข้อมูลเรียลไทม์/,
  );
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`rain bulletin uses readable bullets and keeps office readings collapsed at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const news = read("bkk/news.json");
    news.fetched_at = NOW;
    news.text_th =
      "วันที่ 30 กันยายน 2569 เวลา 10.00 น. /พื้นที่ กทม.ไม่พบกลุ่มฝน / อุณหภูมิที่สำนักการระบายน้ำ 31 องศาเซลเซียส ความชื้นสัมพัทธ์ 69%";
    await prepare(page, { "bkk/news.json": news });
    await page.goto("/");
    const card = page.getByTestId("situation");
    const bullets = card.locator("ul");
    await expect(bullets.locator("li")).toHaveCount(2);
    await expect(bullets).toContainText("ไม่พบกลุ่มฝนในพื้นที่ กทม.");
    await expect(bullets).toContainText("30 ก.ย. 2569");
    await expect(bullets).toContainText("10:00");
    await expect(bullets).not.toContainText(/อุณหภูมิ|ความชื้น/);
    await expect(card.locator("details p")).not.toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `apps/web/test-results/situation-${viewport.width}.png`,
    });
    await card.locator("summary").click();
    await expect(card.locator("details p")).toContainText(
      "ความชื้นสัมพัทธ์ 69%",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("unknown report time is not silently replaced with fetch or edit time", async ({
  page,
}) => {
  const news = read("bkk/news.json");
  news.fetched_at = NOW;
  news.updated_at = NOW;
  news.text_th = "ฝนเล็กน้อยบางพื้นที่";
  await prepare(page, { "bkk/news.json": news });
  await page.goto("/");
  const card = page.getByTestId("situation");
  await expect(card).toContainText("ยังระบุเวลารายงานไม่ได้");
  await expect(card.locator("ul")).toContainText("เวลารายงาน: ไม่ทราบ");
});
