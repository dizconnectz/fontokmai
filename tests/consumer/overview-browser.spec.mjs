import {
  test,
  expect,
} from "../../apps/web/node_modules/@playwright/test/index.mjs";
import AxeBuilder from "../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs";
import { readFileSync } from "node:fs";

// the side panel's sections fold to their heading line (Claude, 2026-10-01): open one before reading its list
async function unfold(page, id) {
  const fold = page.locator(`#${id} > details`);
  if (!(await fold.evaluate((element) => element.open)))
    await page.locator(`#${id} > details > summary`).click();
}

const read = (path) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${path}`, import.meta.url),
      "utf8",
    ),
  );
const NOW = Date.parse("2026-09-26T17:30:00+07:00");
const MIN = 60000;

async function prepare(page, overview, extra = {}, ticking = false) {
  const manifest = read("active/manifest.json");
  manifest.generated_at = new Date(NOW).toISOString();
  const alerts = read("active/alerts.json");
  alerts.alerts = [];
  const files = {
    "alerts.json": alerts,
    "summary/overview.json": overview,
    ...extra,
  };
  manifest.files = Object.keys(files).map((path) => ({
    path,
    sha256: "a".repeat(64),
    size: 1,
    revision: 1,
  }));
  if (ticking) await page.clock.install({ time: new Date(NOW) });
  else await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { DATA_BASE_URL: "/review-data/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/review-data/manifest.json?*", (route) =>
    route.fulfill({ json: manifest }),
  );
  for (const [path, file] of Object.entries(files))
    await page.route(`**/review-data/${path}?*`, (route) =>
      route.fulfill({ json: file }),
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
  await page.goto("/");
  await expect(page.getByTestId("summary")).toBeVisible();
}

test("an open summary labels itself after 45 minutes and hides its places after three hours", async ({
  page,
}) => {
  await prepare(page, read("overview/overview.json"), {}, true);
  const card = page.getByTestId("summary");
  await expect(card).not.toContainText("สรุปนี้ไม่ได้อัปเดต");
  await page.clock.fastForward(46 * MIN);
  await expect(card).toContainText("สรุปนี้ไม่ได้อัปเดต");
  await expect(card.locator(".summary-item").first()).toBeVisible();
  await page.clock.fastForward(135 * MIN);
  await expect(card).toContainText("เก่าเกินไปจึงไม่แสดงรายการ");
  await expect(card.locator(".summary-item")).toHaveCount(0);
});

test("an empty summary explicitly does not mean safe and lists unavailable inputs", async ({
  page,
}) => {
  const file = read("overview/overview.json");
  file.items = [];
  file.inputs = [{ name_th: "ฝนที่ยังไม่ได้วัด", status: "missing", at: null }];
  await prepare(page, file);
  const card = page.getByTestId("summary");
  await expect(card).toContainText("ไม่ได้แปลว่าปลอดภัย");
  await expect(card).toContainText("ฝนที่ยังไม่ได้วัด");
  await expect(card).toContainText("ทดลอง");
  await expect(card).toContainText("ไม่ใช่ประกาศทางการ");
});

test("summary badges are driven by live provincial alerts and disappear on expiry", async ({
  page,
}) => {
  const overview = read("overview/overview.json");
  overview.items = [
    overview.items[0],
    { ...overview.items[0], place_th: "จ.ปทุมธานี", province_code: "13" },
  ];
  const alerts = read("active/alerts.json");
  alerts.tombstones = [];
  alerts.alerts = [
    {
      ...alerts.alerts[0],
      sent: new Date(NOW - MIN).toISOString(),
      effective: new Date(NOW - MIN).toISOString(),
      expires: new Date(NOW + MIN).toISOString(),
      lifecycle_status: "active",
      targets: [{ kind: "province", code: "TH-10" }],
    },
  ];
  await prepare(page, overview, { "alerts.json": alerts }, true);
  const card = page.getByTestId("summary");
  await expect(card.locator(".level-chip")).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: /จ.ปทุมธานี/ }),
  ).not.toContainText("มีประกาศ");
  await page.clock.fastForward(2 * MIN);
  await expect(card.locator(".level-chip")).toHaveCount(0);
});

test("M27: summary does not keep a cluster after all reports pass D33's twelve-hour limit", async ({
  page,
}) => {
  const file = read("overview/overview.json");
  const at = new Date(NOW - 12 * 3600000 + MIN).toISOString();
  file.items = [
    {
      ...file.items[1],
      place_th: "พื้นที่รายงานใกล้หมดอายุ",
      reasons: [
        { ...file.items[1].reasons[0], at, text_th: "มีรายงานน้ำท่วม 2 จุด" },
      ],
    },
  ];
  const floods = read("live-floods/floods.json");
  floods.fetched_at = new Date(NOW).toISOString();
  floods.reports = [0, 1].map((n) => ({
    ...floods.reports[0],
    id: `expiry-${n}`,
    start: at,
    stop: null,
    road_th: null,
    title_th: `รายงานหมดอายุหมายเลข ${n}`,
  }));
  await prepare(page, file, { "live/floods.json": floods }, true);
  await unfold(page, "floods-now");
  const item = page
    .getByTestId("summary")
    .getByRole("button", { name: /พื้นที่รายงานใกล้หมดอายุ/ });
  await expect(item).toBeVisible();
  await expect(
    page.getByRole("button", { name: /รายงานหมดอายุหมายเลข 0/ }),
  ).toBeVisible();
  await page.clock.fastForward(2 * MIN);
  await expect(
    page.getByRole("button", { name: /รายงานหมดอายุหมายเลข 0/ }),
  ).toHaveCount(0);
  await expect(item).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`summary, map key and all dam groups are keyboard accessible and pass axe at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const overview = read("overview/overview.json");
    const item = overview.items[0];
    overview.items = Array.from({ length: 40 }, (_, i) => ({
      ...item,
      place_th: `พื้นที่ทดสอบ ${i + 1}`,
    }));
    const dams = read("bkk/dams.json");
    dams.dams.push({
      ...dams.dams[0],
      id: "full-test",
      name_th: "เขื่อนเกินความจุทดสอบ",
      percent: 100.15,
    });
    await prepare(page, overview, { "water/dams.json": dams });
    await unfold(page, "dams");
    const card = page.getByTestId("summary");
    await expect(card).toContainText("ต้องระวังตอนนี้ 40 แห่ง");
    await expect(card.locator(".summary-item")).toHaveCount(5);
    const more = card.locator("button.link-button");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".summary-item")).toHaveCount(40);
    await expect(more).toBeFocused();
    await page.keyboard.press("Enter");
    const key = page.locator(".legend-toggle");
    await expect(key).toHaveAccessibleName("ความหมายหมุด");
    const keyBox = await key.boundingBox();
    if (width === 390) {
      expect(keyBox.width).toBeGreaterThanOrEqual(24);
      expect(keyBox.height).toBeGreaterThanOrEqual(24);
    }
    await key.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("#legend-pins")).toBeVisible();
    await expect(key).toHaveAttribute("aria-expanded", "true");
    const damCard = page.getByTestId("dams");
    await expect(
      damCard.getByRole("button", { name: /เขื่อนเกินความจุทดสอบ/ }),
    ).toBeVisible();
    const fold = page.getByTestId("dams-others").locator("summary");
    await fold.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("dams-others")).toHaveAttribute("open", "");
    await expect(damCard).toContainText("เขื่อนทดสอบไม่มีพิกัด");
    const result = await new AxeBuilder({ page })
      .include('[data-testid="summary"]')
      .include('[data-testid="dams"]')
      .include(".map-legend")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`overview-${width}.png`),
      fullPage: true,
    });
    const place = card.locator(".summary-item").first();
    await place.focus();
    await page.keyboard.press("Enter");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("pin-card")).toHaveCount(0);
  });
}

test("M28: the dark summary expansion button meets text contrast", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const file = read("overview/overview.json");
  file.items = Array.from({ length: 6 }, (_, n) => ({
    ...file.items[0],
    place_th: `พื้นที่ทดสอบ ${n}`,
  }));
  await prepare(page, file);
  const button = page
    .getByTestId("summary")
    .getByRole("button", { name: "ดูทั้งหมด", exact: true });
  await expect(button).toBeVisible();
  await page.getByRole("button", { name: "เปลี่ยนเป็นโหมดมืด" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const result = await new AxeBuilder({ page })
    .include('[data-testid="summary"] .link-button')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations.filter((v) => v.id !== "color-contrast")).toEqual(
    [],
  );
  await test.info().attach("dark-contrast", {
    body: JSON.stringify(result.violations),
    contentType: "application/json",
  });
  await page.screenshot({
    path: test.info().outputPath("overview-dark-390.png"),
    fullPage: true,
  });
  expect(result.violations).toEqual([]);
});
