import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from fontokmai.contracts.road_flood import RoadFloodHistory
from fontokmai.feeds.road_flood import search_roads
from fontokmai.road_flood_build import REF_PATH, build_road_flood_history, fixture_files, is_fresh
from fontokmai.sources.open_data import bma_road_flood, itic_events
from fontokmai.sources.open_data.http import OpenDataError, fixture_opener

FIXTURES = Path(__file__).parent / "fixtures" / "road_flood"
NOW = datetime(2025, 12, 20, 3, 0, tzinfo=UTC)
ICT = timezone(timedelta(hours=7))


def _build(tmp_path, *, opener=None, backfill=True, now=NOW):
    opener = opener or fixture_opener(fixture_files(FIXTURES))
    return build_road_flood_history(tmp_path / "out", tmp_path / "cache", now, opener=opener, backfill=backfill,
                                    first_year=2024)


def _road(history, key):
    return next(r for r in history.roads if r.key == key)


def test_bma_uses_yearly_files_only():
    package = json.loads((FIXTURES / "bma_package.json").read_text(encoding="utf-8"))
    assert [year for year, _ in bma_road_flood.yearly_resources(package)] == [2022, 2024, 2025]


def test_bma_decodes_tis620_lines_and_detects_day_first_dates():
    text = bma_road_flood.decode_lines((FIXTURES / "bma_legacy.csv").read_bytes())
    assert "ประชาสงเคราะห์" in text
    rows = list(__import__("csv").DictReader(__import__("io").StringIO(text)))
    assert bma_road_flood.date_order(rows) == "dmy"


def test_bma_rows_become_reports_with_local_times():
    reports, rejected = bma_road_flood.parse_year_file((FIXTURES / "bma_2022.csv").read_bytes(), 2022)
    assert rejected == 0 and len(reports) == 5
    first = reports[0]
    assert (first.date, first.names, first.spot, first.district) == (date(2022, 2, 4), ("สุขุมวิท",), "ซอยสุขุมวิท 39",
                                                                      "วัฒนา")
    assert (first.depth_cm, first.length_m, first.lanes, first.rain_mm) == (15, 400, "2 เลน", 35.0)
    assert first.start == datetime(2022, 2, 4, 18, 45, tzinfo=ICT)
    crossing = reports[-1]  # rain began 22 Oct, the road flooded after midnight
    assert crossing.date == date(2022, 10, 23) and crossing.stop == datetime(2022, 10, 23, 1, 30, tzinfo=ICT)


def test_bma_rejects_rows_outside_the_file_year():
    raw = ("frd_id,frd_rain_datestart,frd_rain_start,frd_rain_datestop,frd_rain_stop,district,frd_road,frd_area,"
           "frd_flood_height,frd_flood_distance,frd_flood_lane,frd_flood_date_begin,frd_flood_begin,"
           "frd_flood_date_end,frd_flood_end,frd_flood_total,frd_total_rainfall\n"
           "1,7/13/2026,:,0000-00-00,:,เขตวัฒนา,สุขุมวิท,x,15,,,,,,,,\n"
           "2,1/2/2024,10:00,1/2/2024,11:00,เขตวัฒนา,,y,,,,1/2/2024,10:30,1/2/2024,11:00,00:30,\n").encode()
    reports, rejected = bma_road_flood.parse_year_file(raw, 2024)
    assert rejected == 1 and len(reports) == 1 and reports[0].names == ()


def test_itic_keeps_flood_reports_inside_the_box():
    with (FIXTURES / "itic_2025.csv").open(encoding="utf-8-sig", newline="") as fh:
        rows, rejected = itic_events.parse_feed(fh, (100.20, 13.45, 100.95, 14.30))
    assert [r.eid for r in rows] == [856697, 861225, 861226] and rejected == 1
    report = itic_events.to_report(rows[2])
    assert report.names == ("ซอยสุขุมวิท 107",)
    assert report.url == "https://traffic.longdo.com/main/e/A00861226/"
    assert (report.lon, report.lat, report.date) == (100.609, 13.664, date(2025, 2, 18))


def test_history_counts_flood_days_per_road(tmp_path):
    history = _build(tmp_path)
    assert RoadFloodHistory.model_validate_json((tmp_path / "out" / REF_PATH).read_bytes()) == history
    sukhumvit = _road(history, "สุขุมวิท")
    # BMA: 2022-02-04 (two spots), 2022-10-23, 2024-11-17, 2025-04-15, 2025-05-10; iTIC: 2024-09-10, 2025-02-18
    assert (sukhumvit.flood_days, sukhumvit.reports) == (7, 8)
    assert sukhumvit.days_by_year == {"2022": 2, "2024": 2, "2025": 3}
    assert (sukhumvit.first_date, sukhumvit.last_date, sukhumvit.max_depth_cm) == (date(2022, 2, 4),
                                                                                 date(2025, 5, 10), 20)
    assert sukhumvit.districts[:2] == ["คลองเตย", "บางนา"]
    assert sukhumvit.points == [[100.601, 13.701], [100.58, 13.73]]
    assert [r.date for r in sukhumvit.recent] == sorted((r.date for r in sukhumvit.recent), reverse=True)
    assert _road(history, "อุโมงค์แยกดินแดง").kind == "tunnel"
    assert _road(history, "สุขุมวิท71").name_th == "สุขุมวิท 71"
    assert _road(history, "เพชรเกษม").recent[0].spot == "ซ.เพชรเกษม 42 *"  # spot stays as the source wrote it


def test_sources_report_periods_and_rows_without_place(tmp_path):
    history = _build(tmp_path)
    bma, itic = history.sources
    assert (bma.source_id, bma.reports, bma.rejected, bma.period_from, bma.period_to) == (
        "bma_road_flood_stats", 12, 0, date(2022, 2, 4), date(2025, 12, 5))
    assert (itic.reports, itic.reports_without_place, itic.rejected) == (6, 1, 1)
    assert history.roads == sorted(history.roads, key=lambda r: r.key)


def test_search_matches_part_of_the_key_and_ranks_by_flood_days(tmp_path):
    history = _build(tmp_path)
    # one flood day each for the soi and สุขุมวิท 71: the later last_date (2025-02-18) comes first
    assert [r.key for r in search_roads(history, "ถนนสุขุมวิท")] == ["สุขุมวิท", "ซอยสุขุมวิท107", "สุขุมวิท71"]
    assert search_roads(history, "ถนน") == []


def test_finished_years_come_from_the_cache(tmp_path):
    calls = []
    base = fixture_opener(fixture_files(FIXTURES))

    @contextmanager
    def counting(url):
        calls.append(url)
        with base(url) as fh:
            yield fh

    _build(tmp_path, opener=counting)
    assert (tmp_path / "cache" / "itic_flood_2024.json").is_file()
    calls.clear()
    _build(tmp_path, opener=counting, backfill=False)
    assert itic_events.FEED_URL.format(year=2024) not in calls
    assert itic_events.FEED_URL.format(year=2025) in calls


def test_scheduled_refresh_never_downloads_the_archive(tmp_path):
    calls = []

    @contextmanager
    def offline(url):
        calls.append(url)
        raise OpenDataError("offline")
        yield  # pragma: no cover

    with pytest.raises(itic_events.BackfillNeeded):
        _build(tmp_path, opener=offline, backfill=False)
    assert calls == []


def test_freshness_follows_built_at(tmp_path):
    out = tmp_path / "out"
    assert not is_fresh(out, NOW)
    _build(tmp_path)
    assert is_fresh(out, NOW + timedelta(days=6))
    assert not is_fresh(out, NOW + timedelta(days=8))


def test_snapshot_publishes_a_valid_ref_file_and_skips_a_broken_one(tmp_path):
    from fontokmai.contracts.manifest import Manifest
    from fontokmai.run import run_cap_snapshot
    from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
    from helpers import FIXTURES as CAP_FIXTURES

    _build(tmp_path)
    out = tmp_path / "out"
    now = datetime(2026, 9, 25, 11, 20, tzinfo=UTC)
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(CAP_FIXTURES), now=now, writer="t",
                     owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert REF_PATH in [f.path for f in manifest.files]
    (out / REF_PATH).write_text('{"schema_version": "1"}', encoding="utf-8")
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(CAP_FIXTURES), now=now, writer="t",
                     owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert REF_PATH not in [f.path for f in manifest.files]


def test_cli_builds_from_fixtures(tmp_path, capsys):
    from fontokmai.cli import main

    args = ["road-flood-history", "--out", str(tmp_path / "v1"), "--cache", str(tmp_path / "cache"),
            "--first-year", "2024", "--fixtures", str(FIXTURES), "--now", "2025-12-20T10:00:00+07:00"]
    assert main(args) == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["roads"] == len(RoadFloodHistory.model_validate_json(
        (tmp_path / "v1" / REF_PATH).read_bytes()).roads)
    assert [s["source_id"] for s in summary["sources"]] == ["bma_road_flood_stats", "itic_longdo_events"]


def test_example_answers_are_reproducible(tmp_path):
    from fontokmai.examples import write_road_flood_example

    write_road_flood_example(tmp_path / "a", FIXTURES)
    write_road_flood_example(tmp_path / "b", FIXTURES)
    for name in ("road_flood_history.json", "expected.json"):
        assert (tmp_path / "a" / "road-flood-history" / name).read_bytes() == \
            (tmp_path / "b" / "road-flood-history" / name).read_bytes()
    expected = json.loads((tmp_path / "a" / "road-flood-history" / "expected.json").read_text(encoding="utf-8"))
    near = expected["near"][0]["results"]
    assert near[0]["key"] == "สุขุมวิท" and near[0]["distance_m"] < 200
    assert expected["near"][1]["results"] == []
    assert next(s for s in expected["searches"] if s["query"] == "ถนน")["results"] == []
