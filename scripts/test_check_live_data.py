"""python3 -m unittest scripts/test_check_live_data.py (run in CI with the repo-safety job)."""

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_live_data import EXPECTED_FILES, evaluate, outlook_problems, report  # noqa: E402

NOW = datetime(2026, 9, 26, 8, 30, tzinfo=UTC)


def manifest(age_min=5, cap_age_min=5, cap_status="ok", cap_message=None, radar_age_min=5, forecast=True):
    at = (NOW - timedelta(minutes=age_min)).isoformat()
    files = [{"path": p} for p in EXPECTED_FILES if forecast or p != "forecast/rain.json"]
    return {"generated_at": at, "files": files, "source_status": [
        {"source_id": "tmd_cap", "status": cap_status, "message": cap_message,
         "last_success_at": (NOW - timedelta(minutes=cap_age_min)).isoformat()},
        {"source_id": "tmd_radar", "status": "ok", "message": None,
         "last_success_at": (NOW - timedelta(minutes=radar_age_min)).isoformat()},
    ]}


FRESH_FORECAST = {"fetched_at": (NOW - timedelta(hours=2)).isoformat()}
FRESH_RADAR = {"frames": [{"time": (NOW - timedelta(minutes=25)).isoformat(), "path": "radar/a.png"}]}


class Watch(unittest.TestCase):
    def test_all_fresh_is_quiet(self):
        self.assertEqual(evaluate(manifest(), FRESH_FORECAST, NOW, FRESH_RADAR), [])

    def test_a_stopped_publisher_is_critical(self):
        [(level, message)] = evaluate(manifest(age_min=55, cap_age_min=5), FRESH_FORECAST, NOW, FRESH_RADAR)
        self.assertEqual(level, "critical")
        self.assertIn("55 นาที", message)

    def test_tmd_down_for_three_rounds_is_critical_but_one_failed_download_is_not(self):
        problems = evaluate(manifest(cap_age_min=50, cap_status="failed", cap_message="index: HTTP 502"),
                            FRESH_FORECAST, NOW, FRESH_RADAR)
        self.assertEqual([level for level, _ in problems], ["critical"])
        self.assertEqual(evaluate(manifest(cap_status="degraded", cap_message="X.xml: HTTP 502"),
                                  FRESH_FORECAST, NOW, FRESH_RADAR), [])

    def test_an_alert_that_could_not_be_read_is_a_warning(self):
        problems = evaluate(manifest(cap_status="degraded", cap_message="TMD1.xml: invalid polygon: x"),
                            FRESH_FORECAST, NOW, FRESH_RADAR)
        self.assertEqual([level for level, _ in problems], ["warning"])
        self.assertIn("invalid polygon", problems[0][1])

    def test_old_radar_and_forecast_are_warnings(self):
        old = {"fetched_at": (NOW - timedelta(hours=14)).isoformat()}
        levels = [level for level, _ in evaluate(manifest(radar_age_min=90), old, NOW, FRESH_RADAR)]
        self.assertEqual(levels, ["warning", "warning"])
        self.assertEqual([m for _, m in evaluate(manifest(forecast=False), None, NOW, FRESH_RADAR)],
                         ["ไม่มีไฟล์พยากรณ์ฝน (forecast/rain.json) ในชุดข้อมูลล่าสุด"])

    def test_m12_a_failed_download_does_not_hide_an_alert_that_could_not_be_read(self):
        m = manifest(cap_status="degraded", cap_message="A.xml: HTTP 502; B.xml: invalid polygon")
        [(level, message)] = evaluate(m, FRESH_FORECAST, NOW, FRESH_RADAR)
        self.assertEqual(level, "warning")
        self.assertIn("B.xml: invalid polygon", message)
        self.assertNotIn("A.xml", message)
        only_downloads = manifest(cap_status="degraded", cap_message="A.xml: HTTP 502; B.xml: timed out")
        self.assertEqual(evaluate(only_downloads, FRESH_FORECAST, NOW, FRESH_RADAR), [])

    def test_m11_old_radar_images_warn_even_when_every_download_succeeds(self):
        stuck = {"frames": [{"time": (NOW - timedelta(minutes=75)).isoformat(), "path": "radar/a.png"}]}
        [(level, message)] = evaluate(manifest(radar_age_min=5), FRESH_FORECAST, NOW, stuck)
        self.assertEqual(level, "warning")
        self.assertIn("75 นาที", message)
        self.assertEqual([m for _, m in evaluate(manifest(), FRESH_FORECAST, NOW, {"frames": []})],
                         ["ไฟล์เรดาร์ไม่มีภาพเลย"])

    def test_m11_a_file_missing_from_the_manifest_is_reported(self):
        m = manifest()
        m["files"] = [f for f in m["files"] if f["path"] not in ("alerts.json", "live/floods.json")]
        problems = evaluate(m, FRESH_FORECAST, NOW, FRESH_RADAR)
        self.assertEqual([level for level, _ in problems], ["critical", "warning"])
        self.assertIn("alerts.json", problems[0][1])

    def test_bangkok_water_and_rain_that_stop_updating_are_a_warning(self):
        m = manifest()
        m["source_status"].append({"source_id": "bma_dxs", "status": "failed", "message": "water: HTTP 500",
                                   "last_success_at": (NOW - timedelta(minutes=70)).isoformat()})
        m["files"] += [{"path": p} for p in ("bkk/water.json", "bkk/rain.json", "bkk/flooding.json")]
        [(level, message)] = evaluate(m, FRESH_FORECAST, NOW, FRESH_RADAR)
        self.assertEqual(level, "warning")
        self.assertIn("DXS", message)

    def test_bangkok_files_are_expected_only_while_the_round_includes_dxs(self):
        m = manifest()
        self.assertEqual(evaluate(m, FRESH_FORECAST, NOW, FRESH_RADAR), [])
        m["source_status"].append({"source_id": "bma_dxs", "status": "ok", "message": None,
                                   "last_success_at": (NOW - timedelta(minutes=5)).isoformat()})
        missing = [msg for _, msg in evaluate(m, FRESH_FORECAST, NOW, FRESH_RADAR)]
        self.assertEqual(len(missing), 3)
        self.assertIn("bkk/flooding.json", missing[-1])

    def test_the_river_trend_and_the_summary_must_stay_fresh_once_they_are_read(self):
        rivers = {"fetched_at": (NOW - timedelta(hours=20)).isoformat()}
        overview = {"generated_at": (NOW - timedelta(minutes=5)).isoformat()}
        self.assertEqual(evaluate(manifest(), FRESH_FORECAST, NOW, FRESH_RADAR, rivers, overview), [])
        old = evaluate(manifest(), FRESH_FORECAST, NOW, FRESH_RADAR, {"fetched_at": (NOW - timedelta(hours=40))
                       .isoformat()}, {"generated_at": (NOW - timedelta(hours=2)).isoformat()})
        self.assertEqual([m.split(" (")[0] for _, m in old], ["แนวโน้มน้ำแม่น้ำไม่อัปเดต", "สรุปจุดที่ต้องระวังไม่อัปเดต"])
        # a file that could not be opened is not fresh either
        self.assertEqual(len(evaluate(manifest(), FRESH_FORECAST, NOW, FRESH_RADAR, None, overview)), 1)

    def test_the_dams_the_server_fetches_itself_must_stay_fresh_but_a_hand_sent_file_is_not_judged(self):
        listed = manifest()
        listed["files"].append({"path": "water/dams.json"})
        auto = {"fetched_at": (NOW - timedelta(hours=7)).isoformat(), "automatic": True}
        found = evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, dams=auto)
        self.assertEqual([level for level, text in found if "เขื่อน" in text], ["warning"])
        fresh = {**auto, "fetched_at": (NOW - timedelta(hours=3)).isoformat()}
        self.assertEqual(evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, dams=fresh), [])
        by_hand = {"fetched_at": (NOW - timedelta(days=2)).isoformat()}  # no "automatic": sent with the BKK update
        self.assertEqual(evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, dams=by_hand), [])
        self.assertEqual(evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR), [])  # not fetched: not judged

    def test_rids_report_and_the_canal_outlook_are_expected_and_must_stay_fresh(self):
        listed = manifest()
        listed["files"].append({"path": "ref/canals.json"})  # the round carries the canals
        missing = [text for _, text in evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR)]
        self.assertEqual(len(missing), 2)
        self.assertIn("water/flows.json", missing[0])
        listed["files"] += [{"path": "water/flows.json"}, {"path": "summary/canals.json"}]
        canals = {"generated_at": (NOW - timedelta(minutes=10)).isoformat()}
        # the report of 06:00 yesterday, and even of the day before when RID skipped a day
        for days in (1, 2):
            flows = {"observed_at": (NOW - timedelta(days=days, hours=2)).isoformat()}
            self.assertEqual(evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, flows=flows, canals=canals), [])
        old = {"observed_at": (NOW - timedelta(days=3)).isoformat()}
        [(level, text)] = evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, flows=old, canals=canals)
        self.assertEqual(level, "warning")
        self.assertTrue(text.startswith("รายงานน้ำกรมชลประทานไม่อัปเดต"))
        stale = {"generated_at": (NOW - timedelta(hours=1)).isoformat()}
        found = evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, flows=None, canals=stale)
        self.assertEqual([text.split(" (")[0] for _, text in found], ["คลองที่อาจล้นไม่อัปเดต",
                                                                       "เปิดไฟล์รายงานน้ำกรมชลประทานไม่ได้"])

    def test_m46_a_dams_file_or_the_14_day_outlook_dropped_from_the_round_is_reported(self):
        for path in ("water/dams.json", "forecast/outlook.json"):
            listed = manifest()
            listed["files"] = [f for f in listed["files"] if f["path"] != path]
            [(level, text)] = evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR)
            self.assertEqual(level, "warning")
            self.assertIn(path, text)

    def test_m46_the_14_day_outlook_must_be_fresh_and_readable_on_every_day(self):
        def model(name, expected, present, nulls=0):
            members = [{"id": n, "rain_mm": [1.0] * 14} for n in range(present)]
            for m in members[:nulls]:
                m["rain_mm"][13] = None  # a missing value is not 0 mm: it is no member that day
            return {"model": name, "expected_members": expected, "members": members}

        def outlook(*points, age_hours=2):
            return {"fetched_at": (NOW - timedelta(hours=age_hours)).isoformat(), "days": [str(d) for d in range(14)],
                    "points": [{"missing_models": missing, "models": models} for models, missing in points]}

        full = ([model("ecmwf", 51, 51), model("gfs", 31, 31)], [])
        self.assertEqual(outlook_problems(outlook(full, full), NOW), [])
        self.assertEqual(outlook_problems(None, NOW), [("warning", "เปิดไฟล์แนวโน้มฝน 14 วันไม่ได้")])
        [(_, old)] = outlook_problems(outlook(full, age_hours=30), NOW)
        self.assertTrue(old.startswith("แนวโน้มฝน 14 วันไม่อัปเดต"))
        # ECMWF short of members on the last day at every point while GFS has it: shown, marked, no problem (the
        # live file of 2026-10-08 is so every day: its 15-day run ends inside the 14th Thai day)
        tail = ([model("ecmwf", 51, 51, nulls=20), model("gfs", 31, 31)], [])
        self.assertEqual(outlook_problems(outlook(tail, tail, tail), NOW), [])
        # a point whose GFS failed and whose ECMWF lacks the last day: one point-day no model can show
        lost = ([model("ecmwf", 51, 51, nulls=20)], ["gfs"])
        self.assertEqual(outlook_problems(outlook(full, lost), NOW), [
            ("warning", "แนวโน้มฝน 14 วันไม่ครบ: 1 จุด-วันไม่มีโมเดลใดมีสมาชิกพอ (แสดงได้ 27)"),
            ("warning", "แนวโน้มฝน 14 วันขาดโมเดล: gfs 1 จุด")])
        # nothing readable at all
        none = ([model("ecmwf", 51, 10)], ["gfs"])
        [(_, text)] = outlook_problems(outlook(none, none), NOW)
        self.assertEqual(text, "แนวโน้มฝน 14 วันใช้ไม่ได้: ไม่มีวันใดที่โมเดลมีสมาชิกพอ")
        # read in the round's check once listed
        listed = manifest()
        problems = evaluate(listed, FRESH_FORECAST, NOW, FRESH_RADAR, outlook=outlook(none))
        self.assertEqual([text for _, text in problems], ["แนวโน้มฝน 14 วันใช้ไม่ได้: ไม่มีวันใดที่โมเดลมีสมาชิกพอ"])

    def test_the_report_lists_the_problems_and_mentions_no_one(self):
        # the owner asked for no emails (2026-10-01): a mention in a report would send one
        text = report([("critical", "x"), ("warning", "y")], NOW)
        self.assertIn("🔴 x", text)
        self.assertIn("🟠 y", text)
        self.assertNotIn("@", text)
        self.assertIn("- ปกติ", report([], NOW))


if __name__ == "__main__":
    unittest.main()
