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

async function prepare(page, old = false, floodAge = null) {
  const manifest = read("active/manifest.json");
  const forecast = read("forecast/rain.json");
  // Keep the alert snapshot fresh while only the forecast is stale.
  if (old)
    forecast.fetched_at = new Date(
      Date.parse(manifest.generated_at) - 13 * 3600000,
    ).toISOString();
  manifest.files = manifest.files.filter((f) => f.path === "alerts.json");
  manifest.files.push({
    path: "forecast/rain.json",
    sha256: "f".repeat(64),
    size: 1,
    revision: 1,
  });
  if (floodAge !== null) {
    const floods = read("live-floods/floods.json");
    floods.fetched_at = new Date(
      Date.parse(manifest.generated_at) - floodAge * 60000,
    ).toISOString();
    floods.reports = [];
    manifest.files.push({
      path: "live/floods.json",
      sha256: "e".repeat(64),
      size: 1,
      revision: 1,
    });
    await page.route("**/review-data/live/floods.json?*", (route) =>
      route.fulfill({ json: floods }),
    );
  }
  await page.clock.install({ time: new Date(manifest.generated_at) });
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { DATA_BASE_URL: "/review-data/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/review-data/manifest.json?*", (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route("**/review-data/alerts.json?*", (route) =>
    route.fulfill({ json: read("active/alerts.json") }),
  );
  await page.route("**/review-data/forecast/rain.json?*", (route) =>
    route.fulfill({ json: forecast }),
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

test("M6: future map alerts disclose that they only include alerts already issued", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/?pin=13.75,100.5");
  const slider = page.getByRole("slider", { name: "เลื่อนดูเวลาของแผนที่" });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", /^พยากรณ์/);
  await expect(page.locator(".stage")).toContainText(
    /เฉพาะประกาศที่ออกแล้ว|ประกาศที่เผยแพร่แล้ว/,
  );
});

test("M7: a stale forecast is labelled on the map even without opening a pin", async ({
  page,
}) => {
  await prepare(page, true);
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "เลื่อนดูเวลาของแผนที่" });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", /^พยากรณ์/);
  await expect(
    page.getByText("พยากรณ์ไม่อัปเดต", { exact: true }),
  ).toBeVisible();
});

test("an empty fresh flood feed does not claim that there is no flooding", async ({
  page,
}) => {
  await prepare(page, false, 0);
  await page.goto("/");
  await expect(
    page.getByText("ยังไม่มีรายงานที่ยังไม่หมดเวลา · ไม่ได้แปลว่าไม่มีน้ำท่วม"),
  ).toBeVisible();
});

test("an old flood feed remains labelled both on the summary and at a pin", async ({
  page,
}) => {
  await prepare(page, false, 46);
  await page.goto("/");
  await expect(page.getByText(/รายงานน้ำท่วมไม่อัปเดตตั้งแต่/)).toBeVisible();
  await page.goto("/?pin=13.75,100.5");
  await expect(
    page.getByTestId("pin-card").getByText(/รายงานน้ำท่วมไม่อัปเดตตั้งแต่/),
  ).toBeVisible();
});
