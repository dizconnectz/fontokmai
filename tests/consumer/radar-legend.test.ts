import { describe, expect, it } from "../../apps/web/node_modules/vitest";
import { radarClass, rainWords } from "../../apps/web/src/geo";

const legend = [
  { min_mm_per_hr: 52.2, color: "#CA325D", label: "52.2" },
  { min_mm_per_hr: 36.5, color: "#D43320", label: "36.5" },
  { min_mm_per_hr: 3, color: "#F3F453", label: "3" },
];

describe("the consumer reads the supplied radar scale", () => {
  it("does not classify an opaque pixel without a readable legend", () => {
    expect(radarClass([212, 51, 32, 255], [], 1)).toBeNull();
  });
  it("uses new page values instead of a historical colour scale", () => {
    const light = radarClass([243, 244, 83, 255], legend, 1);
    expect(light?.min_mm_per_hr).toBe(3);
    expect(rainWords(light!.min_mm_per_hr)).toBe("ฝนเบา");
    expect(radarClass([202, 50, 93, 255], legend, 1)?.min_mm_per_hr).toBe(52.2);
  });
  it("handles blended pixels and transparency", () => {
    const pixel = [212, 51, 32].map((n) => Math.round(n * 0.816 + 255 * 0.184));
    expect(radarClass([...pixel, 255], legend, 0.816)?.min_mm_per_hr).toBe(
      36.5,
    );
    expect(radarClass([...pixel, 0], legend, 0.816)).toBeNull();
  });
});
