"""The canals that may overflow, by this site's trial rules (D35, contract section 27): each factor's points, and old
data left out."""

from datetime import UTC, date, datetime, timedelta
from importlib import resources

from fontokmai.canal_outlook import build_canal_outlook
from fontokmai.contracts.bkk import CanalLevels, CanalStation
from fontokmai.contracts.forecast import ForecastLattice, RainForecast
from fontokmai.sources import rid_report
from fontokmai.sources.rid_report import Figure

NOW = datetime(2026, 10, 3, 4, 0, tzinfo=UTC)  # 11:00 in Thailand
TODAY = date(2026, 10, 3)
LINES = resources.files("fontokmai.ref_data").joinpath("canals.json").read_bytes()


def flows(figures: dict[str, float], states: dict[str, str] | None = None, day: date = TODAY,
          flooded: list[str] | None = None) -> bytes:
    found = {point_id: Figure(flow=flow) for point_id, flow in figures.items()}
    return rid_report.build(found, states or {}, day, NOW, None, flooded or []).model_dump_json().encode()


def rain(mm: float) -> bytes:
    """A lattice over the Rangsit pilot with the same rain each day at every point."""
    points = [[col, row] for row in range(5) for col in range(4)]
    days = [TODAY + timedelta(days=d) for d in range(3)]
    value = int(mm * 10)
    return RainForecast(
        name_th="test", credit_th="test", source_url="https://open-meteo.com/", fetched_at=NOW,
        lattice=ForecastLattice(west=100.375, south=13.75, step=0.25), points=points, hours=[], rain=[],
        days=days, day_rain=[[value] * len(points) for _ in days], day_probability=[[50] * len(points) for _ in days],
        day_code=[[61] * len(points) for _ in days], notes_th=[]).model_dump_json().encode()


def levels(rise_cm: float) -> bytes:
    at = NOW - timedelta(minutes=30)
    station = CanalStation(code="H1", name_th="ค.หกวา-ทดสอบ", canal_th="คลองหกวา", district_th=None, location=None,
                           observed_at=at, level_in_m=1.0, level_out_m=None, pumps=None,
                           previous_level_in_m=1.0 - rise_cm / 100, previous_observed_at=at - timedelta(hours=3))
    return CanalLevels(fetched_at=at, source_url="https://weather.bangkok.go.th/water/summary", credit_th="x",
                       stations=[station], notes_th=[]).model_dump_json().encode()


def outlook(**files: bytes):
    names = {"flows": "water/flows.json", "rain": "forecast/rain.json", "levels": "bkk/water.json"}
    result = build_canal_outlook({"ref/canals.json": LINES, **{names[k]: v for k, v in files.items()}}, NOW)
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
