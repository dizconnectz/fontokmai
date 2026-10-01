import {
  test,
  expect,
} from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { readFileSync } from "node:fs";

const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${name}`, import.meta.url),
      "utf8",
    ),
  );
const NOW = "2026-10-01T12:00:00+07:00";
const IDS = ["200101", "200102", "100107", "100301"];
const NAMES = [
  "เขื่อนภูมิพล",
  "เขื่อนสิริกิติ์",
  "เขื่อนแควน้อยบำรุงแดน",
  "เขื่อนป่าสักชลสิทธิ์",
];
const seed = read("bkk/dams.json");
const missingDams = () =>
  IDS.map((id, n) => ({
    ...seed.dams[0],
    id,
    name_th: NAMES[n],
    location: [100 + n / 10, 14],
    percent: null,
    volume_mcm: null,
    inflow_mcm: null,
    outflow_mcm: null,
    previous_outflow_mcm: 9.94,
  }));
const report = (dams) => ({
  ...seed,
  dams,
  fetched_at: NOW,
  report_date: "2026-10-01",
  previous_report_date: "2026-09-30",
});

async function clickMiddleSymbol(page) {
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
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

async function prepare(page, file) {
  const state = { file, revision: 1 };
  await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/config.json", (r) =>
    r.fulfill({
      json: { DATA_BASE_URL: "/dam-review/", DATA_MODE: "example" },
    }),
  );
  await page.route("**/dam-review/manifest.json?*", (r) => {
    const manifest = read("active/manifest.json");
    manifest.generation_id = `dams-${state.revision}`;
    manifest.generated_at = NOW;
    manifest.source_status = manifest.source_status.filter(
      (s) => s.source_id !== "bma_dxs",
    );
    manifest.files = ["alerts.json", "water/dams.json"].map((path) => ({
      path,
      revision: state.revision,
      sha256: String(state.revision).repeat(64),
      size: 1,
    }));
    return r.fulfill({ json: manifest });
  });
  await page.route("**/dam-review/alerts.json?*", (r) => {
    const alerts = read("active/alerts.json");
    alerts.alerts = [];
    alerts.generation_id = `dams-${state.revision}`;
    return r.fulfill({ json: alerts });
  });
  await page.route("**/dam-review/water/dams.json?*", (r) =>
    r.fulfill({ json: state.file }),
  );
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
  return state;
}

for (const width of [1440, 390]) {
  test(`M38: four missing principal dams use one notice, not four empty cards at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await prepare(
      page,
      report([
        ...missingDams(),
        {
          ...seed.dams[0],
          id: "other",
          name_th: "เขื่อนที่มีตัวเลข",
          percent: 110,
        },
      ]),
    );
    await page.goto("/");
    const card = page.getByTestId("dams");
    await expect(page.getByTestId("dams-coverage")).toHaveText(
      "มีตัวเลขในรายงานนี้ 1 จาก 5 แห่ง",
    );
    await expect(page.getByTestId("dams-main-missing")).toContainText(
      "เขื่อนหลัก 4 แห่ง",
    );
    await expect(card.locator(".dam-line")).toHaveCount(1);
    // no per-dam placeholder (the old "· ไม่มีตัวเลข" head) or dash rows; the one notice may say what is missing
    await expect(card).not.toContainText(/· ไม่มีตัวเลข|ไหลเข้า –|ระบาย –/);
    await expect(
      card.getByRole("button", { name: "เขื่อนภูมิพล", exact: true }),
    ).not.toBeVisible();
    await expect(card).toContainText(/ข้อมูลวันที่ 1 ต\.ค\. 2569/);
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await card.screenshot({
      path: `apps/web/test-results/consumer-review/dams-${width}.png`,
    });
    await page.getByTestId("dams-missing").locator("summary").click();
    await card
      .getByRole("button", { name: "เขื่อนภูมิพล", exact: true })
      .click();
    // the popup's words are the same at every width; on a phone the map's middle sits under the header, where the
    // helper below cannot find the pin, so the popup is read on the wide screen only
    if (width !== 1440) return;
    // the name only moves the map (as for every dam); its grey pin, now in the middle, opens the popup
    await expect(page.getByTestId("map-surface")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await clickMiddleSymbol(page);
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toContainText(
      "ยังไม่มีตัวเลขปริมาณน้ำและการระบายในรายงานนี้",
    );
    await expect(popup).not.toContainText(/–|9\.94|0%/);
    await expect(popup.getByRole("link", { name: /ที่มา:/ })).toBeVisible();
  });
}

for (const absent of [false, true]) {
  test(`M38: a report with ${absent ? "no records" : "only empty records"} stays explicit about missing data`, async ({
    page,
  }) => {
    await prepare(page, report(absent ? [] : missingDams()));
    await page.goto("/");
    const card = page.getByTestId("dams");
    await expect(page.getByTestId("dams-coverage")).toHaveText(
      "ยังไม่มีตัวเลขเขื่อนในรายงานนี้",
    );
    await expect(page.getByTestId("dams-main-missing")).toContainText(
      "ยังประเมินสถานการณ์ของเขื่อนที่ขาดข้อมูลไม่ได้",
    );
    await expect(card.locator(".dam-line, .dam-bar")).toHaveCount(0);
    await expect(card).not.toContainText(/0%|9\.94|ระบาย –|ไหลเข้า –/);
  });
}

test("M38: partial readings and real zero remain visible without an invented percent or release", async ({
  page,
}) => {
  const [first, second] = missingDams();
  await prepare(
    page,
    report([
      { ...first, outflow_mcm: 0 },
      { ...second, volume_mcm: 0, percent: 0, inflow_mcm: 0 },
    ]),
  );
  await page.goto("/");
  const card = page.getByTestId("dams");
  await expect(card.locator(".dam-line")).toHaveCount(2);
  const firstLine = card.locator(".dam-line").filter({ hasText: NAMES[0] });
  await expect(firstLine).toContainText("ระบาย 0 ล้าน ลบ.ม./วัน");
  await expect(firstLine).toContainText(
    "ยังไม่มีข้อมูล: ปริมาณน้ำในอ่าง / น้ำไหลเข้า",
  );
  await expect(firstLine.locator(".dam-bar")).toHaveCount(0);
  const secondLine = card.locator(".dam-line").filter({ hasText: NAMES[1] });
  await expect(secondLine.locator(".dam-percent")).toHaveText("0%");
  await expect(secondLine.locator(".dam-fill")).toHaveAttribute(
    "style",
    /width: 0%/,
  );
  await expect(secondLine).toContainText("ยังไม่มีข้อมูล: การระบายน้ำ");
  await expect(secondLine).not.toContainText("ระบาย 0");
});

test("M38: a subsequent feed restores readings without a reload and does not retain them when missing again", async ({
  page,
}) => {
  const missing = report(missingDams());
  const state = await prepare(page, missing);
  await page.goto("/");
  const card = page.getByTestId("dams");
  await expect(page.getByTestId("dams-coverage")).toHaveText(
    "ยังไม่มีตัวเลขเขื่อนในรายงานนี้",
  );
  await expect(card.locator(".dam-line")).toHaveCount(0);
  state.file = report(
    missing.dams.map((dam) => ({
      ...dam,
      percent: 80,
      volume_mcm: 500,
      inflow_mcm: 2,
      outflow_mcm: 0,
    })),
  );
  state.revision++;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(card.locator(".dam-line")).toHaveCount(4);
  await expect(page.getByTestId("dams-main-missing")).toHaveCount(0);
  await expect(page.getByTestId("dams-missing")).toHaveCount(0);
  await expect(card.locator(".dam-percent")).toHaveText([
    "80%",
    "80%",
    "80%",
    "80%",
  ]);
  state.file = missing;
  state.revision++;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(card.locator(".dam-line")).toHaveCount(0);
  await expect(page.getByTestId("dams-main-missing")).toContainText(
    "เขื่อนหลัก 4 แห่ง",
  );
});

test("M39: an all-null last-known object does not bring back empty dam cards", async ({
  page,
}) => {
  const file = report(
    missingDams().map((dam) => ({
      ...dam,
      last_known: {
        report_date: "2026-09-30",
        fetched_at: "2026-09-30T17:14:00+07:00",
        percent: null,
        volume_mcm: null,
        inflow_mcm: null,
        outflow_mcm: null,
      },
    })),
  );
  await prepare(page, file);
  await page.goto("/");
  const card = page.getByTestId("dams");
  await expect(page.getByTestId("dams-main-missing")).toContainText(
    "เขื่อนหลัก 4 แห่ง",
  );
  await expect(card.locator(".dam-line")).toHaveCount(0);
  await expect(page.getByTestId("dams-coverage")).not.toContainText(
    "แสดงตัวเลขล่าสุดที่มี",
  );
});

test("M39: partial last-known readings preserve zero and explain gaps and both dates in card and popup", async ({
  page,
}) => {
  const file = report([
    {
      ...missingDams()[0],
      last_known: {
        report_date: "2026-09-30",
        fetched_at: "2026-09-30T17:14:00+07:00",
        percent: null,
        volume_mcm: null,
        inflow_mcm: null,
        outflow_mcm: 0,
      },
    },
  ]);
  await prepare(page, file);
  await page.goto("/");
  const card = page.getByTestId("dams");
  const line = card.locator(".dam-line");
  await expect(line).toContainText("ระบาย 0 ล้าน ลบ.ม./วัน");
  await expect(line).toContainText(
    "ยังไม่มีข้อมูล: ปริมาณน้ำในอ่าง / น้ำไหลเข้า",
  );
  await expect(line).toContainText("รายงานวันที่ 30 ก.ย. 2569");
  await expect(line).toContainText("ดึงเมื่อ 30 ก.ย. 17:14 น.");
  await expect(line).not.toContainText("รายงานวันนี้");
  await expect(line.locator(".dam-bar, .dam-release")).toHaveCount(0);
  await card.getByRole("button", { name: /เขื่อนภูมิพล/ }).click();
  await expect(page.getByTestId("map-surface")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await clickMiddleSymbol(page);
  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText(
    "ยังไม่มีข้อมูล: ปริมาณน้ำในอ่าง / น้ำไหลเข้า",
  );
  await expect(popup).toContainText("รายงานวันที่ 30 ก.ย. 2569");
  await expect(popup).toContainText("รายงานรอบนี้วันที่ 1 ต.ค. 2569");
  await expect(popup).not.toContainText("ข้อมูลวันที่ 1 ต.ค.");
});
