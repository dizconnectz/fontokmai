import { readFileSync } from "node:fs";
import {
  levelText,
  mmText,
  waterPin,
  rainPin,
  nearest,
  oldNote,
  reportsOnRoads,
  isTodaysReport,
  bangkokDistrict,
  amount,
  damPin,
  weatherPin,
} from "../../apps/web/src/bkk";
import { isOngoing, latestFloods, floodsNear } from "../../apps/web/src/floods";

const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${name}`, import.meta.url),
      "utf8",
    ),
  );
const water = read("bkk/water.json");
const rain = read("bkk/rain.json");
const flooding = read("bkk/flooding.json");
const dams = read("bkk/dams.json");
const weather = read("bkk/weather-today.json");
const now = Date.parse(water.fetched_at);

describe("DXS consumer contracts 14–19", () => {
  it("keeps sea-level readings distinct from flood depth and missing values", () => {
    expect(levelText(-0.12)).toBe("-0.12 ม.รทก.");
    expect(levelText(0)).toBe("0.00 ม.รทก.");
    expect(levelText(null)).toBe("ไม่มีค่า");
    const station = { ...water.stations[0], level_in_m: 0, level_out_m: null };
    expect(waterPin(station, now)).toBe("pin-water");
    expect(waterPin({ ...station, level_in_m: null }, now)).toBe(
      "pin-water-old",
    );
    expect(waterPin(station, now + 3 * 3600000)).toBe("pin-water-old");
  });
  it("distinguishes measured zero rain from an unavailable measurement", () => {
    expect(mmText(0)).toBe("0 มม.");
    expect(mmText(null)).toBe("–");
    expect(rainPin(rain.gauges[1], now)).toBe("pin-rain-0");
    expect(rainPin(rain.gauges[2], now)).toBe("pin-rain-old");
    expect(rainPin(rain.gauges[1], now + 3 * 3600000)).toBe("pin-rain-old");
  });
  it("never guesses locations for stations or dams with null coordinates", () => {
    const station = water.stations[0];
    expect(
      nearest(
        [station, { ...station, code: "missing", location: null }],
        station.location,
        1,
      ).map((hit) => hit.item.code),
    ).toEqual([station.code]);
    const dam = dams.dams[0];
    expect(
      nearest([{ ...dam, location: null }], [100.5, 13.75], 10000000),
    ).toEqual([]);
  });
  it("labels manual relay files at the 45-minute and one-day boundaries", () => {
    expect(oldNote(water.fetched_at, now + 45 * 60000)).toBeNull();
    expect(oldNote(water.fetched_at, now + 45 * 60000 + 1)).toContain(
      "ไม่ได้อัปเดตอัตโนมัติ",
    );
    expect(oldNote(water.fetched_at, now + 24 * 3600000)).not.toContain(
      "ไม่ใช่ข้อมูลเรียลไทม์",
    );
    expect(oldNote(water.fetched_at, now + 24 * 3600000 + 1)).toMatch(
      /ไม่ใช่ข้อมูลเรียลไทม์.*26.*2569/,
    );
  });
  it("compares road report days in Bangkok even when the UTC day differs", () => {
    expect(isTodaysReport(flooding, Date.parse("2026-09-25T17:00:00Z"))).toBe(
      true,
    );
    expect(isTodaysReport(flooding, Date.parse("2026-09-26T16:59:59Z"))).toBe(
      true,
    );
    expect(isTodaysReport(flooding, Date.parse("2026-09-26T17:00:00Z"))).toBe(
      false,
    );
  });
  it("matches the road and the pin's Bangkok district together", () => {
    const a = {
      ...flooding.reports[0],
      road_th: "ถนนพหลโยธิน",
      district_th: "จตุจักร",
    };
    const b = { ...a, district_th: "เขตบางเขน" };
    const file = { ...flooding, reports: [a, b] };
    expect(reportsOnRoads(file, ["ถ.พหลโยธิน"], "จตุจักร")).toEqual([a]);
    expect(reportsOnRoads(file, ["พหลโยธิน"], "บางเขน")).toEqual([b]);
    expect(reportsOnRoads(file, ["พหลโยธิน"], null)).toEqual([]);
    expect(reportsOnRoads(file, ["ถนนอื่น"], "จตุจักร")).toEqual([]);
    expect(bangkokDistrict("แขวงลาดยาว เขตจตุจักร กรุงเทพมหานคร")).toBe(
      "จตุจักร",
    );
    expect(bangkokDistrict("ตำบลคลองหนึ่ง อำเภอคลองหลวง ปทุมธานี")).toBeNull();
  });
  it("does not coerce null dam or daily weather readings to zero", () => {
    expect(amount(null)).toBe("–");
    expect(amount(0)).toBe("0");
    expect(damPin({ ...dams.dams[0], percent: null })).not.toBe(
      damPin({ ...dams.dams[0], percent: 0 }),
    );
    const station = weather.stations[0];
    expect(weatherPin({ ...station, rain_mm: null })).not.toBe(
      weatherPin({ ...station, rain_mm: 0 }),
    );
  });
});

describe("D33: consumer expiry when a Longdo snapshot stops refreshing", () => {
  const feed = read("live-floods/floods.json");
  const report = {
    ...feed.reports[0],
    start: "2026-09-26T06:00:00+07:00",
    stop: null,
  };
  const cutoff = Date.parse(report.start) + 12 * 3600000;
  it("keeps a report up to the inclusive twelve-hour boundary", () => {
    expect(isOngoing(report, cutoff)).toBe(true);
  });
  it("M14: removes unclosed reports after twelve hours from lists and pin details", () => {
    const cached = { ...feed, reports: [report] };
    expect(isOngoing(report, cutoff + 1)).toBe(false);
    expect(latestFloods(cached, cutoff + 1)).toEqual([]);
    expect(floodsNear(cached, report.location, cutoff + 1)).toEqual([]);
  });
});
