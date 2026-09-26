import { readFileSync } from "node:fs";
import { MercatorCoordinate } from "../../apps/web/node_modules/maplibre-gl/dist/maplibre-gl.mjs";
import {
  searchPlaces,
  placeTokens,
  nearestSubdistrict,
} from "../../apps/web/src/places";
import { searchPhoton } from "../../apps/web/src/photon";
import { radarPixel } from "../../apps/web/src/geo";
import {
  forecastAt,
  daysAt,
  forecastAreas,
  FORECAST_LEVELS,
} from "../../apps/web/src/forecast";
import { RefSync } from "../../apps/web/src/refSync";

const example = (path: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${path}`, import.meta.url),
      "utf8",
    ),
  );
const gazetteer = example("places/places.json");
const forecast = example("forecast/rain.json");
const manifest = example("active/manifest.json");
const refManifest = (sha: string | null) => ({
  ...manifest,
  files: sha
    ? [{ path: "ref/test.json", sha256: sha.repeat(64), size: 1, revision: 1 }]
    : [],
});

describe("consumer rules in contract sections 9, 11 and 12", () => {
  it.each([
    ["กทม.", ["กรุงเทพมหานคร"]],
    ["จ.กรุงเทพฯ", ["กรุงเทพมหานคร"]],
    ["อ. คลองหลวง ต.คลองหนึ่ง", ["คลองหลวง", "คลองหนึ่ง"]],
    ["จังหวัด โคราช", ["นครราชสีมา"]],
  ])("normalises %s", (query, expected) =>
    expect(placeTokens(query as string)).toEqual(expected),
  );

  it.each([
    // บางโพงพาง also matches: บาง is its own prefix and นา occurs in its parent ยานนาวา.
    ["บาง นา", ["1047", "104701", "101204"]],
    ["คลองหนึ่ง คลองหลวง", ["130201"]],
    ["คลองหลวง", ["1302"]],
  ])("orders and narrows %s", (query, codes) => {
    expect(searchPlaces(gazetteer, query as string).map((p) => p.code)).toEqual(
      codes,
    );
  });

  it("uses code for a tie after kind and equal-length names", () => {
    const entries = ["139902", "139901"].map((code) => ({
      code,
      kind: "subdistrict",
      name: "คลองหนึ่ง",
      label: "ต.คลองหนึ่ง",
      location: [100.6, 14],
    }));
    expect(
      searchPlaces({ ...gazetteer, places: entries }, "คลอง").map(
        (p) => p.code,
      ),
    ).toEqual(["139901", "139902"]);
    expect(nearestSubdistrict(gazetteer, [100.9, 13.2])).toBeNull();
  });

  it("sends only the typed query and fixed search controls to Photon", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const controller = new AbortController();
    await searchPhoton(
      "ฟิวเจอร์พาร์ครังสิต",
      controller.signal,
      async (url, init) => {
        calls.push([String(url), init]);
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      },
    );
    const url = new URL(calls[0][0]);
    expect([...url.searchParams.keys()].sort()).toEqual(["bbox", "limit", "q"]);
    expect(url.searchParams.get("q")).toBe("ฟิวเจอร์พาร์ครังสิต");
    expect(url.searchParams.get("bbox")).toBe("97.3,5.6,105.7,20.5");
    expect(calls[0][1]).toMatchObject({
      signal: controller.signal,
      credentials: "omit",
    });
    expect(calls[0][1]?.body).toBeUndefined();
  });

  it.each([
    [100.5, 13.75],
    [100.607, 14.066],
    [98.98, 18.8],
    [100.5, 7],
    [97, 21],
  ])("reads the rendered Mercator pixel at %s %s", (lon, lat) => {
    const corners = [
      [95, 22.5],
      [108, 22.5],
      [108, 4],
      [95, 4],
    ];
    const a = MercatorCoordinate.fromLngLat({ lng: 95, lat: 22.5 });
    const b = MercatorCoordinate.fromLngLat({ lng: 108, lat: 4 });
    const at = MercatorCoordinate.fromLngLat({ lng: lon, lat });
    const actual = radarPixel(corners, 1800, 2644, [lon, lat])!;
    expect(
      Math.abs(actual.x - ((at.x - a.x) / (b.x - a.x)) * 1800),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(actual.y - ((at.y - a.y) / (b.y - a.y)) * 2644),
    ).toBeLessThanOrEqual(1);
  });

  it("preserves tenths, null and zero in the shipped forecast", () => {
    forecast.points.forEach(([col, row]: number[], p: number) => {
      const at = [
        forecast.lattice.west + col * forecast.lattice.step,
        forecast.lattice.south + row * forecast.lattice.step,
      ];
      const expected = forecast.rain[0][p];
      if (expected === null) expect(forecastAt(forecast, 0, at)).toBeNull();
      else expect(forecastAt(forecast, 0, at)).toBeCloseTo(expected / 10, 6);
      expect(daysAt(forecast, at)?.[0].rainMm).toBe(
        forecast.day_rain[0][p] === null ? null : forecast.day_rain[0][p] / 10,
      );
    });
    const dry = {
      ...forecast,
      rain: forecast.rain.map((r: unknown[]) => r.map(() => 0)),
    };
    expect(forecastAt(dry, 0, [100.5, 13.75])).toBe(0);
    expect(forecastAt(forecast, 0, [0, 0])).toBeNull();
  });

  it.each([5, 14, 19])(
    "places vector thresholds at the pin coordinates near latitude %s",
    (south) => {
      const f = {
        ...forecast,
        lattice: { west: 100, south, step: 0.25 },
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
        rain: [[100, 200, 300, 400]],
      };
      const shapes = forecastAreas(f, 0);
      for (const [col, row] of [
        [0.2, 0.3],
        [0.3, 0.7],
        [0.7, 0.2],
        [0.8, 0.8],
      ]) {
        const point = [100 + col * 0.25, south + row * 0.25];
        const analytical = 10 + 10 * col + 20 * row;
        expect(forecastAt(f, 0, point)).toBeCloseTo(analytical, 5);
        const covered = shapes.features.filter((feature) =>
          feature.geometry.coordinates.some((polygon) => {
            // Project independently with MapLibre, as the GeoJSON layer is drawn by the browser.
            const at = MercatorCoordinate.fromLngLat(point);
            const inRing = (ring: number[][]) => {
              const vertices = ring.map((p) =>
                MercatorCoordinate.fromLngLat(p),
              );
              let inside = false;
              for (
                let i = 0, j = vertices.length - 1;
                i < vertices.length;
                j = i++
              ) {
                const a = vertices[i];
                const b = vertices[j];
                if (
                  a.y > at.y !== b.y > at.y &&
                  at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x
                )
                  inside = !inside;
              }
              return inside;
            };
            return inRing(polygon[0]) && !polygon.slice(1).some(inRing);
          }),
        );
        expect(covered.map((v) => v.properties.min)).toEqual(
          FORECAST_LEVELS.filter((v) => analytical >= v.min).map((v) => v.min),
        );
      }
    },
  );

  it("omits dry vector areas and separates the selected forecast hours", () => {
    const f = {
      ...forecast,
      rain: [forecast.points.map(() => 0), forecast.points.map(() => 100)],
    };
    expect(forecastAreas(f, 0).features).toEqual([]);
    expect(forecastAreas(f, 1).features.map((v) => v.properties.min)).toEqual([
      0.5, 1, 2, 4, 8,
    ]);
  });

  it("does not interpolate through a missing nearest lattice point", () => {
    const f = {
      ...forecast,
      lattice: { west: 100, south: 14, step: 0.25 },
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      rain: [[0, 100, 200, null]],
    };
    expect(forecastAt(f, 0, [100.2, 14.2])).toBeNull();
    expect(forecastAt(f, 0, [100.05, 14.05])).toBeCloseTo(5, 5);
  });

  it("invalidates a pending reference response after removal and recovers when re-added", async () => {
    let finish!: (value: string) => void;
    let n = 0;
    const ref = new RefSync(
      "ref/test.json",
      () =>
        ++n === 1
          ? new Promise<string>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve("restored"),
      () => undefined,
    );
    const pending = ref.sync(refManifest("a"));
    await ref.sync(refManifest(null));
    finish("removed");
    await pending;
    expect(ref.slot).toEqual({ value: null, state: "missing" });
    await ref.sync(refManifest("a"));
    expect(ref.slot).toEqual({ value: "restored", state: "ready" });
  });
});
