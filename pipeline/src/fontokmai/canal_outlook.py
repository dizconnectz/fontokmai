"""summary/canals.json: which canals of the Rangsit pilot may overflow, by this site's trial rules (contract section 27;
user 2026-10-03: the gates' figures as "1 ใน factor ในการพยากรณ์ด้วยว่าจะท่วมคลองเส้นไหน").

Each canal of ref/canals.json gets points from five factors, each with its words, source and time:
- inflow: water let into its network by RID's gates (water/flows.json): the Raphiphat intake at 50% / 80% of the
  most it lets in scores 1 / 2; gates whose capacity RID does not print are only noted
- rain: the forecast rain of today, tomorrow and the day after over the districts it runs through (forecast/rain.json):
  TMD's heavy (from 35.1 mm) 1, very heavy (from 90.1 mm) 2
- drainage: the river it drains to (its RID station): RID's own state critical 1 / flood 2, or the flow at 80% / 100%
  of the channel capacity, whichever is more
- level: a Bangkok gauge on it (bkk/water.json) rising 10 cm or more within 6 hours, read in the last 6 hours: 1
- flooding: RID's report naming a district along it as flooded that day: 1
A score of 3 or more is "warn", 2 "watch". These are trial rules of this site, not an announcement, and not tested
against past events yet; the factors are shown so a reader can judge them. Data too old is left out and said so: a
factor that applies to a canal but has no data fresh enough is a gap of that canal, and a canal with nothing but gaps
is not assessed, never "below the rules" (Codex M50). The levels count by the time of each reading, not the time of
the file that brought it (M48).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from importlib import resources
from typing import Any

from pydantic import BaseModel, ValidationError

from fontokmai.contracts.bkk import CanalLevels
from fontokmai.contracts.canals import CanalFactor, CanalGap, CanalInput, CanalLines, CanalOutlook, CanalWatch
from fontokmai.contracts.flows import RidFlows
from fontokmai.contracts.forecast import RainForecast

CANALS_PATH = "summary/canals.json"
LINES_PATH = "ref/canals.json"
RULES = "canals-v3"  # v3: unrounded level thresholds and a valid pair required to assess a level trend
ICT = timezone(timedelta(hours=7))
FLOWS_MAX_AGE = timedelta(days=2)  # the report is daily
RAIN_MAX_AGE = timedelta(hours=12)  # refreshed every 6 hours
LEVELS_MAX_AGE = timedelta(hours=6)  # Bangkok's file comes by hand (D31): a reading older than this says nothing now
RISE_WITHIN = timedelta(hours=6)  # a rise is counted against a reading at most this much earlier
CLOCK_SLACK = timedelta(minutes=10)  # a reading this much ahead of the clock is a wrong clock, not the future
# TMD's classes of the rain of a day, in 0.1 mm as the forecast holds it: heavy 35.1–90.0, very heavy from 90.1
HEAVY, VERY_HEAVY = 351, 901
RISE_CM = 10
WARN, WATCH = 3, 2
NOTES_TH = [
    "เกณฑ์ทดลองของเว็บนี้ ไม่ใช่ประกาศของหน่วยงาน และยังไม่ได้ทดสอบย้อนหลังกับเหตุการณ์จริง",
    "คะแนนบอกว่าปัจจัยที่ทำให้น้ำในคลองสูงขึ้นมาพร้อมกันกี่อย่าง ไม่ได้บอกว่าน้ำจะสูงกี่เซนติเมตรหรือท่วมตรงไหน",
]
SOURCE_NAMES = {"flows": "รายงานกรมชลประทาน", "rain": "พยากรณ์ฝน", "levels": "ระดับน้ำ กทม."}
# why a source cannot be used, said after its name
STATUS_TH = {"stale": "เก่าเกินเกณฑ์", "missing": "ไม่มีในรอบนี้"}


def _load[M: BaseModel](files: dict[str, bytes], path: str, model: type[M]) -> M | None:
    try:
        return model.model_validate_json(files[path])
    except (KeyError, ValidationError):
        return None


def _share(flow: float, capacity: float) -> str:
    return f"{flow / capacity:.0%}"


def _cms(value: float) -> str:
    return f"{value:,.0f} ลบ.ม./วิ"


def _mm(tenths: int) -> str:
    """"35.1" for 351 (0.1 mm), "95" for 950"""
    return f"{tenths / 10:.1f}".removesuffix(".0")


def _thai_day(day: date) -> str:
    months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    return f"{day.day} {months[day.month - 1]}"


def _clock(at: datetime) -> str:
    return at.astimezone(ICT).strftime("%H:%M น.")


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


def _rain(canal: Any, forecast: RainForecast, cells: dict[str, set[int]], names: dict[str, str],
          today: date) -> list[CanalFactor] | None:
    """The rain factor, or None when the forecast has no value for the canal's districts in these days."""
    best: tuple[int, date, str] | None = None
    for d, day in enumerate(forecast.days):
        if not 0 <= (day - today).days <= 2:
            continue
        for district in canal.districts:
            values = [forecast.day_rain[d][i] for i in cells.get(district, ()) if forecast.day_rain[d][i] is not None]
            if values and (best is None or max(values) > best[0]):
                best = (max(values), day, district)
    if best is None:
        return None
    value, day, district = best
    score = 2 if value >= VERY_HEAVY else 1 if value >= HEAVY else 0
    word = "ฝนหนักมาก" if score == 2 else "ฝนหนัก" if score == 1 else "ฝนไม่ถึงเกณฑ์ฝนหนัก"
    text = f"พยากรณ์{word} สูงสุดราว {_mm(value)} มม. วันที่ {_thai_day(day)} แถว {names.get(district, district)}"
    return [CanalFactor(kind="rain", points=score, text_th=text, source_th="Open-Meteo", at=forecast.fetched_at)]


def _levels(canal: Any, levels: CanalLevels, now: datetime) -> list[CanalFactor] | None:
    """A gauge on the canal rising RISE_CM within RISE_WITHIN, by readings of the last LEVELS_MAX_AGE (M48: the time
    of the reading, never the time of the file); None when no gauge has a valid recent pair to judge its trend."""
    read, rises = False, []
    for station in levels.stations:
        at = station.observed_at
        if station.canal_th not in canal.dxs_canals or station.level_in_m is None or at is None:
            continue
        if not now - LEVELS_MAX_AGE <= at <= now + CLOCK_SLACK:
            continue
        before, since = station.previous_level_in_m, station.previous_observed_at
        if before is None or since is None or not timedelta(0) < at - since <= RISE_WITHIN:
            continue
        if not math.isfinite(station.level_in_m) or not math.isfinite(before):
            continue
        read = True
        cm = (station.level_in_m - before) * 100
        # Only absorb binary arithmetic noise at exactly 10 cm; do not promote a rounded 9.6 cm rise.
        if cm >= RISE_CM or math.isclose(cm, RISE_CM, rel_tol=0, abs_tol=1e-9):
            rises.append((cm, station))
    if not read:
        return None
    if not rises:
        return []
    cm, station = max(rises, key=lambda item: item[0])
    hours = (station.observed_at - station.previous_observed_at).total_seconds() / 3600
    more = f" (และอีก {len(rises) - 1} สถานี)" if len(rises) > 1 else ""
    change = f"{cm:.1f}".removesuffix(".0")
    text = (f"ระดับน้ำที่ {station.name_th} สูงขึ้น {change} ซม. ใน {hours:.1f}".removesuffix(".0")
            + f" ชม. (วัดเมื่อ {_clock(station.observed_at)}){more}")
    return [CanalFactor(kind="level", points=1, text_th=text, source_th="สำนักการระบายน้ำ กทม.",
                        at=station.observed_at)]


def _flooding(canal: Any, flows: RidFlows, names: dict[str, str]) -> list[CanalFactor]:
    hit = [code for code in canal.districts if code in flows.flooded_districts]
    if not hit:
        return []
    text = "กรมชลฯ รายงานพื้นที่ประสบอุทกภัยใน " + " ".join(names.get(code, code) for code in hit)
    return [CanalFactor(kind="flooding", points=1, text_th=text, source_th="กรมชลประทาน", at=flows.observed_at)]


def _input(source: str, document: Any, at: datetime | None, max_age: timedelta, now: datetime) -> CanalInput:
    status = "missing" if document is None or at is None else "stale" if now - at > max_age else "fresh"
    return CanalInput(source=source, name_th=SOURCE_NAMES[source], status=status, at=at)


def _gap_text(item: CanalInput) -> str:
    when = f" (ข้อมูล {item.at.astimezone(ICT):%d/%m %H:%M} น.)" if item.at else ""
    return f"{item.name_th} {STATUS_TH[item.status]}{when}"


def build_canal_outlook(files: dict[str, bytes], now: datetime) -> CanalOutlook | None:
    """The outlook of every canal of ref/canals.json, or None without that file."""
    lines = _load(files, LINES_PATH, CanalLines)
    if lines is None:
        return None
    today = now.astimezone(ICT).date()
    flows = _load(files, "water/flows.json", RidFlows)
    forecast = _load(files, "forecast/rain.json", RainForecast)
    levels = _load(files, "bkk/water.json", CanalLevels)
    inputs = {
        "flows": _input("flows", flows, flows.observed_at if flows else None, FLOWS_MAX_AGE, now),
        "rain": _input("rain", forecast, forecast.fetched_at if forecast else None, RAIN_MAX_AGE, now),
        "levels": _input("levels", levels, levels.fetched_at if levels else None, LEVELS_MAX_AGE, now),
    }
    flows = flows if inputs["flows"].status == "fresh" else None
    forecast = forecast if inputs["rain"].status == "fresh" else None
    levels = levels if inputs["levels"].status == "fresh" else None
    points = {point.id: point for point in flows.points} if flows else {}
    cells = district_cells(forecast) if forecast else {}
    names = district_names()
    watches = []
    for canal in lines.canals:
        factors: list[CanalFactor] = []
        gaps: list[CanalGap] = []
        judged = 0
        if flows is not None:
            factors += _inflow(canal, points, flows.observed_at) + _drainage(canal, points, flows.observed_at)
            factors += _flooding(canal, flows, names)
            judged += 1
        else:
            gaps += [CanalGap(kind=kind, text_th=_gap_text(inputs["flows"]))
                     for kind, applies in (("inflow", bool(canal.fed_by)), ("drainage", bool(canal.drains_to)),
                                           ("flooding", True)) if applies]
        rain = _rain(canal, forecast, cells, names, today) if forecast is not None else None
        if rain is not None:
            factors += rain
            judged += 1
        else:
            gaps.append(CanalGap(kind="rain", text_th=_gap_text(inputs["rain"]) if forecast is None
                                 else "พยากรณ์ฝนไม่มีค่าของอำเภอที่คลองผ่าน"))
        if canal.dxs_canals:
            level = _levels(canal, levels, now) if levels is not None else None
            if level is not None:
                factors += level
                judged += 1
            else:
                gaps.append(CanalGap(kind="level", text_th=_gap_text(inputs["levels"]) if levels is None
                                     else "ไม่มีค่าวัดระดับน้ำล่าสุดพร้อมค่าก่อนหน้าที่เทียบกันได้ภายใน 6 ชม."))
        score = sum(factor.points for factor in factors)
        assessed = judged > 0
        level_name = ("warn" if score >= WARN else "watch" if score >= WATCH else None) if assessed else None
        # the factors that count first, then what is only noted
        factors.sort(key=lambda factor: -factor.points)
        watches.append(CanalWatch(id=canal.id, name_th=canal.name_th, score=score, level=level_name, factors=factors,
                                  assessed=assessed, gaps=gaps))
    watches.sort(key=lambda watch: (-watch.score, not watch.assessed, watch.name_th))
    notes = list(NOTES_TH)
    if flows is None:
        notes.append("ไม่มีรายงานกรมชลประทานที่ใหม่พอ จึงไม่นับน้ำเข้า การระบาย และรายงานน้ำท่วม")
    if forecast is None:
        notes.append("ไม่มีพยากรณ์ฝนที่ใหม่พอ จึงไม่นับฝน")
    if levels is None:
        notes.append("ไม่มีระดับน้ำ กทม. ที่ใหม่พอ จึงไม่นับระดับน้ำ")
    return CanalOutlook(generated_at=now, rules=RULES, canals=watches, inputs=list(inputs.values()), notes_th=notes)
