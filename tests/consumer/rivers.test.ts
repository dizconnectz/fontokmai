import { readFileSync } from "node:fs";
import type { RiverForecast } from "../../contracts/v1/ts/forecast_rivers";
import { riverOutlook, riverPin, riverWords } from "../../apps/web/src/rivers";
import { rainAmountWords, levelWords } from "../../apps/web/src/bkk";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/v1/examples/forecast/rivers.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as RiverForecast;
const NOW = Date.parse("2026-09-27T11:42:00+07:00");

function series(ahead: (number | null)[], base: number | null = 100) {
  const file = structuredClone(fixture);
  const point = file.points[0];
  point.discharge.fill(null);
  point.median.fill(null);
  point.discharge[7] = base;
  point.median[7] = base;
  point.median.splice(8, ahead.length, ...ahead);
  return { file, point };
}

describe("contract 20: river forecast consumer", () => {
  it("uses Bangkok's day across the UTC midnight boundary", () => {
    const { file, point } = series(Array(7).fill(120));
    expect(
      riverOutlook(file, point, Date.parse("2026-09-26T17:00:00Z"))?.today,
    ).toBe(7);
    expect(
      riverOutlook(file, point, Date.parse("2026-09-27T16:59:59Z"))?.today,
    ).toBe(7);
  });

  it("does not treat a null or zero baseline as stable or safe", () => {
    for (const base of [null, 0]) {
      const { file, point } = series(Array(7).fill(100), base);
      expect(riverOutlook(file, point, NOW)).toBeNull();
      expect(riverPin(file, point, NOW)).toBe("pin-river-unknown");
    }
    expect(riverWords(null)).toBe("ยังบอกแนวโน้มไม่ได้");
  });

  it("uses the control run only as today's fallback, not as a missing future median", () => {
    const { file, point } = series(Array(7).fill(120));
    point.median[7] = null;
    expect(riverOutlook(file, point, NOW)?.trend).toBe("rising");
    point.median.fill(null);
    point.discharge.fill(100);
    expect(riverOutlook(file, point, NOW)).toBeNull();
  });

  it("keeps a substantial rise ahead visible even if a later day falls", () => {
    const { file, point } = series([100, 140, 100, 90, 80, 80, 80]);
    const outlook = riverOutlook(file, point, NOW);
    expect(outlook?.trend).toBe("rising_fast");
    expect(outlook?.day).toBe("2026-09-29");
  });

  it("M18: six missing forecast days must not become an unqualified seven-day steady outlook", () => {
    const { file, point } = series([100, null, null, null, null, null, null]);
    expect(riverOutlook(file, point, NOW)).toBeNull();
  });

  it("M19: exactly minus ten percent belongs to falling, not steady", () => {
    const { file, point } = series(Array(7).fill(90));
    expect(riverOutlook(file, point, NOW)?.trend).toBe("falling");
  });
});

describe("plain Thai wording keeps the measurement and period", () => {
  it("distinguishes an hourly rain amount from a daily amount and from missing rain", () => {
    expect(rainAmountWords(8, 1)).toBe("ฝนปานกลาง (8 มม.)");
    expect(rainAmountWords(8, 24)).toBe("ฝนเล็กน้อย (8 มม.)");
    expect(rainAmountWords(120.5, 24)).toBe("ฝนหนักมาก (120.5 มม.)");
    expect(rainAmountWords(0, 1)).toBe("ไม่มีฝน");
    expect(rainAmountWords(null, 1)).not.toBe("ไม่มีฝน");
  });

  it("describes a signed sea-level elevation without claiming flood depth or a normal level", () => {
    expect(levelWords(0.06)).toBe("สูงกว่าระดับน้ำทะเล 6 ซม.");
    expect(levelWords(-0.06)).toBe("ต่ำกว่าระดับน้ำทะเล 6 ซม.");
    expect(levelWords(0)).toBe("เท่ากับระดับน้ำทะเล");
    expect(levelWords(null)).toBe("ไม่มีค่า");
  });
});
