"""summary/canals.json: which canals of the Rangsit pilot may overflow, by this site's trial rules (contract section 27;
user 2026-10-03: the gates' figures as "1 ใน factor ในการพยากรณ์ด้วยว่าจะท่วมคลองเส้นไหน").

Each canal of ref/canals.json gets points from five factors, each with its words, source and time:
- inflow: water let into its network by RID's gates (water/flows.json): the Raphiphat intake at 50% / 80% of the
  most it lets in scores 1 / 2; gates whose capacity RID does not print are only noted
- rain: the forecast rain of today, tomorrow and the day after over the districts it runs through (forecast/rain.json,
  TMD day classes): heavy (35 mm) 1, very heavy (90 mm) 2
- drainage: the river it drains to (its RID station): RID's own state critical 1 / flood 2, or the flow at 80% / 100%
  of the channel capacity, whichever is more
- level: Bangkok's gauges on it (bkk/water.json) rising 10 cm or more since the reading before: 1
- flooding: RID's report naming a district along it as flooded that day: 1
A score of 3 or more is "warn", 2 "watch". These are trial rules of this site, not an announcement, and not tested
against past events yet; the factors are shown so a reader can judge them. Data too old is left out and said so.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from importlib import resources
from typing import Any

from pydantic import BaseModel, ValidationError

from fontokmai.contracts.bkk import CanalLevels
from fontokmai.contracts.canals import CanalFactor, CanalLines, CanalOutlook, CanalWatch
from fontokmai.contracts.flows import RidFlows
from fontokmai.contracts.forecast import RainForecast

CANALS_PATH = "summary/canals.json"
LINES_PATH = "ref/canals.json"
RULES = "canals-v1"
ICT = timezone(timedelta(hours=7))
FLOWS_MAX_AGE = timedelta(days=2)  # the report is daily
RAIN_MAX_AGE = timedelta(hours=12)  # refreshed every 6 hours
LEVELS_MAX_AGE = timedelta(hours=6)  # Bangkok's file comes by hand (D31)
HEAVY, VERY_HEAVY = 350, 900  # 0.1 mm a day: TMD's heavy and very heavy
RISE_CM = 10
WARN, WATCH = 3, 2
NOTES_TH = [
    "เกณฑ์ทดลองของเว็บนี้ ไม่ใช่ประกาศของหน่วยงาน และยังไม่ได้ทดสอบย้อนหลังกับเหตุการณ์จริง",
    "คะแนนบอกว่าปัจจัยที่ทำให้น้ำในคลองสูงขึ้นมาพร้อมกันกี่อย่าง ไม่ได้บอกว่าน้ำจะสูงกี่เซนติเมตรหรือท่วมตรงไหน",
]


def _load[M: BaseModel](files: dict[str, bytes], path: str, model: type[M]) -> M | None:
    try:
        return model.model_validate_json(files[path])
    except (KeyError, ValidationError):
        return None


def _share(flow: float, capacity: float) -> str:
    return f"{flow / capacity:.0%}"


def _cms(value: float) -> str:
    return f"{value:,.0f} ลบ.ม./วิ"


def _thai_day(day: date) -> str:
    months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    return f"{day.day} {months[day.month - 1]}"


def district_names() -> dict[str, str]:
    data = json.loads(resources.files("fontokmai.ref_data").joinpath("places.json").read_text(encoding="utf-8"))
    return {place["code"]: place["label"].split(" ")[0] for place in data["places"] if place.get("kind") == "district"}


def district_cells(forecast: RainForecast) -> dict[str, set[int]]:
    """district (DOPA) → the forecast points nearest to its subdistricts."""
    data = json.loads(resources.files("fontokmai.ref_data").joinpath("places.json").read_text(encoding="utf-8"))
    index = {tuple(point): i for i, point in enumerate(forecast.points)}
    lat0, lon0, step = forecast.lattice.south, forecast.lattice.west, forecast.lattice.step
    cells: dict[str, set[int]] = defaultdict(set)
    for place in data["places"]:
        if place.get("kind") == "subdistrict":
            key = (round((place["location"][0] - lon0) / step), round((place["location"][1] - lat0) / step))
            if key in index:
                cells[place["code"][:4]].add(index[key])
    return cells


def _inflow(canal: Any, points: dict[str, Any], at: datetime) -> list[CanalFactor]:
    factors = []
    for point_id in canal.fed_by:
        point = points.get(point_id)
        if point is None or point.flow_cms is None:
            continue
        where = f"เข้า{point.into_th}" if point.into_th else ""
        if point.flow_cms <= 0:
            factors.append(CanalFactor(kind="inflow", points=0, text_th=f"{point.name_th} ปิด ไม่มีน้ำ{where}",
                                       source_th="กรมชลประทาน", at=at))
            continue
        change = ""
        if point.yesterday_cms is not None and point.yesterday_cms != point.flow_cms:
            way = "เพิ่ม" if point.flow_cms > point.yesterday_cms else "ลด"
            change = f" ({way}จากเมื่อวาน {_cms(point.yesterday_cms)})"
        if point.capacity_cms:
            share = point.flow_cms / point.capacity_cms
            score = 2 if share >= 0.8 else 1 if share >= 0.5 else 0
            text = (f"{point.name_th} ปล่อยน้ำ{where} {_cms(point.flow_cms)} "
                    f"({_share(point.flow_cms, point.capacity_cms)} ของที่ปล่อยได้สูงสุด){change}")
        else:
            score = 0
            text = f"{point.name_th} ปล่อยน้ำ{where} {_cms(point.flow_cms)}{change}"
        factors.append(CanalFactor(kind="inflow", points=score, text_th=text, source_th="กรมชลประทาน", at=at))
    return factors


def _drainage(canal: Any, points: dict[str, Any], at: datetime) -> list[CanalFactor]:
    point = points.get(canal.drains_to) if canal.drains_to else None
    if point is None:
        return []
    by_state = {"flood": 2, "critical": 1}.get(point.state or "", 0)
    share = point.flow_cms / point.capacity_cms if point.flow_cms is not None and point.capacity_cms else None
    by_flow = 2 if share is not None and share >= 1.0 else 1 if share is not None and share >= 0.8 else 0
    state_th = {"normal": "ปกติ", "critical": "วิกฤต", "flood": "น้ำท่วม"}.get(point.state or "")
    parts = [f"{point.name_th} ({point.code})"]
    if point.flow_cms is not None:
        parts.append(_cms(point.flow_cms) + (f" ({_share(point.flow_cms, point.capacity_cms)} ของความจุลำน้ำ)"
                                              if point.capacity_cms else ""))
    if state_th:
        parts.append(f"กรมชลฯ จัดระดับ{state_th}")
    text = "ระบายลงแม่น้ำ: " + " · ".join(parts)
    return [CanalFactor(kind="drainage", points=max(by_state, by_flow), text_th=text, source_th="กรมชลประทาน", at=at)]


def _rain(canal: Any, forecast: RainForecast | None, cells: dict[str, set[int]], names: dict[str, str],
          today: date) -> list[CanalFactor]:
    if forecast is None:
        return []
    best: tuple[int, date, str] | None = None
    for d, day in enumerate(forecast.days):
        if not 0 <= (day - today).days <= 2:
            continue
        for district in canal.districts:
            values = [forecast.day_rain[d][i] for i in cells.get(district, ()) if forecast.day_rain[d][i] is not None]
            if values and (best is None or max(values) > best[0]):
                best = (max(values), day, district)
    if best is None:
        return []
    value, day, district = best
    score = 2 if value >= VERY_HEAVY else 1 if value >= HEAVY else 0
    word = "ฝนหนักมาก" if score == 2 else "ฝนหนัก" if score == 1 else "ฝนไม่ถึงเกณฑ์ฝนหนัก"
    text = f"พยากรณ์{word} สูงสุดราว {value / 10:.0f} มม. วันที่ {_thai_day(day)} แถว {names.get(district, district)}"
    return [CanalFactor(kind="rain", points=score, text_th=text, source_th="Open-Meteo", at=forecast.fetched_at)]


def _levels(canal: Any, levels: CanalLevels | None) -> list[CanalFactor]:
    if levels is None or not canal.dxs_canals:
        return []
    rises = []
    for station in levels.stations:
        if station.canal_th not in canal.dxs_canals or station.level_in_m is None:
            continue
        before, since = station.previous_level_in_m, station.previous_observed_at
        if before is None or since is None or station.observed_at is None:
            continue
        cm = round((station.level_in_m - before) * 100)
        if cm >= RISE_CM:
            rises.append((cm, station))
    if not rises:
        return []
    cm, station = max(rises, key=lambda item: item[0])
    more = f" (และอีก {len(rises) - 1} สถานี)" if len(rises) > 1 else ""
    text = f"ระดับน้ำที่ {station.name_th} สูงขึ้น {cm} ซม. จากค่าวัดก่อนหน้า{more}"
    return [CanalFactor(kind="level", points=1, text_th=text, source_th="สำนักการระบายน้ำ กทม.",
                        at=station.observed_at)]


def _flooding(canal: Any, flows: RidFlows | None, names: dict[str, str]) -> list[CanalFactor]:
    if flows is None:
        return []
    hit = [code for code in canal.districts if code in flows.flooded_districts]
    if not hit:
        return []
    text = "กรมชลฯ รายงานพื้นที่ประสบอุทกภัยใน " + " ".join(names.get(code, code) for code in hit)
    return [CanalFactor(kind="flooding", points=1, text_th=text, source_th="กรมชลประทาน", at=flows.observed_at)]


def build_canal_outlook(files: dict[str, bytes], now: datetime) -> CanalOutlook | None:
    """The outlook of every canal of ref/canals.json, or None without that file."""
    lines = _load(files, LINES_PATH, CanalLines)
    if lines is None:
        return None
    today = now.astimezone(ICT).date()
    flows = _load(files, "water/flows.json", RidFlows)
    if flows is not None and now - flows.observed_at > FLOWS_MAX_AGE:
        flows = None
    forecast = _load(files, "forecast/rain.json", RainForecast)
    if forecast is not None and now - forecast.fetched_at > RAIN_MAX_AGE:
        forecast = None
    levels = _load(files, "bkk/water.json", CanalLevels)
    if levels is not None and now - levels.fetched_at > LEVELS_MAX_AGE:
        levels = None
    points = {point.id: point for point in flows.points} if flows else {}
    cells = district_cells(forecast) if forecast else {}
    names = district_names()
    watches = []
    for canal in lines.canals:
        factors = []
        if flows is not None:
            factors += _inflow(canal, points, flows.observed_at)
            factors += _drainage(canal, points, flows.observed_at)
        factors += _rain(canal, forecast, cells, names, today)
        factors += _levels(canal, levels)
        factors += _flooding(canal, flows, names)
        score = sum(factor.points for factor in factors)
        level = "warn" if score >= WARN else "watch" if score >= WATCH else None
        # the factors that count first, then what is only noted
        factors.sort(key=lambda factor: -factor.points)
        watches.append(CanalWatch(id=canal.id, name_th=canal.name_th, score=score, level=level, factors=factors))
    watches.sort(key=lambda watch: (-watch.score, watch.name_th))
    notes = list(NOTES_TH)
    if flows is None:
        notes.append("ไม่มีรายงานกรมชลประทานที่ใหม่พอ จึงไม่นับน้ำเข้าและการระบาย")
    if forecast is None:
        notes.append("ไม่มีพยากรณ์ฝนที่ใหม่พอ จึงไม่นับฝน")
    return CanalOutlook(generated_at=now, rules=RULES, canals=watches, notes_th=notes)
