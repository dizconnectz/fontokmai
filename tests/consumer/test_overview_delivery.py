"""Black-box checks of the producer consumed by contract 21; all inputs are synthetic."""

import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fontokmai.contracts.forecast import RainForecast
from fontokmai.contracts.live_floods import LiveFloods
from fontokmai.contracts.places import Place
from fontokmai.overview_build import Gazetteer, build_overview

NOW = datetime.fromisoformat("2026-09-28T16:30:00+07:00")
EXAMPLES = Path(__file__).resolve().parents[2] / "contracts/v1/examples"


def gazetteer(count=10, districts=False):
    places = {}
    cells = defaultdict(list)
    for kind, code in [("province", "13"), ("district", "1301")]:
        places[code] = Place(
            kind=kind, code=code, name=code, label=code, location=[100, 14]
        )
    for n in range(count):
        district = f"13{n + 1:02}" if districts else "1301"
        location = [100 + (n % 10) * 0.25, 14 + (n // 10) * 0.25]
        if districts:
            places[district] = Place(
                kind="district",
                code=district,
                name=district,
                label=district,
                location=location,
            )
        code = district + ("01" if districts else f"{n + 1:02}")
        p = Place(
            kind="subdistrict", code=code, name=code, label=code, location=location
        )
        places[code] = p
        cells[(math.floor(location[0] / 0.2), math.floor(location[1] / 0.2))].append(p)
    return Gazetteer(places, dict(cells))


def forecast(tomorrow, hourly=0):
    days = [NOW.date() + timedelta(days=n) for n in range(7)]
    hours = [NOW.replace(minute=0) + timedelta(hours=n + 1) for n in range(72)]
    return RainForecast(
        name_th="ฝนจำลอง",
        credit_th="synthetic",
        source_url="https://example.org/",
        fetched_at=NOW,
        lattice={"west": 100, "south": 14, "step": 0.25},
        points=[[n, 0] for n in range(10)],
        hours=hours,
        rain=[[hourly] * 10 for _ in hours],
        days=days,
        day_rain=[[9000] * 10, tomorrow, [0] * 10, *[[0] * 10 for _ in range(4)]],
        day_probability=[[None] * 10 for _ in days],
        day_code=[[None] * 10 for _ in days],
        notes_th=[],
    )


def build(file, now=NOW):
    return build_overview(
        {"forecast/rain.json": file.model_dump_json().encode()}, now, gazetteer()
    )


def tomorrow_reason(result):
    return next(
        r
        for i in result.items
        for r in i.reasons
        if r.kind == "rain_forecast" and r.day == NOW.date() + timedelta(days=1)
    )


def test_today_does_not_reuse_daily_total_that_includes_past_rain():
    result = build(forecast([0] * 10))
    assert (
        result.items == []
    )  # the 900 mm daily total is in the past, remaining hours are dry


def test_today_accumulates_only_remaining_hours_and_handles_null():
    file = forecast([0] * 10, hourly=100)  # eight hours remaining = 80 mm
    result = build(file)
    reason = next(
        r for i in result.items for r in i.reasons if r.kind == "rain_forecast"
    )
    assert "80 มม." in reason.text_th and reason.day == NOW.date()
    file.rain[0] = [None] * 10
    result = build(file)
    assert not any(
        r.kind == "rain_forecast" and r.day == NOW.date()
        for i in result.items
        for r in i.reasons
    )


@pytest.mark.parametrize("age", [timedelta(hours=12, seconds=1), timedelta(minutes=-6)])
def test_untrusted_forecast_age_cannot_raise_a_place(age):
    file = forecast([1000] * 10).model_copy(update={"fetched_at": NOW - age})
    result = build(file)
    assert not result.items
    assert next(i for i in result.inputs if "Open-Meteo" in i.name_th).status == "stale"


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="M24: the extent uses heavy cells even when the word is very heavy",
)
def test_very_heavy_in_one_of_ten_cells_does_not_mean_very_heavy_province_wide():
    reason = tomorrow_reason(build(forecast([1000] + [400] * 9)))
    assert "ฝนหนักมากเกือบทั้งจังหวัด" not in reason.text_th


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="M24: null cells disappear from the spatial denominator",
)
def test_one_known_wet_cell_and_nine_missing_cells_cannot_mean_province_wide():
    result = build(forecast([1000] + [None] * 9))
    assert not any("เกือบทั้งจังหวัด" in r.text_th for i in result.items for r in i.reasons)


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="M23: official provenance has not been verified",
)
def test_experimental_three_day_rule_does_not_claim_hii_authority():
    file = forecast([500] * 10, hourly=100)
    file.day_rain[2] = [500] * 10
    reason = next(
        r for i in build(file).items for r in i.reasons if r.kind == "rain_3days"
    )
    assert "ของ สสน." not in reason.text_th


def test_forty_district_limit_and_rural_road_names_survive_busy_round():
    g = gazetteer(45, districts=True)
    reports = []
    for p in g.places.values():
        if p.kind != "subdistrict":
            continue
        for n in range(2):
            reports.append(
                {
                    "id": f"{p.code}-{n}",
                    "title_th": "น้ำท่วม",
                    "road_th": "ทางหลวงชนบทหมายเลข ปท.3001",
                    "location": p.location,
                    "start": NOW - timedelta(minutes=10),
                    "stop": None,
                    "reporter": "public",
                    "url": "https://example.org/report",
                }
            )
    feed = LiveFloods(
        fetched_at=NOW,
        source_url="https://example.org/",
        credit_th="synthetic",
        reports=reports,
        notes_th=[],
    )
    files = {"live/floods.json": feed.model_dump_json().encode()}
    result = build_overview(files, NOW, g)
    assert len(result.items) == 40
    assert len({i.place_th for i in result.items}) == 40
    assert all(i.detail_th == "แถว ทช.ปท.3001" for i in result.items)
    assert build_overview(files, NOW + timedelta(minutes=46), g).items == []


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="M26: dam report_date is ignored when the download is fresh",
)
def test_fresh_download_does_not_make_an_old_dam_observation_current():
    import json

    file = json.loads((EXAMPLES / "bkk/dams.json").read_text(encoding="utf-8"))
    file.update(fetched_at=NOW.isoformat(), report_date=date(2026, 9, 1).isoformat())
    file["dams"][0].update(percent=101, location=[100, 14])
    result = build_overview(
        {"water/dams.json": json.dumps(file).encode()}, NOW, gazetteer()
    )
    assert not any(r.kind == "dam_full" for i in result.items for r in i.reasons)
