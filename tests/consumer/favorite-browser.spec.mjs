import {
  test,
  expect,
} from "../../apps/web/node_modules/@playwright/test/index.mjs";
import AxeBuilder from "../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs";
import { readFileSync } from "node:fs";

const NOW = Date.parse("2026-09-26T12:00:00+07:00");
const KEY = "fontokmai.favorite.v1";
const FAVORITE = { location: [100.5, 13.75], label: "บ้านของฉัน" };
const read = (path) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${path}`, import.meta.url),
      "utf8",
    ),
  );

function forecastFixture() {
  const forecast = read("forecast/rain.json");
  // Different grid cells must not be confused when the selected pin changes.
  forecast.day_rain = forecast.days.map(() => forecast.points.map(() => 910));
  [1, 240, 0, 460, null, 120, 5].forEach((rain, day) => {
    forecast.day_rain[day][4] = rain;
  });
  forecast.day_probability[0][4] = 40;
  forecast.day_probability[2][4] = 0;
  forecast.day_probability[4][4] = null;
  return forecast;
}

async function prepare(
  page,
  { saved = true, path = "/", forecast = forecastFixture(), status = 200 } = {},
) {
  const manifest = read("active/manifest.json");
  manifest.generated_at = new Date(NOW).toISOString();
  const alerts = read("active/alerts.json");
  alerts.alerts = [];
  const files = {
    "alerts.json": alerts,
    ...(forecast ? { "forecast/rain.json": forecast } : {}),
  };
  manifest.files = Object.keys(files).map((path) => ({
    path,
    sha256: "a".repeat(64),
    revision: 1,
    size: 1,
  }));
  const response = { forecast, status };
  await page.clock.install({ time: new Date(NOW) });
  if (saved)
    await page.addInitScript(
      ({ key, favorite }) =>
        localStorage.setItem(key, JSON.stringify(favorite)),
      { key: KEY, favorite: FAVORITE },
    );
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { DATA_BASE_URL: "/review-data/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/review-data/manifest.json?*", (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route("**/review-data/alerts.json?*", (route) =>
    route.fulfill({ json: alerts }),
  );
  await page.route("**/review-data/forecast/rain.json?*", (route) =>
    route.fulfill({ status: response.status, json: response.forecast }),
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
  await page.goto(path);
  return { manifest, response };
}

test("saving a place keeps its seven-day forecast through other pins, closing details and reload, until removed", async ({
  page,
}) => {
  await prepare(page, { saved: false, path: "/?pin=13.75,100.5" });
  const favorite = page.getByTestId("favorite-forecast");
  await expect(favorite).toHaveCount(0);
  await page
    .getByRole("button", { name: "ตั้งเป็นที่ของฉัน", exact: true })
    .click();
  await expect(favorite.locator("tbody tr")).toHaveCount(7);
  await expect(favorite.locator("tbody tr").first()).toContainText("0.1 มม.");
  // The pin's seven days should not duplicate the saved place's forecast.
  await expect(page.getByTestId("forecast-days")).toHaveCount(0);
  await page.goto("/?pin=13.5,100.25");
  await expect(
    page.getByTestId("forecast-days").locator("li").first(),
  ).toContainText("91 มม.");
  await expect(favorite.locator("tbody tr").first()).toContainText("0.1 มม.");
  await page.getByRole("button", { name: "ปิดหมุด" }).click();
  await expect(favorite.locator("tbody tr")).toHaveCount(7);
  await page.reload();
  await expect(favorite.locator("tbody tr").first()).toContainText("0.1 มม.");
  await favorite.getByRole("button").click();
  await expect(page).toHaveURL(/pin=13\.75000(?:,|%2C)100\.50000/);
  await page.getByRole("button", { name: "ที่ของฉัน", exact: true }).click();
  await expect(favorite).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), KEY),
  ).toBeNull();
});

test("missing rain and probability stay distinct from zero and stale forecasts keep their timestamp", async ({
  page,
}) => {
  const forecast = forecastFixture();
  forecast.fetched_at = "2026-09-25T20:00:00+07:00";
  await prepare(page, { forecast });
  const card = page.getByTestId("favorite-forecast");
  const rows = card.locator("tbody tr");
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toContainText("ฝนเล็กน้อย");
  await expect(rows.nth(0)).toContainText("0.1 มม.");
  await expect(rows.nth(2)).toContainText("ไม่มีฝน");
  await expect(rows.nth(2).locator("td").last()).toHaveText("0%");
  await expect(rows.nth(4)).toContainText("ไม่มีข้อมูล");
  await expect(rows.nth(4)).not.toContainText("0 มม.");
  await expect(rows.nth(4).getByLabel("ไม่มีข้อมูลโอกาสฝน")).toBeVisible();
  await expect(card).toContainText("พยากรณ์ไม่อัปเดต");
  await expect(card).toContainText("25 ก.ย. 2569 20:00");
  await expect(card.getByRole("link")).toHaveAttribute(
    "href",
    "https://open-meteo.com/",
  );
});

for (const scenario of ["missing", "error", "outside"]) {
  test(`a saved place with ${scenario} forecast does not claim dry weather`, async ({
    page,
  }) => {
    const forecast = forecastFixture();
    if (scenario === "outside") forecast.lattice.west = 101.5;
    await prepare(page, {
      forecast: scenario === "missing" ? null : forecast,
      status: scenario === "error" ? 503 : 200,
    });
    const card = page.getByTestId("favorite-forecast");
    await expect(card).toContainText(
      scenario === "outside"
        ? "จุดนี้อยู่นอกพื้นที่พยากรณ์ที่มีข้อมูล"
        : "ยังไม่มีข้อมูลพยากรณ์ของที่นี่",
    );
    await expect(card.locator("tbody tr")).toHaveCount(0);
    await expect(card).not.toContainText("ไม่มีฝน");
  });
}

test("Thai midnight shifts the seven calendar days and leaves the unavailable last day unknown", async ({
  page,
}) => {
  await prepare(page);
  const card = page.getByTestId("favorite-forecast");
  await expect(card.locator("tbody tr")).toHaveCount(7);
  await page.clock.fastForward(12 * 3600000 + 60000);
  await expect(card.locator("tbody tr").first()).toHaveAttribute(
    "data-date",
    "2026-09-27",
  );
  await expect(card.locator("tbody tr").first()).toContainText("24 มม.");
  await expect(card.locator("tbody tr").last()).toHaveAttribute(
    "data-date",
    "2026-10-03",
  );
  await expect(card.locator("tbody tr").last()).toContainText("ไม่มีข้อมูล");
  await expect(card.locator("tbody tr")).toHaveCount(7);
});

test("a failed new file is labelled even before twelve hours, and the card updates when it recovers", async ({
  page,
}) => {
  const { manifest, response } = await prepare(page);
  const card = page.getByTestId("favorite-forecast");
  await expect(card.locator("tbody tr").first()).toContainText("0.1 มม.");
  manifest.files.find((file) => file.path === "forecast/rain.json").sha256 =
    "b".repeat(64);
  response.status = 503;
  await page.clock.fastForward(60000);
  await expect(card).toContainText("พยากรณ์ไม่อัปเดต");
  await expect(card.locator("tbody tr").first()).toContainText("0.1 มม.");
  response.status = 200;
  response.forecast.day_rain[0][4] = 150;
  response.forecast.fetched_at = "2026-09-26T12:01:00+07:00";
  await page.clock.fastForward(60000);
  await expect(card.locator("tbody tr").first()).toContainText("15 มม.");
  await expect(card).not.toContainText("พยากรณ์ไม่อัปเดต");
  await expect(card).toContainText("12:01");
});

for (const colorScheme of ["light", "dark"]) {
  test(`the compact favorite is readable with a keyboard and on narrow screens in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await prepare(page);
    const card = page.getByTestId("favorite-forecast");
    await expect(card.locator("tbody tr")).toHaveCount(7);
    await page.emulateMedia({ colorScheme });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await card.scrollIntoViewIfNeeded();
      const overflow = await card.evaluate(
        (el) => el.scrollWidth > el.clientWidth,
      );
      expect(overflow).toBe(false);
      const report = await new AxeBuilder({ page })
        .include('[data-testid="favorite-forecast"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(report.violations).toEqual([]);
      if (width !== 320)
        await card.screenshot({
          path: testInfo.outputPath(`favorite-${width}-${colorScheme}.png`),
        });
    }
    const button = card.getByRole("button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/pin=13\.75000(?:,|%2C)100\.50000/);
    await page.keyboard.press("Tab");
    await expect(card.getByRole("link")).toBeFocused();
  });
}
