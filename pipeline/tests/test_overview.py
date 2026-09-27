from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from fontokmai.contracts.bkk import DamReport, RainGauges, RoadFloodingDaily
from fontokmai.contracts.forecast import ForecastLattice, RainForecast
from fontokmai.contracts.live_floods import LiveFloods
from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.overview import Overview
from fontokmai.overview_build import OVERVIEW_PATH, Gazetteer, build_overview
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES

NOW = datetime.fromisoformat("2026-09-27T16:30:00+07:00")
EXAMPLES = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "examples"
G = Gazetteer.load()
RANGSIT = [100.632, 13.987]  # ต.ประชาธิปัตย์ อ.ธัญบุรี


def _floods(reports, fetched=NOW):
    return LiveFloods(fetched_at=fetched, source_url="https://traffic.longdo.com/", credit_th="iTIC และ Longdo Traffic",
                      reports=reports, notes_th=[])


def _report(n, location, start, stop="auto", road="ถนนพหลโยธิน"):
    start = NOW - start
    return {"id": f"longdo:{n}", "title_th": f"น้ำท่วม {road}", "road_th": road, "location": location,
            "start": start, "stop": start + timedelta(hours=1) if stop == "auto" else stop,
            "reporter": "public", "url": f"https://traffic.longdo.com/e/{n}"}


def _dump(model):
    return model.model_dump_json().encode("utf-8")


def _lattice_forecast(fill, fetched=NOW, hourly=lambda h, lon, lat: 0):
    """A 0.25° lattice over central Thailand (Kanchanaburi to Chachoengsao): day_rain[d] = fill(d, lon, lat) and
    rain[h] = hourly(h, lon, lat), in 0.1 mm. The hours start at 17:00, so today has 8 hours to come (to 24:00)."""
    lattice = ForecastLattice(west=99.0, south=13.5, step=0.25)
    points = [[c, r] for r in range(5) for c in range(9)]
    today = NOW.date()
    days = [today + timedelta(days=d) for d in range(7)]
    hour0 = NOW.replace(minute=0, second=0, microsecond=0)
    hours = [hour0 + timedelta(hours=h + 1) for h in range(72)]
    lonlat = [(99.0 + c * 0.25, 13.5 + r * 0.25) for c, r in points]
    return RainForecast(
        name_th="พยากรณ์ฝน", credit_th="Open-Meteo", source_url="https://open-meteo.com/", fetched_at=fetched,
        lattice=lattice, points=points, hours=hours,
        rain=[[hourly(h, lon, lat) for lon, lat in lonlat] for h in range(len(hours))], days=days,
        day_rain=[[fill(d, lon, lat) for lon, lat in lonlat] for d in range(7)],
        day_probability=[[50] * len(points) for _ in days], day_code=[[61] * len(points) for _ in days],
        notes_th=[])


def test_flood_reports_in_one_district_make_a_place_to_watch_with_its_roads_and_centre():
    reports = [_report(1, RANGSIT, timedelta(minutes=20)),
               _report(2, [100.636, 13.990], timedelta(minutes=10), road="ถนนรังสิต-นครนายก"),
               _report(3, [100.628, 13.984], timedelta(minutes=5)),
               _report(4, [100.49, 13.75], timedelta(minutes=5)),  # alone in another district: not a cluster
               _report(5, RANGSIT, timedelta(hours=13), stop=None),  # older than 12 hours (D33)
               _report(6, RANGSIT, timedelta(hours=2))]  # its hour ended an hour ago
    overview = build_overview({"live/floods.json": _dump(_floods(reports))}, NOW, G)
    [item] = overview.items
    assert item.when == "now" and item.place_th == "อ.ธัญบุรี จ.ปทุมธานี" and item.province_code == "13"
    assert [r.text_th for r in item.reasons] == ["น้ำท่วมหลายจุด (รายงาน 3 จุด)"]
    assert item.detail_th == "แถว ถ.พหลโยธิน, ถ.รังสิต-นครนายก"
    assert item.location == [pytest.approx(100.632, abs=1e-3), pytest.approx(13.987, abs=1e-3)]
    assert item.reasons[0].at == NOW - timedelta(minutes=5) and item.reasons[0].source_th == "Longdo Traffic"
    assert next(i for i in overview.inputs if i.name_th.startswith("รายงานน้ำท่วม")).status == "fresh"


def test_old_or_missing_inputs_add_nothing_and_say_so():
    reports = [_report(n, RANGSIT, timedelta(minutes=5)) for n in range(4)]
    stale = build_overview({"live/floods.json": _dump(_floods(reports, fetched=NOW - timedelta(hours=1)))}, NOW, G)
    assert stale.items == []
    assert {i.name_th: i.status for i in stale.inputs}["รายงานน้ำท่วม (Longdo Traffic)"] == "stale"
    empty = build_overview({}, NOW, G)
    assert empty.items == [] and all(i.status == "missing" for i in empty.inputs)
    assert "ไม่ใช่ประกาศทางการ" in empty.notes_th[0] and "ไม่ได้แปลว่าปลอดภัย" in empty.notes_th[1]


def test_bangkok_gauges_and_road_reports_count_only_while_fresh_and_of_today():
    example = RainGauges.model_validate_json((EXAMPLES / "bkk" / "rain.json").read_bytes())
    gauge = example.gauges[0].model_copy(update={"district_th": "จตุจักร", "location": [100.5540, 13.8046],
                                                 "observed_at": NOW - timedelta(minutes=10), "rain_1h_mm": 52.0,
                                                 "rain_24h_mm": 110.0})
    old = gauge.model_copy(update={"code": "R9", "observed_at": NOW - timedelta(hours=2), "rain_1h_mm": 80.0})
    gauges = example.model_copy(update={"fetched_at": NOW - timedelta(minutes=5), "gauges": [gauge, old]})
    roads = RoadFloodingDaily.model_validate_json((EXAMPLES / "bkk" / "flooding.json").read_bytes())
    roads = roads.model_copy(update={"fetched_at": NOW - timedelta(minutes=30), "report_date": NOW.date(),
                                     "updated_at": NOW - timedelta(minutes=40)})
    overview = build_overview({"bkk/rain.json": _dump(gauges), "bkk/flooding.json": _dump(roads)}, NOW, G)
    chatuchak = next(i for i in overview.items if i.place_th == "เขตจตุจักร กรุงเทพมหานคร")
    assert [r.text_th for r in chatuchak.reasons] == [
        "ฝนหนักมากตอนนี้ วัดได้ 52 มม. ใน 1 ชม.", "ถนนน้ำท่วมขัง 1 สาย ยังไม่แห้ง", "ฝนสะสม 24 ชม. 110 มม."]
    assert chatuchak.detail_th == "แถว ถ.ทดสอบหนึ่ง"
    # the road that dried (ดินแดง) is not a place; yesterday's report counts for nothing
    assert all("ดินแดง" not in i.place_th for i in overview.items)
    yesterday = roads.model_copy(update={"report_date": NOW.date() - timedelta(days=1)})
    later = build_overview({"bkk/flooding.json": _dump(yesterday)}, NOW, G)
    assert later.items == []


def test_forecast_names_provinces_and_days_and_follows_a_place_already_watched():
    def fill(d, lon, lat):
        if d == 2 and lon < 99.6:  # the west (Kanchanaburi) in two days
            return 1200
        if d == 0:  # the whole of today is not used: only the hours still to come
            return 2000
        return 20

    def hourly(h, lon, lat):  # 6 mm an hour to midnight around Pathum Thani: 48 mm in the rest of today
        return 60 if lon >= 100.5 and lat >= 13.9 else 0
    reports = [_report(n, RANGSIT, timedelta(minutes=5)) for n in range(3)]
    files = {"forecast/rain.json": _dump(_lattice_forecast(fill, hourly=hourly)),
             "live/floods.json": _dump(_floods(reports))}
    overview = build_overview(files, NOW, G)
    thanyaburi = next(i for i in overview.items if i.when == "now")
    assert [r.kind for r in thanyaburi.reasons] == ["flood_reports", "rain_forecast"]
    assert thanyaburi.reasons[1].day == NOW.date()
    assert thanyaburi.reasons[1].text_th.startswith("ฝนหนัก") and "สูงสุดราว 48 มม." in thanyaburi.reasons[1].text_th
    kanchanaburi = next(i for i in overview.items if i.place_th == "จ.กาญจนบุรี")
    assert kanchanaburi.when == "next" and kanchanaburi.zoom == 8
    assert kanchanaburi.reasons[0].day == date(2026, 9, 29)
    text = kanchanaburi.reasons[0].text_th
    assert text.startswith("ฝนหนักมาก") and "สูงสุดราว 120 มม." in text
    # today's heavy rain of Pathum Thani went with the place on the "now" list, not to a second item
    assert all(i.place_th != "จ.ปทุมธานี" for i in overview.items if i.when == "next")
    # later days than 3 from today are a trend only
    far = build_overview({"forecast/rain.json": _dump(_lattice_forecast(lambda d, lon, lat: 1500 if d == 5 else 0))},
                         NOW, G)
    assert far.items == []


def test_three_day_totals_and_short_bursts_use_the_thaiwater_watch_levels():
    # east of 100.9°: 10 mm an hour to midnight with one hour of 38 mm, then 40 mm on each of the next two days
    forecast = _lattice_forecast(lambda d, lon, lat: 400 if d in (1, 2) and lon >= 100.9 else 0,
                                 hourly=lambda h, lon, lat: (380 if h == 3 else 100) if lon >= 100.9 else 0)
    overview = build_overview({"forecast/rain.json": _dump(forecast)}, NOW, G)
    kinds = {r.kind for i in overview.items for r in i.reasons}
    assert {"rain_forecast", "rain_3days", "rain_burst"} <= kinds
    burst = next(r for i in overview.items for r in i.reasons if r.kind == "rain_burst")
    assert burst.text_th == "ฝนแรงช่วงสั้นราว 38 มม./ชม. เสี่ยงน้ำขังรอระบาย"
    three = next(r for i in overview.items for r in i.reasons if r.kind == "rain_3days")
    assert three.text_th == "ฝนสะสม 3 วันราว 188 มม. ถึงเกณฑ์เฝ้าระวังของ สสน."
    stale = build_overview({"forecast/rain.json": _dump(_lattice_forecast(lambda d, lon, lat: 1500,
                                                                            fetched=NOW - timedelta(hours=13)))},
                           NOW, G)
    assert stale.items == []


def test_rivers_rising_a_lot_and_dams_over_capacity_are_to_prepare_for():
    rivers = (EXAMPLES / "forecast" / "rivers.json").read_bytes()
    dams = DamReport.model_validate_json((EXAMPLES / "bkk" / "dams.json").read_bytes())
    full = dams.dams[0].model_copy(update={"percent": 104.2})
    dams = dams.model_copy(update={"fetched_at": NOW - timedelta(hours=5), "dams": [full, *dams.dams[1:]]})
    now = datetime.fromisoformat("2026-09-27T12:00:00+07:00")
    overview = build_overview({"forecast/rivers.json": rivers, "water/dams.json": _dump(dams)}, now, G)
    places = {i.place_th: i for i in overview.items}
    assert set(places) >= {"แม่น้ำบางปะกง ที่ฉะเชิงเทรา", "แม่น้ำมูล ที่อุบลราชธานี", "แม่น้ำท่าจีน ที่สุพรรณบุรี"}
    assert "แม่น้ำเจ้าพระยา ที่กรุงเทพฯ" not in places  # +19 %: rising, not a lot
    bang_pakong = places["แม่น้ำบางปะกง ที่ฉะเชิงเทรา"]
    assert bang_pakong.reasons[0].text_th == "น้ำเพิ่มขึ้นมาก สูงสุดราว +118% (ค่าแบบจำลอง)"
    assert bang_pakong.province_code == "24"
    dam = places[full.name_th]
    assert dam.reasons[0].text_th == "น้ำเกินความจุเก็บกัก 104% ติดตามการระบายน้ำ"
    assert all(i.when == "next" for i in overview.items)


def test_every_round_publishes_the_overview_and_a_broken_one_never_stops_the_alerts(tmp_path, monkeypatch):
    out = tmp_path / "v1"
    now = datetime.fromisoformat("2026-09-25T18:20:00+07:00")
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES), now=now, writer="t",
                     owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert OVERVIEW_PATH in [f.path for f in manifest.files]
    assert Overview.model_validate_json((out / OVERVIEW_PATH).read_bytes()).generated_at == now

    def broken(*_args, **_kwargs):
        raise RuntimeError("rules broke")
    monkeypatch.setattr("fontokmai.run.build_overview", broken)
    result = run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                              now=now + timedelta(minutes=15), writer="t", owner_epoch=1)
    assert result.overview_error == "RuntimeError: rules broke"
    assert "alerts.json" in [f.path for f in result.manifest.files]
