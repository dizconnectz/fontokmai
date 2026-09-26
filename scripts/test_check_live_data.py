"""python3 -m unittest scripts/test_check_live_data.py (run in CI with the repo-safety job)."""

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_live_data import evaluate, report  # noqa: E402

NOW = datetime(2026, 9, 26, 8, 30, tzinfo=UTC)


def manifest(age_min=5, cap_age_min=5, cap_status="ok", cap_message=None, radar_age_min=5, forecast=True):
    at = (NOW - timedelta(minutes=age_min)).isoformat()
    files = [{"path": "alerts.json"}] + ([{"path": "forecast/rain.json"}] if forecast else [])
    return {"generated_at": at, "files": files, "source_status": [
        {"source_id": "tmd_cap", "status": cap_status, "message": cap_message,
         "last_success_at": (NOW - timedelta(minutes=cap_age_min)).isoformat()},
        {"source_id": "tmd_radar", "status": "ok", "message": None,
         "last_success_at": (NOW - timedelta(minutes=radar_age_min)).isoformat()},
    ]}


FRESH_FORECAST = {"fetched_at": (NOW - timedelta(hours=2)).isoformat()}


class Watch(unittest.TestCase):
    def test_all_fresh_is_quiet(self):
        self.assertEqual(evaluate(manifest(), FRESH_FORECAST, NOW), [])

    def test_a_stopped_publisher_is_critical(self):
        [(level, message)] = evaluate(manifest(age_min=55, cap_age_min=5), FRESH_FORECAST, NOW)
        self.assertEqual(level, "critical")
        self.assertIn("55 นาที", message)

    def test_tmd_down_for_three_rounds_is_critical_but_one_failed_download_is_not(self):
        problems = evaluate(manifest(cap_age_min=50, cap_status="failed", cap_message="index: HTTP 502"),
                            FRESH_FORECAST, NOW)
        self.assertEqual([level for level, _ in problems], ["critical"])
        self.assertEqual(evaluate(manifest(cap_status="degraded", cap_message="X.xml: HTTP 502"),
                                  FRESH_FORECAST, NOW), [])

    def test_an_alert_that_could_not_be_read_is_a_warning(self):
        problems = evaluate(manifest(cap_status="degraded", cap_message="TMD1.xml: invalid polygon: x"),
                            FRESH_FORECAST, NOW)
        self.assertEqual([level for level, _ in problems], ["warning"])
        self.assertIn("invalid polygon", problems[0][1])

    def test_old_radar_and_forecast_are_warnings(self):
        old = {"fetched_at": (NOW - timedelta(hours=14)).isoformat()}
        levels = [level for level, _ in evaluate(manifest(radar_age_min=90), old, NOW)]
        self.assertEqual(levels, ["warning", "warning"])
        self.assertEqual(evaluate(manifest(forecast=False), None, NOW), [])

    def test_the_report_mentions_the_owner(self):
        text = report([("critical", "x")], NOW, "dizconnectz")
        self.assertIn("🔴 x", text)
        self.assertIn("@dizconnectz", text)


if __name__ == "__main__":
    unittest.main()
