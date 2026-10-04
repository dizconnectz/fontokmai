"""The canals that may overflow, by this site's trial rules (D35, contract section 27): each factor's points, old data
left out, and a canal without data said to be not assessed (Codex M48–M50)."""

from datetime import UTC, date, datetime, timedelta, timezone
from importlib import resources

import pytest

from fontokmai.canal_outlook import build_canal_outlook
from fontokmai.contracts.bkk import CanalLevels, CanalStation
from fontokmai.contracts.forecast import ForecastLattice, RainForecast
from fontokmai.sources import rid_report
from fontokmai.sources.rid_report import Figure

NOW = datetime(2026, 10, 3, 4, 0, tzinfo=UTC)  # 11:00 in Thailand
TODAY = date(2026, 10, 3)
ICT = timezone(timedelta(hours=7))
NOW_ICT = NOW.astimezone(ICT)
LINES = resources.files("fontokmai.ref_data").joinpath("canals.json").read_bytes()


def flows(figures: dict[str, float], states: dict[str, str] | None = None, day: date = TODAY,
          flooded: list[str] | None = None) -> bytes:
    found = {point_id: Figure(flow=flow) for point_id, flow in figures.items()}
    return rid_report.build(found, states or {}, day, NOW, None, flooded or []).model_dump_json().encode()


def rain(mm: float) -> bytes:
    """A lattice over the Rangsit pilot: daily totals match, with dry future hours by default."""
    points = [[col, row] for row in range(5) for col in range(4)]
    days = [TODAY + timedelta(days=d) for d in range(3)]
    hours = [NOW_ICT + timedelta(hours=h) for h in range(1, 73)]
    value = round(mm * 10)
    return RainForecast(
        name_th="test", credit_th="test", source_url="https://open-meteo.com/", fetched_at=NOW,
        lattice=ForecastLattice(west=100.375, south=13.75, step=0.25), points=points, hours=hours,
        rain=[[0] * len(points) for _ in hours],
        days=days, day_rain=[[value] * len(points) for _ in days], day_probability=[[50] * len(points) for _ in days],
        day_code=[[61] * len(points) for _ in days], notes_th=[]).model_dump_json().encode()


def levels_at(at: datetime, before: datetime, rise_cm: float = 15, fetched: datetime = NOW) -> bytes:
    """Bangkok's file fetched at `fetched`, with one gauge on Hok Wa read at `at` and before that at `before`."""
    station = CanalStation(code="H1", name_th="ค.หกวา-ทดสอบ", canal_th="คลองหกวา", district_th=None, location=None,
                           observed_at=at, level_in_m=1.0, level_out_m=None, pumps=None,
                           previous_level_in_m=1.0 - rise_cm / 100, previous_observed_at=before)
    return CanalLevels(fetched_at=fetched, source_url="https://weather.bangkok.go.th/water/summary", credit_th="x",
                       stations=[station], notes_th=[]).model_dump_json().encode()


def levels(rise_cm: float) -> bytes:
    at = NOW - timedelta(minutes=30)
    return levels_at(at, at - timedelta(hours=3), rise_cm)


def outlook(now: datetime = NOW, **files: bytes):
    names = {"flows": "water/flows.json", "rain": "forecast/rain.json", "levels": "bkk/water.json"}
    result = build_canal_outlook({"ref/canals.json": LINES, **{names[k]: v for k, v in files.items()}}, now)
    return {canal.id: canal for canal in result.canals}, result


def test_water_let_into_the_raphiphat_and_very_heavy_rain_make_it_a_warning():
    canals, _ = outlook(flows=flows({"phranarai": 180}), rain=rain(95))
    raphiphat = canals["raphiphat"]
    assert (raphiphat.score, raphiphat.level) == (4, "warn")
    inflow = next(f for f in raphiphat.factors if f.kind == "inflow")
    assert inflow.points == 2 and "86% ของที่ปล่อยได้สูงสุด" in inflow.text_th
    assert next(f for f in raphiphat.factors if f.kind == "rain").points == 2


def test_half_the_intake_and_heavy_rain_make_a_watch_and_a_closed_gate_is_only_noted():
    canals, _ = outlook(flows=flows({"phranarai": 110}), rain=rain(40))
    assert (canals["raphiphat"].score, canals["raphiphat"].level) == (2, "watch")
    canals, _ = outlook(flows=flows({"phranarai": 0}), rain=rain(5))
    closed = next(f for f in canals["raphiphat"].factors if f.kind == "inflow")
    assert closed.points == 0 and "ปิด" in closed.text_th
    assert canals["raphiphat"].level is None


def test_a_river_in_flood_slows_the_canals_that_drain_to_it():
    canals, _ = outlook(flows=flows({"c29b": 2000}, states={"c29b": "flood"}))
    drainage = next(f for f in canals["rangsit"].factors if f.kind == "drainage")
    assert drainage.points == 2 and "กรมชลฯ จัดระดับน้ำท่วม" in drainage.text_th
    # or its flow near the channel's capacity, whichever says more
    canals, _ = outlook(flows=flows({"c29b": 3000}, states={"c29b": "normal"}))
    assert next(f for f in canals["premprachakon"].factors if f.kind == "drainage").points == 1


def test_bangkoks_gauges_rising_and_rids_flood_report_add_a_point_each():
    canals, _ = outlook(flows=flows({}, flooded=["1306"]), levels=levels(15))
    kinds = {f.kind: f.points for f in canals["hokwa"].factors}
    assert kinds["level"] == 1 and kinds["flooding"] == 1
    canals, _ = outlook(levels=levels(5))  # a rise of 5 cm is no factor
    assert not [f for f in canals["hokwa"].factors if f.kind == "level"]


def test_old_data_is_left_out_and_said_so():
    canals, result = outlook(flows=flows({"phranarai": 200}, day=TODAY - timedelta(days=3)), rain=rain(95))
    assert not [f for f in canals["raphiphat"].factors if f.kind == "inflow"]
    assert any("ไม่มีรายงานกรมชลประทานที่ใหม่พอ" in note for note in result.notes_th)
    assert [c.id for c in result.canals][0] in canals  # every canal is listed, the highest score first
    assert len(result.canals) == len(canals) == 6


def test_m48_a_level_counts_by_the_time_of_its_reading_never_by_the_file_that_brought_it():
    # a file fetched now that brings a reading of three days ago
    old = levels_at(NOW - timedelta(days=3), NOW - timedelta(days=3, hours=3))
    canals, _ = outlook(flows=flows({}, flooded=["1306"]), levels=old)
    hokwa = canals["hokwa"]
    assert not [f for f in hokwa.factors if f.kind == "level"]
    assert [g.text_th for g in hokwa.gaps if g.kind == "level"] == [
        "ไม่มีค่าวัดระดับน้ำล่าสุดพร้อมค่าก่อนหน้าที่เทียบกันได้ภายใน 6 ชม."]
    assert (hokwa.score, hokwa.level) == (1, None)
    # a reading ahead of the clock, a comparison later than the reading, or one too far back count nothing either
    for at, before in ((NOW + timedelta(hours=1), NOW - timedelta(hours=2)), (NOW - timedelta(hours=1), NOW),
                       (NOW - timedelta(hours=1), NOW - timedelta(hours=8))):
        canals, _ = outlook(levels=levels_at(at, before))
        assert not [f for f in canals["hokwa"].factors if f.kind == "level"], (at, before)
    # a recent rise counts, said with the hours it rose in and the time of the reading
    canals, _ = outlook(levels=levels(15))
    level = next(f for f in canals["hokwa"].factors if f.kind == "level")
    assert level.text_th == "ระดับน้ำที่ ค.หกวา-ทดสอบ สูงขึ้น 15 ซม. ใน 3 ชม. (วัดเมื่อ 10:30 น.)"
    assert level.at == NOW - timedelta(minutes=30)


def test_m49_the_rain_classes_are_tmds_from_35_1_and_90_1_mm():
    expected = {34.9: (0, None), 35.0: (0, None), 35.1: (1, "watch"), 89.9: (1, "watch"), 90.0: (1, "watch"),
                90.1: (2, "warn")}
    for mm, (points, level) in expected.items():
        # the Raphiphat intake at half of the most it lets in adds one point
        canals, _ = outlook(flows=flows({"phranarai": 110}), rain=rain(mm))
        rain_factor = next(f for f in canals["raphiphat"].factors if f.kind == "rain")
        assert (rain_factor.points, canals["raphiphat"].level) == (points, level), mm
    canals, _ = outlook(rain=rain(35.1))
    assert next(f for f in canals["raphiphat"].factors).text_th.startswith("พยากรณ์ฝนหนัก สูงสุดราว 35.1 มม.")
    canals, _ = outlook(rain=rain(90.1))
    assert next(f for f in canals["raphiphat"].factors).text_th.startswith("พยากรณ์ฝนหนักมาก สูงสุดราว 90.1 มม.")
    canals, _ = outlook(rain=rain(35))
    assert next(f for f in canals["raphiphat"].factors).text_th.startswith("พยากรณ์ฝนไม่ถึงเกณฑ์ฝนหนัก สูงสุดราว 35 มม.")


def test_m58_canal_rain_uses_only_the_full_forecast_hours_still_ahead_today():
    forecast = RainForecast.model_validate_json(rain(0))
    rows = [[0] * len(forecast.points) for _ in forecast.hours]
    rows[0] = [500] * len(forecast.points)  # 50 mm in the hour that started before now; exclude it
    rows[1] = [200] * len(forecast.points)
    rows[2] = [200] * len(forecast.points)
    daily = [[1000] * len(forecast.points), [0] * len(forecast.points), [0] * len(forecast.points)]
    forecast = forecast.model_copy(update={"rain": rows, "day_rain": daily})
    canals, _ = outlook(now=NOW + timedelta(minutes=30), rain=forecast.model_dump_json().encode())
    factor = next(f for f in canals["raphiphat"].factors if f.kind == "rain")
    assert factor.points == 1  # 40 mm from full hours ahead; neither past daily rain nor the current partial hour
    assert "สูงสุดราว 40 มม." in factor.text_th and "ช่วงที่เหลือของวัน" in factor.text_th


def test_m58_a_partly_elapsed_hour_is_not_counted_as_future_canal_rain():
    forecast = RainForecast.model_validate_json(rain(0))
    rows = [[0] * len(forecast.points) for _ in forecast.hours]
    rows[0] = [1000] * len(forecast.points)  # 100 mm for 11:00–12:00; now is 11:30
    forecast = forecast.model_copy(update={"rain": rows})
    canals, _ = outlook(now=NOW + timedelta(minutes=30), rain=forecast.model_dump_json().encode())
    canal = canals["raphiphat"]
    factor = next(f for f in canal.factors if f.kind == "rain")
    assert factor.points == 0 and canal.level is None


def test_m58_missing_future_hour_cannot_prove_a_dry_canal_forecast():
    forecast = RainForecast.model_validate_json(rain(0))
    rows = [list(row) for row in forecast.rain]
    rows[3] = [None] * len(forecast.points)
    forecast = forecast.model_copy(update={"rain": rows})
    canals, _ = outlook(rain=forecast.model_dump_json().encode())
    canal = canals["raphiphat"]
    assert not canal.assessed and canal.level is None
    assert any(g.kind == "rain" for g in canal.gaps)


def test_m50_without_its_data_a_canal_is_not_assessed_never_below_the_rules():
    canals, result = outlook()  # the lines alone
    assert all(not c.assessed and c.level is None and c.score == 0 for c in result.canals)
    hokwa = canals["hokwa"]
    assert [g.kind for g in hokwa.gaps] == ["inflow", "flooding", "rain", "level"]
    assert hokwa.gaps[0].text_th == "รายงานกรมชลประทาน ไม่มีในรอบนี้"
    assert {i.source: i.status for i in result.inputs} == {"flows": "missing", "rain": "missing", "levels": "missing"}
    assert sum("ไม่มีระดับน้ำ กทม. ที่ใหม่พอ" in note for note in result.notes_th) == 1
    # some of the data: assessed, with what could not be judged said
    canals, _ = outlook(rain=rain(5))
    assert canals["rangsit"].assessed
    assert [g.kind for g in canals["rangsit"].gaps] == ["inflow", "drainage", "flooding"]
    # old data: said with its time
    canals, result = outlook(flows=flows({"phranarai": 0}, day=TODAY - timedelta(days=3)), rain=rain(5))
    assert next(i for i in result.inputs if i.source == "flows").status == "stale"
    assert canals["rangsit"].gaps[0].text_th == "รายงานกรมชลประทาน เก่าเกินเกณฑ์ (ข้อมูล 30/09 06:00 น.)"
    # all of it there and nothing adding up: assessed, nothing missing, no points
    canals, result = outlook(flows=flows({"phranarai": 0, "phrasrisaowaphak": 0}), rain=rain(5), levels=levels(0))
    assert (canals["hokwa"].assessed, canals["hokwa"].gaps, canals["hokwa"].score) == (True, [], 0)
    assert {i.status for i in result.inputs} == {"fresh"}


@pytest.mark.parametrize("rise,points", [(9.49, 0), (9.6, 0), (9.99, 0), (10, 1), (10.1, 1)])
def test_m52_level_threshold_uses_the_unrounded_change(rise, points):
    canals, _ = outlook(levels=levels(rise))
    canal = canals["hokwa"]
    assert canal.assessed and not any(g.kind == "level" for g in canal.gaps)
    assert sum(f.points for f in canal.factors if f.kind == "level") == points


@pytest.mark.parametrize("comparison", ["missing", "same_time", "later", "too_old"])
def test_m52_a_current_level_without_a_valid_comparison_cannot_establish_a_trend(comparison):
    water = CanalLevels.model_validate_json(levels(15))
    station = water.stations[0]
    before = {
        "missing": None,
        "same_time": station.observed_at,
        "later": NOW,
        "too_old": station.observed_at - timedelta(hours=7),
    }[comparison]
    water = water.model_copy(update={"stations": [station.model_copy(update={"previous_observed_at": before})]})
    canals, _ = outlook(levels=water.model_dump_json().encode())
    canal = canals["hokwa"]
    assert not canal.assessed and canal.score == 0 and canal.level is None
    assert any(g.kind == "level" for g in canal.gaps)


def test_m53_partial_rid_figures_expose_the_unassessed_inflow_and_drainage():
    canals, _ = outlook(flows=flows({}))
    assert {g.kind for g in canals["rangsit"].gaps} >= {"inflow", "drainage"}
    canals, _ = outlook(flows=flows({"phranarai": 0, "phrasrisin": 0, "phrasrisaowaphak": 0,
                                   "c29b": 2000}))
    assert not {g.kind for g in canals["rangsit"].gaps} & {"inflow", "drainage"}


@pytest.mark.parametrize("mm", [0, 95])
def test_m53_partial_forecast_cannot_establish_below_threshold(mm):
    forecast = RainForecast.model_validate_json(rain(mm))
    if mm:
        rows = [list(row) for row in forecast.rain]
        rows[0] = [round(mm * 10)] * len(forecast.points)
        forecast = forecast.model_copy(update={"rain": rows})
    partial = forecast.model_copy(update={"day_rain": [forecast.day_rain[0]] +
                                         [[None] * len(forecast.points) for _ in range(2)]})
    canals, _ = outlook(rain=partial.model_dump_json().encode())
    canal = canals["rangsit"]
    assert any(g.kind == "rain" for g in canal.gaps)
    assert canal.assessed == (mm > 0)
    assert canal.level == ("watch" if mm > 0 else None)


def test_m53_documents_dated_in_the_future_are_not_used_as_current_factors():
    forecast = RainForecast.model_validate_json(rain(95)).model_copy(update={"fetched_at": NOW + timedelta(days=1)})
    canals, result = outlook(flows=flows({"phranarai": 200}, day=TODAY + timedelta(days=1)),
                              rain=forecast.model_dump_json().encode())
    assert all(not c.assessed and c.score == 0 for c in canals.values())
    assert all(item.status != "fresh" for item in result.inputs)
