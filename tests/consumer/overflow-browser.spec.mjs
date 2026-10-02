import {
  test,
  expect,
} from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { readFileSync } from "node:fs";

// Claude, user 2026-10-02: ordinary pins show from zoom 8 (the first view shows only severe ones): zoom in first
async function zoomForPins(page) {
  const surface = page.getByTestId("map-surface");
  await expect(surface).toHaveAttribute("aria-busy", "false", {
    timeout: 15000,
  });
  // a place chosen in the panel flies there in 600 ms: let it land before reading the zoom
  await page.waitForTimeout(700);
  for (let step = 0; step < 6; step++) {
    const zoom = Number(await surface.getAttribute("data-zoom"));
    if (zoom >= 8) return;
    await page.getByRole("button", { name: "ขยายแผนที่" }).click();
    await expect
      .poll(async () => Number(await surface.getAttribute("data-zoom")))
      .toBeGreaterThan(zoom);
  }
}

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

const evidence = () => ({
  id: "reach-test",
  kind: "reported_reach",
  name_th: "คลองทดสอบช่วงที่มีรายงาน",
  verified: true,
  source_url: "https://example.com/evidence",
  credit_th: "ข้อมูลสมมติสำหรับทดสอบเท่านั้น",
  observed_at: "2026-09-30T10:30:00+07:00",
  status: "above_bank",
  geometry: {
    type: "LineString",
    coordinates: [
      [100.5, 13.75],
      [100.52, 13.75],
    ],
  },
});

async function clickMiddle(page) {
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await zoomForPins(page);
  const b = await canvas.boundingBox();
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  await expect
    .poll(async () => {
      await page.mouse.move(x, y + 50);
      await page.mouse.move(x, y);
      return canvas.evaluate((e) => getComputedStyle(e).cursor);
    })
    .toBe("pointer");
  await page.mouse.click(x, y);
}

test("verified reach is keyboard accessible, has a source popup and expires with the clock", async ({
  page,
}) => {
  const water = read("bkk/water.json");
  water.stations = [];
  water.bank_observations = [evidence()];
  await prepare(page, { "bkk/water.json": water });
  await page.goto("/");
  const card = page.getByTestId("bank-evidence");
  const button = card.getByRole("button");
  await expect(button).toContainText("ต้นทางรายงานน้ำเกินตลิ่งในช่วงนี้");
  await expect(
    page.locator('[aria-label="สีระดับน้ำเทียบตลิ่ง"]'),
  ).toContainText("เกิน");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("map-surface")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await clickMiddle(page);
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("รายงานเฉพาะช่วงเส้นที่แสดง");
  await expect(popup.getByRole("link")).toHaveAttribute(
    "href",
    "https://example.com/evidence",
  );
  await page.screenshot({ path: "apps/web/test-results/bank-reach.png" });
  await page.clock.setFixedTime(new Date("2026-09-30T11:31:00+07:00"));
  // useData ticks every 30 seconds; the evidence must age without a new data fetch.
  await page.clock.runFor(31_000);
  await expect(card).toContainText("ข้อมูลเกิน 60 นาที");
  await expect(popup).toContainText("ข้อมูลเกิน 60 นาที");
  await expect(card.locator(".bank-dot")).toHaveCSS(
    "background-color",
    "rgb(123, 133, 139)",
  );
  await page.getByRole("button", { name: "เปลี่ยนเป็นโหมดมืด" }).click();
  await button.click();
  await clickMiddle(page);
  await expect(page.locator(".maplibregl-popup")).toContainText(
    "ข้อมูลเกิน 60 นาที",
  );
});

test("bank colour key fits the phone map while point details are open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const water = read("bkk/water.json");
  water.stations = [];
  water.bank_observations = [evidence()];
  await prepare(page, { "bkk/water.json": water });
  await page.goto("/?pin=13.75,100.51");
  const key = page.locator('[aria-label="สีระดับน้ำเทียบตลิ่ง"]');
  await expect(key).toBeVisible();
  await expect(key).toContainText("ไม่ทราบ");
  const box = await key.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "apps/web/test-results/bank-mobile.png" });
});

test("legacy canal data does not produce a bank status or an empty card", async ({
  page,
}) => {
  const water = read("bkk/water.json");
  delete water.bank_observations;
  await prepare(page, { "bkk/water.json": water });
  await page.goto("/");
  await expect(page.getByTestId("map-surface")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByTestId("bank-evidence")).toHaveCount(0);
});
