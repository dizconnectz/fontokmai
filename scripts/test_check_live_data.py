"""python3 -m unittest scripts/test_check_live_data.py (run in CI with the repo-safety job)."""

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_live_data import EXPECTED_FILES, evaluate, report  # noqa: E402

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

    def test_the_report_mentions_the_owner(self):
        text = report([("critical", "x")], NOW, "dizconnectz")
        self.assertIn("🔴 x", text)
        self.assertIn("@dizconnectz", text)


if __name__ == "__main__":
    unittest.main()
