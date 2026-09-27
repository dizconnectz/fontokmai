import {
  test,
  expect,
} from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { readFileSync } from "node:fs";

const read = (path) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${path}`, import.meta.url),
      "utf8",
    ),
  );
const NOW = Date.parse("2026-09-27T11:42:00+07:00");

async function prepare(page, files, now = NOW, ticking = false) {
  const manifest = read("active/manifest.json");
  manifest.generated_at = new Date(now).toISOString();
  const alerts = read("active/alerts.json");
  alerts.alerts = [];
  const all = { "alerts.json": alerts, ...files };
  manifest.files = Object.keys(all).map((path) => ({
    path,
    sha256: "a".repeat(64),
    size: 1,
    revision: 1,
  }));
  if (ticking) await page.clock.install({ time: new Date(now) });
  else await page.clock.setFixedTime(new Date(now));
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { DATA_BASE_URL: "/review-data/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/review-data/manifest.json?*", (route) =>
    route.fulfill({ json: manifest }),
  );
  for (const [path, file] of Object.entries(all)) {
    await page.route(`**/review-data/${path}?*`, (route) =>
      route.fulfill({ json: file }),
    );
  }
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

function riverFile() {
  const file = read("forecast/rivers.json");
  file.points = [{ ...file.points[0], location: [101, 13.2] }];
  return file;
}

async function openRiver(page) {
  await page.goto("/");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2 - 12;
  await expect
    .poll(async () => {
      await page.mouse.move(x + 50, y);
      await page.mouse.move(x, y);
      return canvas.evaluate((el) => getComputedStyle(el).cursor);
    })
    .toBe("pointer");
  await page.mouse.click(x, y);
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("ค่าจากแบบจำลอง");
  return popup;
}

test("river popup distinguishes the model from a measured level and links to its source", async ({
  page,
}) => {
  const file = riverFile();
  await prepare(page, { "forecast/rivers.json": file });
  const popup = await openRiver(page);
  await expect(popup).toContainText("ไม่ใช่ระดับน้ำที่วัดจริง");
  await expect(popup).not.toContainText(/m³|ลบ\.ม\.\/วินาที/);
  await expect(popup.getByRole("link")).toHaveAttribute(
    "href",
    file.source_url,
  );
  await expect(popup.getByRole("link")).toHaveAttribute("rel", /noopener/);
});

test("a river file older than 36 hours is labelled when its popup opens", async ({
  page,
}) => {
  const file = riverFile();
  await prepare(
    page,
    { "forecast/rivers.json": file },
    Date.parse(file.fetched_at) + 37 * 3600000,
  );
  const popup = await openRiver(page);
  await expect(popup).toContainText("พยากรณ์ไม่อัปเดต");
});

test("M17: an expired flood popup is removed even while another report remains", async ({
  page,
}) => {
  const feed = read("live-floods/floods.json");
  feed.fetched_at = new Date(NOW).toISOString();
  const report = {
    ...feed.reports[2],
    stop: null,
    title_th: "รายงานเก่าใกล้ครบสิบสองชั่วโมง",
  };
  report.start = new Date(NOW - 12 * 3600000 + 60000).toISOString();
  feed.reports = [
    report,
    {
      ...report,
      id: "still-fresh",
      title_th: "รายงานใหม่ที่ต้องคงอยู่",
      start: new Date(NOW - 60000).toISOString(),
      location: [102, 15],
    },
  ];
  await prepare(page, { "live/floods.json": feed }, NOW, true);
  await page.goto("/");
  await page
    .getByRole("button", { name: /รายงานเก่าใกล้ครบสิบสองชั่วโมง/ })
    .click();
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText(report.title_th);
  await page.clock.fastForward(2 * 60000);
  await expect(
    page.getByRole("button", { name: /รายงานเก่าใกล้ครบสิบสองชั่วโมง/ }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /รายงานใหม่ที่ต้องคงอยู่/ }),
  ).toBeVisible();
  test.fail(
    true,
    "M17: only an empty layer closes the expired report's popup at 8aed643",
  );
  await expect(popup).not.toBeVisible();
});

test("M20: an already open river popup gains its stale label at the 36-hour cutoff", async ({
  page,
}) => {
  const file = riverFile();
  const now = Date.parse(file.fetched_at) + 36 * 3600000 - 60000;
  await prepare(page, { "forecast/rivers.json": file }, now, true);
  const popup = await openRiver(page);
  await expect(popup).not.toContainText("พยากรณ์ไม่อัปเดต");
  await page.clock.fastForward(2 * 60000);
  // Closing outdated content is also acceptable; it must not remain silently current.
  test.fail(
    true,
    "M20: the popup captures its opening time instead of refreshing its age at 8aed643",
  );
  await expect
    .poll(
      async () =>
        (await popup.count()) === 0 ||
        (await popup.innerText()).includes("พยากรณ์ไม่อัปเดต"),
    )
    .toBe(true);
});

test("M21: the chart's last-day label matches the actual delivered forecast horizon", async ({
  page,
}) => {
  const file = riverFile();
  await prepare(page, { "forecast/rivers.json": file });
  const popup = await openRiver(page);
  const daysAhead =
    (Date.parse(file.days.at(-1)) - Date.parse("2026-09-27")) / 86400000;
  const labels = popup.locator("svg text");
  test.fail(
    true,
    "M21: a fixed +30 label is one day beyond the example's last forecast date at 8aed643",
  );
  await expect(labels.last()).toHaveText(`+${daysAhead} วัน`);
});
