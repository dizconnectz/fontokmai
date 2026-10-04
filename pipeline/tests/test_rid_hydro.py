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
