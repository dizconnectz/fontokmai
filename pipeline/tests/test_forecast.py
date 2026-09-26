import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from fontokmai.contracts.forecast import RainForecast
from fontokmai.contracts.manifest import Manifest
from fontokmai.examples import FORECAST_FETCHED_AT, forecast_fixture_run, write_forecast_example
from fontokmai.forecast_build import FORECAST_PATH, default_lattice, is_fresh
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.open_data.http import OpenDataError
from fontokmai.sources.open_meteo import BATCH, batch_url, build_forecast, collect, lonlat
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES

OPEN_METEO = Path(__file__).parent / "fixtures" / "open_meteo"
FETCHED = datetime.fromisoformat(FORECAST_FETCHED_AT)


def test_the_lattice_covers_thai_land_within_the_free_call_budget():
    lattice, points = default_lattice()
    assert (lattice.west, lattice.south, lattice.step) == (97.5, 5.5, 0.25)
    assert 850 <= len(points) <= 1000  # each point is one API call; 4 runs a day stay far below 10,000
    assert points == sorted(points, key=lambda p: (p[1], p[0])) and len({tuple(p) for p in points}) == len(points)
    lons, lats = zip(*(lonlat(lattice, p) for p in points), strict=True)
    assert 97 <= min(lons) and max(lons) <= 106 and 5 <= min(lats) and max(lats) <= 21
    assert (100.5, 13.75) in set(zip(lons, lats, strict=True))  # Bangkok


def test_a_recorded_answer_becomes_72_hours_and_7_days(tmp_path):
    forecast = forecast_fixture_run(tmp_path, OPEN_METEO, FETCHED)
    assert len(forecast.points) == 12 and len(forecast.hours) == 72 and len(forecast.days) == 7
    # hourly values are the rain of the hour that ends at the given time, starting with the current hour
    assert forecast.hours[0] == datetime.fromisoformat("2026-09-26T12:00:00+07:00")
    assert forecast.hours[-1] - forecast.hours[0] == timedelta(hours=71)
    raw = json.loads((OPEN_METEO / "bangkok_12_points.json").read_text(encoding="utf-8"))
    noon = raw[4]["hourly"]["time"].index("2026-09-26T12:00")
    assert forecast.rain[0][4] == round(raw[4]["hourly"]["precipitation"][noon] * 10)  # Bangkok, 0.1 mm
    assert forecast.day_rain[0][4] == round(raw[4]["daily"]["precipitation_sum"][0] * 10)
    assert forecast.day_probability[0][4] == raw[4]["daily"]["precipitation_probability_max"][0]
    assert forecast.day_code[0][4] == raw[4]["daily"]["weather_code"][0]
    assert RainForecast.model_validate_json((tmp_path / FORECAST_PATH).read_bytes()) == forecast


def test_requests_come_in_batches_and_odd_answers_are_refused():
    lattice, points = default_lattice()
    asked: list[str] = []

    def opener(url):
        asked.append(url)
        raise OpenDataError("offline")

    with pytest.raises(OpenDataError):
        collect(FETCHED, lattice, points, opener=opener, pause=0)
    assert asked == [batch_url([lonlat(lattice, p) for p in points[:BATCH]])]
    assert asked[0].startswith("https://api.open-meteo.com/v1/forecast?")
    one = {"hourly": {"time": ["2026-09-26T12:00"], "precipitation": [-1]},
           "daily": {"time": ["2026-09-26"], "precipitation_sum": [None], "precipitation_probability_max": [101],
                     "weather_code": [95]}}
    odd = build_forecast([one], lattice, points[:1], FETCHED)
    assert (odd.rain, odd.day_rain, odd.day_probability, odd.day_code) == ([[None]], [[None]], [[None]], [[95]])
    other = {**one, "hourly": {"time": ["2026-09-26T13:00"], "precipitation": [0]}}
    with pytest.raises(OpenDataError, match="time axis"):
        build_forecast([one, other], lattice, points[:2], FETCHED)
    with pytest.raises(OpenDataError, match="no hour after now"):
        build_forecast([one], lattice, points[:1], FETCHED + timedelta(hours=3))
    with pytest.raises(OpenDataError, match="not understood"):
        build_forecast([{"hourly": {}}], lattice, points[:1], FETCHED)


def test_the_forecast_is_rebuilt_every_six_hours_and_published_with_the_snapshot(tmp_path):
    out = tmp_path / "v1"
    assert not is_fresh(out, FETCHED)
    forecast_fixture_run(out, OPEN_METEO, FETCHED)
    assert is_fresh(out, FETCHED + timedelta(hours=5)) and not is_fresh(out, FETCHED + timedelta(hours=6))
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                     now=datetime(2026, 9, 25, 11, 20, tzinfo=UTC), writer="t", owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert FORECAST_PATH in [f.path for f in manifest.files]


def test_forecast_example_is_reproducible(tmp_path):
    [first] = write_forecast_example(tmp_path / "a", OPEN_METEO)
    [second] = write_forecast_example(tmp_path / "b", OPEN_METEO)
    assert first.read_bytes() == second.read_bytes()
    assert RainForecast.model_validate_json(first.read_bytes()).fetched_at == FETCHED
