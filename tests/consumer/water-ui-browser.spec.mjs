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
const NOW = "2026-09-29T12:00:00+07:00";
const radar = (legend = []) => ({
  schema_version: "1",
  generation_id: "review-radar",
  name_th: "เรดาร์ทดสอบ",
  credit_th: "กรมอุตุนิยมวิทยา",
  source_url: "https://weather.tmd.go.th/composite/",
  coordinates: [
    [95, 22.5],
    [108, 22.5],
    [108, 4],
    [95, 4],
  ],
  projection: "EPSG:3857",
  legend_opacity: 1,
  legend,
  notes_th: [],
  frames: [
    { time: "2026-09-29T11:45:00+07:00", path: "radar/a.png" },
    { time: NOW, path: "radar/b.png" },
  ],
});

async function prepare(page, files = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  const manifest = read("active/manifest.json");
  manifest.generated_at = NOW;
  manifest.source_status = manifest.source_status.filter(
    (s) => s.source_id !== "bma_dxs",
  );
  const alerts = read("active/alerts.json");
  alerts.alerts = [];
  files = { "alerts.json": alerts, ...files };
  if (files["radar.json"])
    files["radar.json"].generation_id = manifest.generation_id;
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
    r.fulfill({
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
  await page.route("https://photon.komoot.io/**", (r) =>
    r.fulfill({ json: { features: [] } }),
  );
  await page.route("**/review-data/radar/*.png*", (r) => r.abort());
}

async function clickMiddleSymbol(page) {
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await zoomForPins(page);
  const b = await canvas.boundingBox();
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2 - 12;
  await expect
    .poll(async () => {
      await page.mouse.move(x + 50, y);
      await page.mouse.move(x, y);
      return canvas.evaluate((e) => getComputedStyle(e).cursor);
    })
    .toBe("pointer");
  await page.mouse.click(x, y);
}

for (const [running, total, phrase] of [
  [null, 4, null],
  [0, 4, "เครื่องสูบน้ำหยุดทั้ง 4 เครื่อง"],
  [2, 4, "เครื่องสูบน้ำเดินอยู่ 2 จาก 4 เครื่อง"],
  [5, 4, "เครื่องสูบน้ำเดินอยู่ 5 เครื่อง"],
  [0, null, null],
]) {
  test(`pump report running=${running}, total=${total} is not fabricated`, async ({
    page,
  }) => {
    const file = read("bkk/water.json");
    file.fetched_at = NOW;
    file.stations = [
      {
        ...file.stations[0],
        observed_at: NOW,
        location: [101, 13.2],
        pumps: total,
        pumps_running: running,
      },
    ];
    await prepare(page, { "bkk/water.json": file });
    await page.goto("/");
    await clickMiddleSymbol(page);
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible();
    await expect(popup).not.toContainText("5 จาก 4");
    if (phrase) await expect(popup).toContainText(phrase);
    else await expect(popup).not.toContainText("เครื่องสูบน้ำ");
  });
}

test("empty radar legend gives an explicit reading failure at a pin", async ({
  page,
}) => {
  await prepare(page, { "radar.json": radar() });
  await page.goto("/?pin=13.2,101");
  await expect(page.getByTestId("pin-card")).toContainText(
    "อ่านภาพเรดาร์ไม่สำเร็จ",
  );
  await expect(page.locator(".radar-gradient")).toHaveCount(0);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`mobile controls stay reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepare(page, {
      "radar.json": radar(),
      "bkk/water.json": read("bkk/water.json"),
      "bkk/rain.json": read("bkk/rain.json"),
      "water/dams.json": read("bkk/dams.json"),
      "weather/today.json": read("bkk/weather-today.json"),
      "forecast/rivers.json": read("forecast/rivers.json"),
    });
    await page.goto("/");
    const info = page.getByRole("button", {
      name: "คำอธิบายแผนที่",
      exact: true,
    });
    await expect(info).toBeVisible();
    await info.click();
    await expect(page.locator("#legend-pins")).toBeVisible();
    await page.getByRole("button", { name: "ย่อ", exact: true }).click();
    for (const name of [
      "ปักหมุดที่ตำแหน่งของฉัน",
      "ปักหมุดที่กลางแผนที่",
      "กลับไปดูแผนที่ประเทศไทย",
    ]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const b = await button.boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(24);
      expect(b.height).toBeGreaterThanOrEqual(24);
      await button.click({ trial: true });
    }
    await page.getByRole("button", { name: "ชั้นข้อมูล", exact: true }).click();
    const last = page.getByRole("button", {
      name: "แนวโน้มน้ำแม่น้ำ",
      exact: true,
    });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    const bounds = await page.locator(".layer-options").boundingBox();
    const time = await page.locator(".timeline").boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(time.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("mobile-water.png"),
      fullPage: true,
    });
  });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`legend touch target is at least 24px at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepare(page, { "water/dams.json": read("bkk/dams.json") });
    await page.goto("/");
    const info = page.getByRole("button", {
      name: "คำอธิบายแผนที่",
      exact: true,
    });
    await expect(info).toBeVisible();
    const size = await info.boundingBox();
    expect(size.width).toBeGreaterThanOrEqual(24);
    expect(size.height).toBeGreaterThanOrEqual(24);
  });
}

test("barrage popup links to RID without inventing reservoir or release values", async ({
  page,
}) => {
  await prepare(page, { "water/dams.json": read("bkk/dams.json") });
  await page.goto("/?pin=15.15935,100.17999");
  await page.getByRole("button", { name: "ปิดหมุด", exact: true }).click();
  await expect(page.getByTestId("barrages")).toHaveCount(0);
  await expect(page.getByTestId("map-surface")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await clickMiddleSymbol(page);
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("เขื่อนเจ้าพระยา");
  await expect(popup).toContainText("ยังไม่มีตัวเลขการระบายน้ำ");
  await expect(popup).not.toContainText("ล้าน ลบ.ม./วัน");
  await expect(popup.getByRole("link")).toHaveAttribute(
    "href",
    "https://hyd-app-db.rid.go.th/hydro1d.html",
  );
  await expect(popup.getByRole("link")).toHaveAttribute("rel", /noopener/);
});

test("dam bars clamp overflow, show missing values, and limit downstream text to 80 percent", async ({
  page,
}) => {
  const file = read("bkk/dams.json");
  file.fetched_at = NOW;
  file.report_date = "2026-09-29";
  file.dams = [80, 110, 79, null].map((percent, n) => ({
    ...file.dams[0],
    id: n === 0 ? file.dams[0].id : `review-${n}`,
    name_th: `เขื่อนตรวจ${n}`,
    percent,
    downstream_th: `ท้ายน้ำ: จังหวัดตรวจ${n}`,
  }));
  await prepare(page, { "water/dams.json": file });
  await page.goto("/");
  await unfold(page, "dams");
  const card = page.getByTestId("dams");
  await page.getByTestId("dams-others").locator("summary").click();
  for (const [n, width, downstream] of [
    [0, "80%", true],
    [1, "100%", true],
    [2, "79%", false],
    [3, null, false],
  ]) {
    const line = card
      .locator(".dam-line")
      .filter({ hasText: `เขื่อนตรวจ${n}` });
    if (width === null) await expect(line.locator(".dam-bar")).toHaveCount(0);
    else
      await expect(line.locator(".dam-fill")).toHaveAttribute(
        "style",
        new RegExp(`width: ${width}`),
      );
    await expect(line.locator(".dam-downstream")).toHaveCount(
      downstream ? 1 : 0,
    );
  }
  await expect(
    card.locator(".dam-line").filter({ hasText: "เขื่อนตรวจ3" }),
  ).not.toContainText("ไม่มีตัวเลข");
  await expect(card).toContainText("ไม่ใช่การพยากรณ์ว่าจะท่วม");
});

test("report clock and DXS file clock are distinct from the fresh manifest clock", async ({
  page,
}) => {
  const water = read("bkk/water.json");
  water.fetched_at = "2026-09-29T11:40:00+07:00";
  const floods = read("live-floods/floods.json");
  floods.fetched_at = "2026-09-29T11:55:00+07:00";
  floods.reports = [
    {
      ...floods.reports[0],
      title_th: "รายงานตรวจเวลา",
      road_th: null,
      start: "2026-09-29T11:30:00+07:00",
      stop: null,
    },
  ];
  await prepare(page, { "bkk/water.json": water, "live/floods.json": floods });
  await page.goto("/");
  await unfold(page, "floods-now");
  await expect(
    page.getByRole("button", { name: /รายงานตรวจเวลา/ }),
  ).toContainText("วันนี้ 11:30 น. (30 นาทีก่อน)");
  await expect(
    page.getByRole("region", { name: /รายงานน้ำท่วมตอนนี้/ }),
  ).toContainText(/ข้อมูลถึง.*11:55/);
});
