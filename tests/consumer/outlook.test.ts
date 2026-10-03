import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validOutlook } from "../../apps/web/src/data";
import { dayOutlook, type RainOutlook } from "../../apps/web/src/outlook";

const example = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/v1/examples/outlook/outlook.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
describe("outlook consumer contract", () => {
  it("accepts the generated producer example and its explicit unknown hydraulic data", () => {
    expect(validOutlook(example)).toBe(true);
    const data = example as RainOutlook;
    expect(data.days).toHaveLength(14);
    expect(data.experimental).toBe(true);
    expect(data.spatial_scope).toBe("sampled_points");
    expect(
      data.points.every(
        (p) =>
          p.point.bank_m === null &&
          p.models.every((m) => m.issued_at === null),
      ),
    ).toBe(true);
    expect(dayOutlook(data.points[0], 13)).not.toBeNull();
  });
  it("rejects rain masquerading as numbers or a calibrated flood product", () => {
    const invalid = structuredClone(example);
    invalid.points[0].models[0].members[0].rain_mm[0] = "40";
    expect(validOutlook(invalid)).toBe(false);
    invalid.points[0].models[0].members[0].rain_mm[0] = 40;
    invalid.spatial_scope = "flood_probability";
    expect(validOutlook(invalid)).toBe(false);
  });
  it("can read a partial provider day without silently borrowing another model", () => {
    const data = structuredClone(example) as RainOutlook;
    const p = data.points[0];
    p.models = [p.models[1]];
    p.missing_models = ["ecmwf_ifs025"];
    expect(validOutlook(data)).toBe(true);
    expect(dayOutlook(p, 0)?.partial).toBe(true);
    p.models[0].members.forEach((m) => (m.rain_mm[0] = null));
    expect(dayOutlook(p, 0)).toBeNull();
  });
});
