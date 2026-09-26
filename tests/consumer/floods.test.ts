import { readFileSync } from "node:fs";
import {
  floodsNear,
  isOngoing,
  latestFloods,
  FLOODS_STALE_MS,
} from "../../apps/web/src/floods";
import { RefSync } from "../../apps/web/src/refSync";

const feed = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/v1/examples/live-floods/floods.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const now = Date.parse(feed.fetched_at);

describe("live flood consumer contract (section 13)", () => {
  it("reads longitude before latitude and keeps only reports within the pin radius", () => {
    const hits = floodsNear(feed, [100.52, 13.75], now);
    expect(hits.map((hit) => hit.report.id)).toEqual(["longdo:900003"]);
    expect(hits[0].distance).toBe(0);
    expect(floodsNear(feed, [13.75, 100.52], now)).toEqual([]);
  });

  it("uses the report time window, not the age of the containing file", () => {
    const publicReport = feed.reports[0];
    expect(isOngoing(publicReport, Date.parse(publicReport.start) - 1)).toBe(
      false,
    );
    expect(isOngoing(publicReport, Date.parse(publicReport.start))).toBe(true);
    expect(isOngoing(publicReport, Date.parse(publicReport.stop) + 1)).toBe(
      false,
    );
    expect(
      latestFloods(feed, Date.parse("2026-09-26T16:21:00+07:00")).map(
        (r) => r.id,
      ),
    ).toEqual(["longdo:900002"]);
  });

  it("preserves producer ordering and applies the list limit after filtering expired reports", () => {
    expect(latestFloods(feed, now, 2).map((r) => r.id)).toEqual([
      "longdo:900001",
      "longdo:900003",
    ]);
    expect(latestFloods(feed, now, 0)).toEqual([]);
  });

  it("does not invent a report when an area has none", () => {
    expect(latestFloods({ ...feed, reports: [] }, now)).toEqual([]);
    expect(FLOODS_STALE_MS).toBe(45 * 60_000);
  });

  it("keeps a failed refresh visibly outdated and clears a feed removed from the manifest", async () => {
    const manifest = (sha?: string) =>
      ({
        files: sha ? [{ path: "live/floods.json", sha256: sha }] : [],
      }) as never;
    const ref = new RefSync(
      "live/floods.json",
      async (m: any) => {
        if (m.files[0].sha256 === "bad") throw new Error("unavailable");
        return feed;
      },
      () => undefined,
    );
    await ref.sync(manifest("good"));
    await ref.sync(manifest("bad"));
    expect(ref.slot).toEqual({ value: feed, state: "outdated" });
    await ref.sync(manifest());
    expect(ref.slot).toEqual({ value: null, state: "missing" });
  });
});
