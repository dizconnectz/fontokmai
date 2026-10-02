import json
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path

from fontokmai.contracts.forecast import RiverForecast
from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.river_lines import RiverLines
from fontokmai.examples import RIVER_LINES_EXAMPLE, write_river_lines_example
from fontokmai.forecast_build import refresh_river_forecast
from fontokmai.overview_build import Gazetteer, build_overview
from fontokmai.run import run_cap_snapshot
from fontokmai.sources import glofas
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES

EXAMPLES = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "examples"


def _shipped() -> RiverLines:
    return RiverLines.model_validate_json(
        resources.files("fontokmai.ref_data").joinpath("river_lines.json").read_bytes())


def test_every_stretch_belongs_to_a_point_of_its_own_river():
    """User 2026-10-02: a river is coloured stretch by stretch, each by the GloFAS point nearest on that river."""
    stations, reaches = glofas.load_points(), glofas.load_reaches()
    assert all(p["kind"] == "reach" for p in reaches) and all("kind" not in p for p in stations)
    points = {p["id"]: p for p in stations + reaches}
    assert len(points) == len(stations) + len(reaches) and glofas.all_points() == stations + reaches
    lines = _shipped()
    assert lines.license == "ODbL 1.0" and "OpenStreetMap" in lines.credit_th
    for stretch in lines.stretches:
        assert points[stretch.point_id]["river_th"] == stretch.river_th, stretch.point_id
        for line in stretch.line.coordinates:
            assert all(97 <= lon <= 106 and 5 <= lat <= 21 for lon, lat in line)
    # every point colours some river, and every station of the list has its own stretch
    assert {s.point_id for s in lines.stretches} == set(points)
    # a reach point stands on the main stream: named after a Thai district and about 50 km from its neighbours
    assert all(p["name_th"].split(" ช่วง ")[0] == p["river_th"].removeprefix("แม่น้ำ") for p in reaches)


def test_reach_points_join_the_daily_fetch_but_not_the_summary(tmp_path, monkeypatch):
    asked = []

    def fake(out_dir, now, *, opener=None, points=None, spend=None):
        asked.append(points)
        raise RuntimeError("no network in tests")
    monkeypatch.setattr("fontokmai.forecast_build.build_river_forecast", fake)
    now = datetime(2026, 10, 2, 4, 0, tzinfo=UTC)
    refresh_river_forecast(tmp_path / "out", tmp_path / "s.db", now)
    assert asked == [glofas.all_points()]
    # a reach point rising a lot colours its stretch; the list "เตรียมรับมือ" keeps to the stations
    rivers = json.loads((EXAMPLES / "forecast" / "rivers.json").read_text(encoding="utf-8"))
    station = next(p for p in rivers["points"] if p["id"] == "bangpakong-chachoengsao")
    reach = {**station, "id": "bangpakong-r09", "kind": "reach", "name_th": "บางปะกง ช่วงทดสอบ"}
    rivers["points"] = [reach]
    files = {"forecast/rivers.json": RiverForecast.model_validate(rivers).model_dump_json().encode()}
    at = datetime.fromisoformat("2026-09-27T12:00:00+07:00")
    assert build_overview(files, at, Gazetteer.load()).items == []
    rivers["points"] = [station]
    files = {"forecast/rivers.json": RiverForecast.model_validate(rivers).model_dump_json().encode()}
    assert [i.place_th for i in build_overview(files, at, Gazetteer.load()).items] == ["แม่น้ำบางปะกง ที่ฉะเชิงเทรา"]


def test_a_point_says_whether_it_is_a_station_or_a_reach():
    days = ["2026-10-01", "2026-10-02"]
    answer = {"daily": {"time": days, **{field: [1.0, 2.0] for field in glofas.FIELDS}}}
    points = glofas.load_points()[:1] + glofas.load_reaches()[:1]
    forecast = glofas.build_forecast([answer, answer], points, datetime(2026, 10, 2, 4, 0, tzinfo=UTC))
    assert [p.kind for p in forecast.points] == ["station", "reach"]


def test_snapshot_publishes_the_river_lines(tmp_path):
    out = tmp_path / "v1"
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                     now=datetime(2026, 9, 25, 11, 20, tzinfo=UTC), writer="t", owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert "ref/river_lines.json" in [f.path for f in manifest.files]


def test_river_lines_example_is_a_cut_of_the_shipped_file(tmp_path):
    [path] = write_river_lines_example(tmp_path)
    example = RiverLines.model_validate_json(path.read_bytes())
    assert {s.point_id for s in example.stretches} == set(RIVER_LINES_EXAMPLE)
    shipped = {(s.point_id, s.river_th): s for s in _shipped().stretches}
    assert all(shipped[(s.point_id, s.river_th)] == s for s in example.stretches)
