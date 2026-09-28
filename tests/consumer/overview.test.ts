import { readFileSync } from "node:fs";
import { validOverview, visibleAlerts } from "../../apps/web/src/data";
import {
  liveItems,
  reasonLine,
  officialFor,
  oldInputs,
} from "../../apps/web/src/overview";

const read = (path: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/v1/examples/${path}`, import.meta.url),
      "utf8",
    ),
  );
const NOW = Date.parse("2026-09-26T23:59:00+07:00");

describe("contract 21 consumer", () => {
  it("accepts the producer fixture but rejects invalid time and unsupported reason kinds", () => {
    const file = read("overview/overview.json");
    expect(validOverview(file)).toBe(true);
    file.generated_at = "not-a-time";
    expect(validOverview(file)).toBe(false);
    file.generated_at = new Date(NOW).toISOString();
    file.items[0].reasons[0].kind = "safe";
    expect(validOverview(file)).toBe(false);
  });

  it("moves tomorrow to today at Thai midnight without retaining yesterday's reason", () => {
    const file = read("overview/overview.json");
    const reason = file.items[0].reasons[1];
    expect(reasonLine(reason, NOW)).toMatch(/^พรุ่งนี้:/);
    expect(reasonLine(reason, NOW + 60000)).toMatch(/^วันนี้:/);
    expect(reasonLine(reason, NOW + 86460000)).toBeNull();
    const onlyForecast = {
      ...file,
      items: [{ ...file.items[0], when: "next", reasons: [reason] }],
    };
    expect(liveItems(onlyForecast, "next", NOW + 86460000)).toEqual([]);
  });

  it("reads badges through the same live-alert filter as App, including tombstones", () => {
    const item = read("overview/overview.json").items[0];
    const feed = read("active/alerts.json");
    const alert = {
      ...feed.alerts[0],
      targets: [{ kind: "province", code: "TH-10" }],
      lifecycle_status: "active",
      severity: "Severe",
      sent: new Date(NOW - 3600000).toISOString(),
      effective: new Date(NOW - 3600000).toISOString(),
      expires: new Date(NOW + 3600000).toISOString(),
    };
    feed.alerts = [alert];
    feed.tombstones = [];
    expect(officialFor(item, visibleAlerts(feed, NOW), NOW)).toEqual({
      level: "severe",
      pending: false,
    });
    expect(
      officialFor(
        { ...item, province_code: "13" },
        visibleAlerts(feed, NOW),
        NOW,
      ),
    ).toBeNull();
    alert.effective = new Date(NOW + 60000).toISOString();
    expect(officialFor(item, visibleAlerts(feed, NOW), NOW)).toEqual({
      level: "severe",
      pending: true,
    });
    feed.tombstones = [{ event_id: alert.event_id }];
    expect(officialFor(item, visibleAlerts(feed, NOW), NOW)).toBeNull();
    feed.tombstones = [];
    alert.expires = new Date(NOW - 1).toISOString();
    expect(officialFor(item, visibleAlerts(feed, NOW), NOW)).toBeNull();
  });

  it("exposes missing and stale inputs instead of converting them into negative evidence", () => {
    const file = read("overview/overview.json");
    file.inputs = [
      { name_th: "ฝน", status: "missing", at: null },
      { name_th: "น้ำ", status: "stale", at: new Date(NOW).toISOString() },
      { name_th: "อื่น", status: "fresh", at: new Date(NOW).toISOString() },
    ];
    expect(oldInputs(file)).toEqual(["ฝน", "น้ำ"]);
  });
});
