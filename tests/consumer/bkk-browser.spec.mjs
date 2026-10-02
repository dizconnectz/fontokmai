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

// the side panel's sections fold to their heading line (Claude, 2026-10-01): open one before reading its list
async function unfold(page, id) {
  await page.locator(`#${id}`).waitFor();
  const fold = page.locator(`#${id} > details`);
  if ((await fold.count()) && !(await fold.evaluate((element) => element.open)))
    await page.locator(`#${id} > details > summary`).click();
}

const read = (file) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${file}`, import.meta.url),
      "utf8",
    ),
  );
const NOW = "2026-09-27T17:21:00+07:00";

async function prepare(page, files, advanceClock = false) {
  const manifest = read("active/manifest.json");
  manifest.generated_at = NOW;
  manifest.files = [
    { path: "alerts.json", sha256: "a".repeat(64), size: 1, revision: 1 },
  ];
  // Manual relay files have no bma_dxs source status, per D31.
  manifest.source_status = manifest.source_status.filter(
    (source) => source.source_id !== "bma_dxs",
  );
  for (const [path, file] of Object.entries(files)) {
    manifest.files.push({ path, sha256: "b".repeat(64), size: 1, revision: 1 });
    await page.route(`**/review-data/${path}?*`, (route) =>
      route.fulfill({ json: file }),
    );
  }
  // Keep MapLibre's animation clock real except in the explicit clock-expiry test.
  if (advanceClock) await page.clock.install({ time: new Date(NOW) });
  else await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { DATA_BASE_URL: "/review-data/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/review-data/manifest.json?*", (route) =>
    route.fulfill({ json: manifest }),
  );
  const alerts = read("active/alerts.json");
  alerts.alerts = [];
  await page.route("**/review-data/alerts.json?*", (route) =>
    route.fulfill({ json: alerts }),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#eef3ee" },
          },
        ],
      },
    }),
  );
  await page.route("https://photon.komoot.io/**", (route) =>
    route.fulfill({ json: { features: [] } }),
  );
}

test("DXS manual relay is displayed without a source status, with MSL and dated old-data notes", async ({
  page,
}) => {
  const water = read("bkk/water.json");
  const rain = read("bkk/rain.json");
  rain.gauges[0].location = water.stations[0].location;
  rain.gauges[0].rain_1h_mm = 0;
  await prepare(page, { "bkk/water.json": water, "bkk/rain.json": rain });
  await page.goto("/?pin=13.7065,100.5703");
  const card = page.getByTestId("pin-card");
  await expect(card).toContainText("สูงกว่าระดับน้ำทะเล 1.78 ม.");
  await expect(card).toContainText("ไม่ใช่ความลึกน้ำท่วมบนถนน");
  await expect(card).toContainText("ชั่วโมงล่าสุดไม่มีฝน");
  await expect(card).toContainText(/ไม่ใช่ข้อมูลเรียลไทม์.*26.*2569/);
});

test("another day's road report is not shown in the side panel", async ({
  page,
}) => {
  // Claude, user 2026-10-02: an empty or another day's report said nothing, so the section shows only roads of
  // today's report (it was collapsed behind its Thai date before)
  await prepare(page, { "bkk/flooding.json": read("bkk/flooding.json") });
  await page.goto("/");
  await expect(page.getByTestId("status-bar")).toBeVisible();
  await expect(
    page.locator("summary").filter({ hasText: /26.*2569/ }),
  ).toHaveCount(0);
  await expect(page.getByTestId("road-flooding")).toHaveCount(0);
  await expect(page.locator("#panel")).not.toContainText("ถ.ทดสอบหนึ่ง");
});

test("DXS situation text is readable as plain text and is separate from TMD alerts", async ({
  page,
}) => {
  // Claude, user 2026-10-02: the card shows only a bulletin of today that names rain
  const news = read("bkk/news.json");
  news.text_th = news.text_th.replace(
    "วันที่ 26 กันยายน 2569 เวลา 17.00 น.",
    "วันที่ 27 กันยายน 2569 เวลา 15.00 น.",
  );
  await prepare(page, { "bkk/news.json": news });
  await page.goto("/");
  await unfold(page, "situation");
  await page
    .getByTestId("situation")
    .getByText("ข้อความต้นฉบับ", { exact: true })
    .click();
  await expect(page.getByText("รายงานสถานการณ์ทดสอบประจำวัน")).toBeVisible();
  await expect(
    page
      .getByTestId("situation")
      .locator("details.history-details")
      .getByText(/ฝนเล็กน้อย & ลมแรง/),
  ).toBeVisible();
  await expect(
    page.getByTestId("situation").getByText(/รายงานย้อนหลัง/),
  ).toBeVisible();
});

test("M15: a dam without coordinates remains available in the list", async ({
  page,
}) => {
  await prepare(page, { "water/dams.json": read("bkk/dams.json") });
  await page.goto("/");
  await unfold(page, "dams");
  await expect(page.getByText(/เขื่อนภูมิพล · น้ำ/)).toBeVisible();
  // contract 18: a dam without a place is listed (folded), never pinned at a guessed place
  await page.getByTestId("dams-others").locator("summary").click();
  await expect(page.getByText(/เขื่อนทดสอบไม่มีพิกัด/)).toBeVisible();
});

test("M16: fresh water does not hide the old-date label for stale rain at the same pin", async ({
  page,
}) => {
  const water = read("bkk/water.json");
  const rain = read("bkk/rain.json");
  water.fetched_at = NOW;
  water.stations[0].observed_at = NOW;
  rain.gauges[0].location = water.stations[0].location;
  await prepare(page, { "bkk/water.json": water, "bkk/rain.json": rain });
  await page.goto("/?pin=13.7065,100.5703");
  const card = page.getByTestId("pin-card");
  await expect(card).toContainText("ชั่วโมงล่าสุดฝนปานกลาง (12 มม.)");
  await expect(card).toContainText(/ไม่ใช่ข้อมูลเรียลไทม์.*26.*2569/);
});

test("M13: tapping a new water cluster expands it without creating an unrelated pin", async ({
  page,
}) => {
  const water = read("bkk/water.json");
  water.fetched_at = NOW;
  water.stations = [1, 2].map((n) => ({
    ...water.stations[0],
    code: `W${n}`,
    name_th: `สถานีทดสอบ${n}`,
    location: [101, 13.2],
    observed_at: NOW,
  }));
  await prepare(page, { "bkk/water.json": water });
  await page.goto("/");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await zoomForPins(page);
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // the bubble may be drawn after the mouse stops: move away and back until the map sees it
  await expect
    .poll(async () => {
      await page.mouse.move(x + 50, y);
      await page.mouse.move(x, y);
      return canvas.evaluate((el) => getComputedStyle(el).cursor);
    })
    .toBe("pointer");
  await page.mouse.click(x, y);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("pin-card")).not.toBeVisible();
  await expect(page).not.toHaveURL(/pin=/);
});

test("M14: an open tab removes a DOH report when its start becomes more than twelve hours old", async ({
  page,
}) => {
  const feed = read("live-floods/floods.json");
  feed.fetched_at = NOW;
  feed.reports = [
    {
      ...feed.reports[2],
      start: new Date(Date.parse(NOW) - 12 * 3600000 + 60000).toISOString(),
      stop: null,
    },
  ];
  await prepare(page, { "live/floods.json": feed }, true);
  await page.goto("/");
  await unfold(page, "floods-now");
  const report = page.getByRole("button", { name: /ทางหลวง 32/ });
  await expect(report).toBeVisible();
  await page.clock.fastForward(2 * 60000);
  await expect(report).not.toBeVisible();
});

for (const kind of ["dam", "weather"]) {
  test(`${kind} popup preserves source, units and dated old-data notes across themes`, async ({
    page,
  }) => {
    const file = read(
      kind === "dam" ? "bkk/dams.json" : "bkk/weather-today.json",
    );
    const key = kind === "dam" ? "dams" : "stations";
    file[key] = [{ ...file[key][0], location: [101, 13.2] }];
    if (kind === "dam") file.dams[0].outflow_mcm = null;
    else file.stations[0].rain_mm = 0;
    await prepare(page, {
      [kind === "dam" ? "water/dams.json" : "weather/today.json"]: file,
    });
    await page.goto("/");
    const canvas = page.locator(".maplibregl-canvas");
    await expect(canvas).toBeVisible();
    await zoomForPins(page);
    const box = await canvas.boundingBox();
    // Symbols anchor at their bottom, so click slightly above the coordinate.
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2 - 12;
    await expect
      .poll(async () => {
        await page.mouse.move(x + 50, y);
        await page.mouse.move(x, y);
        return canvas.evaluate((el) => getComputedStyle(el).cursor);
      })
      .toBe("pointer");
    await page.mouse.click(x, y);
    const popup = page.locator(".maplibregl-popup");
    // one link naming the source (the owner asked for no credit lines in popups)
    const credit = file.credit_th.replace(/\s*\(.*\)$/, "");
    await expect(
      popup.getByRole("link", { name: `ที่มา: ${credit} ↗` }),
    ).toBeVisible();
    await expect(popup).toContainText(/ไม่ใช่ข้อมูลเรียลไทม์.*26.*2569/);
    if (kind === "dam") {
      await expect(popup).toContainText("ยังไม่มีข้อมูล: การระบายน้ำ");
      await expect(popup).not.toContainText("ระบาย –");
    } else
      await expect(popup).toContainText("ฝน 24 ชม. ถึงรอบตรวจเช้า: ไม่มีฝน");
    await expect(popup.getByRole("link")).toHaveAttribute("rel", /noopener/);
    await page.getByRole("button", { name: "เปลี่ยนเป็นโหมดมืด" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(popup).toBeVisible();
    await popup.getByRole("button", { name: "Close popup" }).click();
    await expect(popup).toHaveCount(0);
    await expect
      .poll(async () => {
        await page.mouse.move(x + 50, y);
        await page.mouse.move(x, y);
        return canvas.evaluate((el) => getComputedStyle(el).cursor);
      })
      .toBe("pointer");
    await page.mouse.click(x, y);
    await expect(
      popup.getByRole("link", { name: `ที่มา: ${credit} ↗` }),
    ).toBeVisible();
    await expect(page.getByTestId("pin-card")).not.toBeVisible();
  });
}
