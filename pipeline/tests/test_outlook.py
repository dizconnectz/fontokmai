import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from io import BytesIO
from urllib.parse import parse_qs, urlparse

import pytest
from pydantic import ValidationError

from fontokmai.contracts.outlook import RainOutlook
from fontokmai.examples import write_outlook_example
from fontokmai.forecast_build import budget
from fontokmai.outlook_build import PATH, refresh
from fontokmai.sources import ensemble
from fontokmai.sources.open_data.http import OpenDataError
from fontokmai.state import StateStore

NOW = datetime.fromisoformat("2026-10-03T01:30:00+07:00")
POINTS = ensemble.load_points()[:2]
DAYS = [NOW.date() + timedelta(days=n) for n in range(1, 15)]


def answer(model, value=40):
    daily = {"time": [(NOW.date() + timedelta(days=n)).isoformat() for n in range(15)]}
    daily.update({"precipitation_sum" + (f"_member{n:02d}" if n else ""): [999] + [value] * 14
                  for n in range(ensemble.MODELS[model])})
    return {"longitude": 100.5, "latitude": 14.0, "utc_offset_seconds": 25200,
            "daily_units": {"precipitation_sum": "mm"}, "daily": daily}


@contextmanager
def opener(url):
    q = parse_qs(urlparse(url).query)
    assert q["forecast_days"] == ["15"] and q["timezone"] == ["Asia/Bangkok"]
    assert q["daily"] == ["precipitation_sum"]
    data = [answer(q["models"][0]) for _ in q["latitude"][0].split(",")]
    yield BytesIO(json.dumps(data).encode())


def offline(url):
    raise OpenDataError("offline")


def test_registry_covers_requested_rivers_and_rangsit_without_inventing_capacity():
    points = ensemble.load_points()
    assert len(points) == len({p.id for p in points}) == 18
    assert {p.area_id for p in points} == {"ping", "wang", "yom", "nan", "cp", "pasak", "rangsit"}
    assert all(p.bank_m is None and p.flow_capacity_m3s is None and p.pump_capacity_m3s is None
               and not p.gate_operation_known for p in points)
    assert ensemble.calls(18) == 432
    assert ensemble.PACE * 400 / 60 == ensemble.BATCH * ensemble.CALLS_PER_POINT_MODEL


def test_future_thai_days_and_independent_members_are_retained():
    spent = []
    result = ensemble.collect(NOW, points=POINTS, opener=opener, pause=0, spend=spent.append)
    assert result.days == DAYS and sum(spent) == 48
    assert result.spatial_scope == "sampled_points" and result.experimental
    for point in result.points:
        assert not point.missing_models
        for model in point.models:
            assert len(model.members) == ensemble.MODELS[model.model]
            assert model.issued_at is None and model.grid_location == [100.5, 14.0]
            assert model.members[0].rain_mm == [40] * 14  # today's 999 mm is deliberately excluded


@pytest.mark.parametrize("bad", [None, True, -1, 2001, float("nan")])
def test_missing_or_invalid_rain_is_never_zero(bad):
    data = answer("gfs05")
    data["daily"]["precipitation_sum"][1] = bad
    model = ensemble.parse(data, "gfs05", DAYS, NOW)
    assert model.members[0].rain_mm[0] is None
    assert model.members[1].rain_mm[0] == 40


def test_missing_last_day_is_unknown_instead_of_truncating_the_horizon():
    data = answer("gfs05")
    for values in data["daily"].values():
        values.pop()
    model = ensemble.parse(data, "gfs05", DAYS, NOW)
    assert all(len(m.rain_mm) == 14 and m.rain_mm[-1] is None for m in model.members)


@pytest.mark.parametrize("field,value", [("utc_offset_seconds", 0), ("daily_units", {})])
def test_wrong_units_or_timezone_are_rejected(field, value):
    data = answer("gfs05")
    data[field] = value
    with pytest.raises(OpenDataError):
        ensemble.parse(data, "gfs05", DAYS, NOW)


def test_partial_model_failure_is_explicit_and_failed_calls_are_counted():
    spent = []

    def partial(url):
        return offline(url) if "ecmwf_ifs025" in url else opener(url)

    result = ensemble.collect(NOW, points=POINTS, opener=partial, pause=0, spend=spent.append)
    assert sum(spent) == 48
    assert all(p.missing_models == ["ecmwf_ifs025"] and p.models[0].model == "gfs05"
               for p in result.points)


def test_atomic_failure_preserves_file_date_and_retry_uses_shared_budget(tmp_path):
    out, db = tmp_path / "data", tmp_path / "state.sqlite"
    assert refresh(out, db, NOW, opener=opener, pause=0, points=POINTS).startswith("built")
    old = (out / PATH).read_bytes()
    assert refresh(out, db, NOW + timedelta(hours=1), opener=offline, pause=0, points=POINTS) is None
    later = NOW + timedelta(hours=12)
    assert refresh(out, db, later, opener=offline, pause=0, points=POINTS).startswith("error:")
    assert (out / PATH).read_bytes() == old
    assert RainOutlook.model_validate_json(old).fetched_at == NOW
    assert "retry" in refresh(out, db, later + timedelta(minutes=15), opener=offline, points=POINTS)
    with StateStore(db) as store:
        assert budget(store).used(later) == 96


def test_exhausted_budget_never_starts_requests(tmp_path):
    db = tmp_path / "state.sqlite"
    with StateStore(db) as store:
        budget(store).spend(NOW, 7990)
    assert "budget" in refresh(tmp_path / "out", db, NOW, opener=opener, pause=0, points=POINTS)
    assert not (tmp_path / "out" / PATH).exists()


def test_contract_rejects_mismatched_days_and_duplicate_members(tmp_path):
    path = write_outlook_example(tmp_path)[0]
    raw = json.loads(path.read_text(encoding="utf-8"))
    RainOutlook.model_validate(raw)
    raw["points"][0]["models"][0]["members"][0]["rain_mm"].pop()
    with pytest.raises(ValidationError, match="one value per day"):
        RainOutlook.model_validate(raw)
    raw = json.loads(path.read_text(encoding="utf-8"))
    members = raw["points"][0]["models"][0]["members"]
    members[1]["id"] = members[0]["id"]
    with pytest.raises(ValidationError, match="unique"):
        RainOutlook.model_validate(raw)
