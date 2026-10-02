import json
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from fontokmai.contracts.forecast import RiverForecast
from fontokmai.forecast_build import (
    CALLS_KEY,
    RIVERS_PATH,
    budget,
    refresh_river_forecast,
    rivers_fresh,
)
from fontokmai.sources import glofas
from fontokmai.sources.open_data.http import OpenDataError, fixture_opener
from fontokmai.state import StateStore

FIXTURE = Path(__file__).parent / "fixtures" / "open_meteo" / "glofas_14_points.json"
NOW = datetime.fromisoformat("2026-09-27T11:42:00+07:00")
POINTS = glofas.load_points()
URL = glofas.request_url(POINTS)


def _opener(path: Path = FIXTURE):
    return fixture_opener({URL: path})


def test_river_points_are_fourteen_places_on_the_main_rivers():
    assert len(POINTS) == 14
    assert len({p["id"] for p in POINTS}) == 14
    for point in POINTS:
        lon, lat = point["location"]
        assert 97 < lon < 106 and 5 < lat < 21, point["id"]
    # one request, and Open-Meteo counts 37 days of a location as three calls
    assert glofas.calls(len(POINTS)) == 42


def test_collect_reads_every_point_and_day_of_the_recorded_answer():
    spent = []
    forecast = glofas.collect(NOW, opener=_opener(), spend=spent.append)
    assert spent == [42]
    assert len(forecast.points) == 14
    assert forecast.days[0] == date(2026, 9, 20) and forecast.days[-1] == date(2026, 10, 26)
    assert forecast.days[7] == date(2026, 9, 27)  # the day of the fetch
    bangkok = next(p for p in forecast.points if p.id == "cp-bangkok")
    assert bangkok.river_th == "แม่น้ำเจ้าพระยา"
    assert len(bangkok.discharge) == len(bangkok.median) == len(bangkok.p25) == len(bangkok.p75) == 37
    index = [p["id"] for p in POINTS].index("cp-bangkok")
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))[index]
    assert bangkok.median[10] == round(raw["daily"]["river_discharge_median"][10], 1)
    assert all(p.p25[d] is None or p.p75[d] is None or p.p25[d] <= p.p75[d]
               for p in forecast.points for d in range(37))
    assert forecast.credit_th.startswith("GloFAS")
    assert "ไม่ใช่ปริมาณหรือระดับน้ำที่วัดได้จริง" in forecast.notes_th[0]


def test_values_that_are_not_a_discharge_become_null(tmp_path):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    daily = data[0]["daily"]
    daily["river_discharge"][0] = -5
    daily["river_discharge"][1] = None
    daily["river_discharge"][2] = True
    daily["river_discharge"][3] = 1e9
    path = tmp_path / "answer.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    forecast = glofas.collect(NOW, opener=_opener(path))
    assert forecast.points[0].discharge[:5] == [None, None, None, None, round(daily["river_discharge"][4], 1)]


def test_an_answer_that_does_not_reach_today_or_misses_points_is_refused(tmp_path):
    with pytest.raises(OpenDataError, match="does not reach the day of the fetch"):
        glofas.collect(NOW + timedelta(days=60), opener=_opener())
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))[:13]
    path = tmp_path / "short.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(OpenDataError, match="for 14 points"):
        glofas.collect(NOW, opener=_opener(path))
    with pytest.raises(ValueError, match="UTC offset"):
        glofas.collect(NOW.replace(tzinfo=None), opener=_opener())


def test_a_series_of_the_wrong_length_breaks_the_contract():
    forecast = glofas.collect(NOW, opener=_opener())
    data = json.loads(forecast.model_dump_json())
    data["points"][0]["median"] = data["points"][0]["median"][:-1]
    with pytest.raises(ValidationError, match="one value per day"):
        RiverForecast.model_validate(data)


def test_refresh_runs_once_a_day_within_the_shared_open_meteo_budget(tmp_path):
    out, db = tmp_path / "out", tmp_path / "state.db"
    assert refresh_river_forecast(out, db, NOW, opener=_opener(), points=POINTS) == "built 14 rivers x 37 days"
    assert RiverForecast.model_validate_json((out / RIVERS_PATH).read_bytes()).fetched_at == NOW
    assert rivers_fresh(out, NOW + timedelta(hours=19))
    assert refresh_river_forecast(out, db, NOW + timedelta(hours=19), opener=_opener(), points=POINTS) is None
    with StateStore(db) as store:
        assert budget(store).used(NOW) == 42
        assert store.get_meta(CALLS_KEY)  # the same count the rain forecast spends from
    # a day later with the rain forecast having used nearly all of the budget: wait, do not go over
    later = NOW + timedelta(hours=21)
    with StateStore(db) as store:
        budget(store, 100).spend(later, 50)
    assert refresh_river_forecast(out, db, later, opener=_opener(), points=POINTS, limit=100).startswith(
        "waiting for the Open-Meteo budget: 92 of 100")


def test_a_failed_refresh_waits_before_trying_again(tmp_path):
    out, db = tmp_path / "out", tmp_path / "state.db"
    broken = fixture_opener({})
    assert refresh_river_forecast(out, db, NOW, opener=broken, points=POINTS).startswith("error: OpenDataError")
    later = (NOW + timedelta(hours=1), NOW + timedelta(hours=2))
    assert refresh_river_forecast(out, db, later[0], opener=_opener(), points=POINTS) == "waiting to retry"
    assert refresh_river_forecast(out, db, later[1], opener=_opener(), points=POINTS) == "built 14 rivers x 37 days"
