import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fontokmai.contracts.flows import RidFlows, RidHydro
from fontokmai.sources import rid_hydro, rid_report

NOW = datetime(2026, 10, 4, 11, 30, tzinfo=UTC)  # 18:30 in Thailand
FIXTURES = Path(__file__).parent / "fixtures" / "rid"
# what the hydrology centre's service answered for C.35 on the user's computer (2026-10-04 18:30, first three hours)
C35 = (FIXTURES / "hydro-hourly-C.35.json").read_bytes()


def test_the_newest_hour_of_a_station_is_read():
    station = rid_hydro.parse_station("C.35", C35)
    assert (station.flow_cms, station.level_m) == (1489.0, 5.42)
    assert station.observed_at == datetime(2026, 10, 4, 11, 0, tzinfo=UTC)  # 18:00 ICT


def test_a_notation_or_a_mark_is_not_a_figure():
    rows = json.loads(C35)
    rows[0]["notationid"], rows[0]["notationString"] = 1, "ซ่อม"
    rows[0]["waterlevelvalue"] = "*"
    station = rid_hydro.parse_station("C.35", json.dumps(rows).encode())
    # 18:00 has neither a flow nor a level: 17:00 is the newest hour with figures
    assert station.observed_at == datetime(2026, 10, 4, 10, 0, tzinfo=UTC)
    assert rid_hydro.parse_station("C.35", b"[]") is None
    assert rid_hydro.parse_station("C.35", json.dumps({"d": json.loads(C35)}).encode()).flow_cms == 1489.0


def test_invalid_latest_flow_does_not_hide_an_older_valid_hour():
    for invalid in (-1, float("nan"), float("inf"), 10**1000):
        rows = json.loads(C35)
        rows[0]["Q"], rows[0]["waterlevelvalue"] = invalid, "*"
        station = rid_hydro.parse_station("C.35", json.dumps(rows).encode())
        assert station.flow_cms == 1489.0
        assert station.observed_at == datetime(2026, 10, 4, 10, 0, tzinfo=UTC)


def test_collect_asks_each_station_and_keeps_those_with_figures():
    asked = []

    def fetch(code):
        asked.append(code)
        return C35 if code == "C.35" else b"[]"

    hydro = rid_hydro.collect(NOW, fetch)
    assert asked == list(rid_hydro.STATIONS)
    assert [s.code for s in hydro.stations] == ["C.35"] and hydro.observed_at == hydro.stations[0].observed_at
    RidHydro.model_validate_json(hydro.model_dump_json())
    assert rid_hydro.collect(NOW, lambda code: b"[]") is None


def _flows():
    text = (FIXTURES / "report-2026-10-03.txt").read_text(encoding="utf-8")
    return rid_report.build(rid_report.parse_report(text), {"c35": "flood"}, rid_report.report_day(text),
                            NOW, None, [])


def test_the_backup_fills_only_what_the_report_lacks_while_it_is_recent():
    flows = _flows()
    hydro = rid_hydro.collect(NOW, lambda code: C35 if code == "C.35" else b"[]")
    merged = rid_hydro.with_backup(flows, hydro, NOW)
    points = {p.id: p for p in merged.points}
    assert points["c35"].flow_cms == 1489.0 and points["c35"].flow_backup_at == hydro.stations[0].observed_at
    assert points["c35"].level_m == 5.42 and points["c35"].state == "flood"
    # the report's own figures stay the report's
    assert points["c2"].flow_cms == 2245.0 and points["c2"].flow_backup_at is None
    assert merged.backup_url == rid_hydro.PAGE_URL
    RidFlows.model_validate_json(merged.model_dump_json())
    # too old, or none: nothing changes
    assert rid_hydro.with_backup(flows, hydro, NOW + timedelta(hours=37)) == flows
    assert rid_hydro.with_backup(flows, None, NOW) == flows


def test_a_published_backup_is_judged_again_each_round_not_kept_once_filled():
    """write_snapshot writes the published file into the directory the next round reads: the backup filled in one
    round must expire after MAX_AGE and give way to a newer one, never stay as if the report had given it."""
    report = _flows()
    old = rid_hydro.collect(NOW, lambda code: C35 if code == "C.35" else b"[]")
    published = rid_hydro.with_backup(report, old, NOW)  # what round one wrote to disk and published
    assert {p.id: p for p in published.points}["c35"].flow_backup_at is not None
    # 37 hours later with no newer backup: the figure and its level go, and so does the link
    later = NOW + timedelta(hours=37)
    again = rid_hydro.with_backup(published, old, later)
    c35 = {p.id: p for p in again.points}["c35"]
    assert (c35.flow_cms, c35.level_m, c35.flow_backup_at) == (None, None, None) and again.backup_url is None
    assert again == report  # exactly the report's own points again
    # a newer backup replaces the old one
    newer = rid_hydro.collect(later, lambda code: C35.replace(b"1489", b"1111") if code == "C.35" else b"[]")
    fresh = rid_hydro.with_backup(published, newer, NOW + timedelta(hours=1))
    assert {p.id: p for p in fresh.points}["c35"].flow_cms == 1111.0
    # the report's own figures are never touched, and no backup at all clears a stale one
    assert {p.id: p for p in published.points}["c2"] == {p.id: p for p in report.points}["c2"]
    assert rid_hydro.with_backup(published, None, NOW) == report
