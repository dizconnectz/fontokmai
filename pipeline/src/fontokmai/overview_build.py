"""summary/overview.json: the places to watch now and to prepare for, from the files of the round (rules v0).

Fixed rules, not a model and not AI. Thresholds borrowed from sources (design section 7.5): ThaiWater warning zone 06
watches rain of 35 mm in 1 hour, 95 mm in 24 hours and 150 mm in 3 days; TMD calls 35.1–90.0 mm in a day heavy and
more than 90.0 very heavy. The rest (how many reports make a cluster, what share of a province, how far ahead) are
rules of the site, written down on /method. An input that is missing or older than its limit adds nothing and is
listed as such, so old data never raises a place, and no item means "nothing found by these rules", never "safe".
Official alerts are not copied: the web shows alerts.json apart.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from importlib import resources

from pydantic import BaseModel, ValidationError

from fontokmai.contracts.bkk import DamReport, RainGauges, RoadFloodingDaily
from fontokmai.contracts.forecast import RainForecast, RiverForecast
from fontokmai.contracts.live_floods import LiveFloods
from fontokmai.contracts.overview import Overview, OverviewInput, OverviewItem, OverviewReason
from fontokmai.contracts.places import Place, PlaceGazetteer

OVERVIEW_PATH = "summary/overview.json"
ICT = timezone(timedelta(hours=7))
SKEW = timedelta(minutes=5)  # a time further in the future than this is not trusted

# how old an input may be before it adds nothing
FLOODS_MAX_AGE = timedelta(minutes=45)
REPORT_MAX_AGE = timedelta(hours=12)  # D33
GAUGE_MAX_AGE = timedelta(minutes=60)  # design 7.5: rain stations 60 minutes
ROADS_MAX_AGE = timedelta(hours=3)
FORECAST_MAX_AGE = timedelta(hours=12)
RIVERS_MAX_AGE = timedelta(hours=36)
DAMS_MAX_AGE = timedelta(days=3)

# criteria of sources (design 7.5); forecast/rain.json counts in 0.1 mm
HOUR_WATCH_MM = 35.0
HOUR_VERY_HEAVY_MM = 48.0  # the site's hourly word "ฝนหนักมาก" (geo.rainWords)
DAY_WATCH_MM = 95.0
THREE_DAYS_WATCH = 1500
HEAVY = 351
VERY_HEAVY = 901
BURST = 350
# rules of the site (v0)
MIN_REPORTS = 2  # ongoing flood reports in one district that make it a place to watch
HEAVY_SHARE = 0.2  # share of a province's forecast cells with heavy rain that counts the province
VERY_HEAVY_SHARE = 0.1
AHEAD_DAYS = 4  # today and 3 more days; later days are a trend only (design 7.3)
RIVER_FAST = 0.3  # the web's "rising a lot"
RIVER_AHEAD = 7
CELL = 0.2  # degrees of the lookup grid for the nearest subdistrict
MAX_NOW = 40  # a morning after a storm had more than 20 districts (2026-09-28); the web folds after five
MAX_NEXT = 40

NOTES_TH = [
    "สรุปอัตโนมัติจากข้อมูลทุกชุดด้วยเกณฑ์ของเว็บ (ทดลอง v0) ไม่ใช่ประกาศทางการ และยังไม่ได้ตรวจความแม่น",
    "ไม่มีรายการไม่ได้แปลว่าปลอดภัย แค่ยังไม่พบตามเกณฑ์ และข้อมูลที่เก่าเกินกำหนดจะไม่ถูกนับ",
    "ประกาศเตือนภัยของกรมอุตุนิยมวิทยาแสดงแยก ไม่ได้รวมอยู่ในสรุปนี้",
]


@dataclass
class Gazetteer:
    """DOPA places for naming a point: the nearest subdistrict gives its district and province."""

    places: dict[str, Place]
    cells: dict[tuple[int, int], list[Place]]

    @classmethod
    def load(cls) -> Gazetteer:
        data = PlaceGazetteer.model_validate_json(
            resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes())
        cells: dict[tuple[int, int], list[Place]] = defaultdict(list)
        for place in data.places:
            if place.kind == "subdistrict":
                lon, lat = place.location
                cells[(math.floor(lon / CELL), math.floor(lat / CELL))].append(place)
        return cls({p.code: p for p in data.places}, dict(cells))

    def nearest(self, location: list[float]) -> Place | None:
        """The subdistrict whose point is nearest, within about 20 km; None outside Thailand."""
        lon, lat = location
        scale = math.cos(math.radians(lat)) ** 2
        best, best_d = None, CELL**2
        cx, cy = math.floor(lon / CELL), math.floor(lat / CELL)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for place in self.cells.get((cx + dx, cy + dy), []):
                    d = (place.location[0] - lon) ** 2 * scale + (place.location[1] - lat) ** 2
                    if d < best_d:
                        best, best_d = place, d
        return best

    def bangkok_district(self, name: str | None) -> Place | None:
        bare = (name or "").removeprefix("เขต").strip()
        return next((p for p in self.places.values()
                     if p.kind == "district" and p.code.startswith("10") and p.name == bare), None)


def _load[M: BaseModel](files: dict[str, bytes], path: str, model: type[M]) -> M | None:
    content = files.get(path)
    if content is None:
        return None
    try:
        return model.model_validate_json(content)
    except ValidationError:
        return None


def _input(name_th: str, fetched: datetime | None, now: datetime, max_age: timedelta) -> OverviewInput:
    if fetched is None:
        return OverviewInput(name_th=name_th, status="missing", at=None)
    fresh = fetched <= now + SKEW and now - fetched <= max_age
    return OverviewInput(name_th=name_th, status="fresh" if fresh else "stale", at=fetched)


def _mm(value: float) -> str:
    return f"{value:.0f}" if value >= 10 else f"{value:.1f}".rstrip("0").rstrip(".")


def _road(name: str) -> str:
    """Short road names: "ถ.รามคำแหง" for ถนน/ถ./a bare name, "ทล.3480" for a highway, "ทช.สป.2003" for a rural
    road of the Department of Rural Roads, no note in brackets."""
    name = re.sub(r"\s*\(.*?\)", "", name).strip()
    name = re.sub(r"^ทางหลวงชนบท(?:หมายเลข)?\s*", "ทช.", name)
    name = re.sub(r"^ทางหลวง(?:แผ่นดิน)?(?:หมายเลข)?\s*", "ทล.", name)
    bare = name.removeprefix("ถนน").removeprefix("ถ.").strip()
    return name if name.startswith(("ซอย", "ซ.", "ทล.", "ทช.", "ทาง", "สะพาน", "อุโมงค์")) else f"ถ.{bare}"


@dataclass
class _Spot:
    """A place collecting reasons: a district (now), a province (forecast), a river point or a dam (next)."""

    when: str
    place_th: str
    province: str | None
    location: list[float]
    zoom: float
    reasons: list[tuple[int, OverviewReason]] = field(default_factory=list)
    points: list[list[float]] = field(default_factory=list)
    roads: list[str] = field(default_factory=list)

    def item(self) -> OverviewItem:
        # on the "now" list what is happening leads, and a forecast taken along comes last
        ordered = sorted(self.reasons, key=lambda pair: (
            self.when == "now" and pair[1].day is not None, -pair[0], pair[1].day or date.min))
        scores = [score for score, _ in ordered]
        centre = self.location
        if self.points:  # the centre of the reports, not the middle of the district
            centre = [round(sum(p[0] for p in self.points) / len(self.points), 5),
                      round(sum(p[1] for p in self.points) / len(self.points), 5)]
        roads = list(dict.fromkeys(self.roads))[:2]
        return OverviewItem(
            when=self.when, place_th=self.place_th, detail_th=f"แถว {', '.join(roads)}" if roads else None,
            province_code=self.province, location=centre, zoom=self.zoom,
            score=scores[0] * 10 + sum(scores[1:]), reasons=[reason for _, reason in ordered])


def _district_spot(spots: dict[str, _Spot], district: Place) -> _Spot:
    if district.code not in spots:
        spots[district.code] = _Spot("now", district.label, district.code[:2], list(district.location), 12)
    return spots[district.code]


def build_overview(files: dict[str, bytes], now: datetime, gazetteer: Gazetteer | None = None) -> Overview:
    """Everything the rules find in the files of one round (path → content, as they go into the manifest)."""
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    g = gazetteer or Gazetteer.load()
    today = now.astimezone(ICT).date()
    inputs: list[OverviewInput] = []
    spots: dict[str, _Spot] = {}

    def district_of(location: list[float]) -> Place | None:
        sub = g.nearest(location)
        return g.places.get(sub.code[:4]) if sub else None

    # ---------- now: flood reports clustering in a district (Longdo Traffic, D33) ----------
    floods = _load(files, "live/floods.json", LiveFloods)
    state = _input("รายงานน้ำท่วม (Longdo Traffic)", floods.fetched_at if floods else None, now, FLOODS_MAX_AGE)
    inputs.append(state)
    if floods and state.status == "fresh":
        groups: dict[str, list] = defaultdict(list)
        for report in floods.reports:
            ongoing = report.start <= now + SKEW and now - report.start <= REPORT_MAX_AGE and (
                report.stop is None or now <= report.stop)
            district = district_of(report.location) if ongoing else None
            if district:
                groups[district.code].append(report)
        for code, reports in groups.items():
            count = len(reports)
            if count < MIN_REPORTS:
                continue
            spot = _district_spot(spots, g.places[code])
            spot.points += [list(r.location) for r in reports]
            spot.roads += [_road(r.road_th) if r.road_th else r.title_th.removeprefix("น้ำท่วม").strip()
                           for r in reports]
            text = f"น้ำท่วมหลายจุด (รายงาน {count} จุด)" if count >= 3 else f"มีรายงานน้ำท่วม {count} จุด"
            spot.reasons.append((4 if count >= 5 else 3 if count >= 3 else 2, OverviewReason(
                kind="flood_reports", text_th=text, day=None, source_th="Longdo Traffic",
                at=max(r.start for r in reports))))

    # ---------- now: main roads of Bangkok still flooded in today's report of the department ----------
    flooding = _load(files, "bkk/flooding.json", RoadFloodingDaily)
    state = _input("ถนนน้ำท่วมขัง กทม. (สำนักการระบายน้ำ)", flooding.fetched_at if flooding else None, now,
                   ROADS_MAX_AGE)
    inputs.append(state)
    if flooding and state.status == "fresh" and flooding.report_date == today:
        wet: dict[str, list] = defaultdict(list)
        for report in flooding.reports:
            district = g.bangkok_district(report.district_th) if report.dry_at is None else None
            if district:
                wet[district.code].append(report)
        for code, reports in wet.items():
            spot = _district_spot(spots, g.places[code])
            spot.roads += [_road(r.road_th) for r in reports]
            spot.reasons.append((3, OverviewReason(
                kind="road_flooding", text_th=f"ถนนน้ำท่วมขัง {len(reports)} สาย ยังไม่แห้ง", day=None,
                source_th="สำนักการระบายน้ำ กทม.", at=flooding.updated_at or flooding.fetched_at)))

    # ---------- now: rain measured at the department's gauges (fresh readings only) ----------
    gauges = _load(files, "bkk/rain.json", RainGauges)
    state = _input("ฝนวัดจริง กทม. (สำนักการระบายน้ำ)", gauges.fetched_at if gauges else None, now, GAUGE_MAX_AGE)
    inputs.append(state)
    if gauges and state.status == "fresh":
        strongest: dict[tuple[str, str], tuple[float, object]] = {}
        for gauge in gauges.gauges:
            if not gauge.observed_at or gauge.observed_at > now + SKEW or now - gauge.observed_at > GAUGE_MAX_AGE:
                continue
            district = (district_of(gauge.location) if gauge.location else None) or g.bangkok_district(
                gauge.district_th)
            if not district:
                continue
            for kind, value in (("hour", gauge.rain_1h_mm), ("day", gauge.rain_24h_mm)):
                limit = HOUR_WATCH_MM if kind == "hour" else DAY_WATCH_MM
                if value is not None and value >= limit and value > strongest.get((district.code, kind), (-1,))[0]:
                    strongest[(district.code, kind)] = (value, gauge)
        for (code, kind), (value, gauge) in sorted(strongest.items()):
            spot = _district_spot(spots, g.places[code])
            if kind == "hour":
                word = "ฝนหนักมาก" if value >= HOUR_VERY_HEAVY_MM else "ฝนหนัก"
                score, text = (4 if value >= HOUR_VERY_HEAVY_MM else 3), f"{word}ตอนนี้ วัดได้ {_mm(value)} มม. ใน 1 ชม."
            else:
                score, text = 2, f"ฝนสะสม 24 ชม. {_mm(value)} มม."
            spot.reasons.append((score, OverviewReason(
                kind="rain_measured", text_th=text, day=None, source_th="สำนักการระบายน้ำ กทม.",
                at=gauge.observed_at)))

    # ---------- next: forecast rain by province (Open-Meteo lattice, TMD day classes) ----------
    forecast = _load(files, "forecast/rain.json", RainForecast)
    state = _input("พยากรณ์ฝน (Open-Meteo)", forecast.fetched_at if forecast else None, now, FORECAST_MAX_AGE)
    inputs.append(state)
    ahead: dict[str, list[tuple[int, OverviewReason]]] = defaultdict(list)
    if forecast and state.status == "fresh":
        index = {tuple(p): i for i, p in enumerate(forecast.points)}
        cells: dict[str, set[int]] = defaultdict(set)
        lat0, lon0, step = forecast.lattice.south, forecast.lattice.west, forecast.lattice.step
        for place in g.places.values():
            if place.kind == "subdistrict":
                key = (round((place.location[0] - lon0) / step), round((place.location[1] - lat0) / step))
                if key in index:
                    cells[place.code[:2]].add(index[key])
        days = [(d, day, (day - today).days) for d, day in enumerate(forecast.days)
                if 0 <= (day - today).days < AHEAD_DAYS]
        # today counts only the hours still to come, not rain that has already fallen
        midnight = datetime.combine(today + timedelta(days=1), time.min, tzinfo=ICT)
        rest = [h for h, end in enumerate(forecast.hours) if now < end <= midnight]

        def day_values(d: int, away: int, members: set[int]) -> dict[int, int]:
            """Rain of the day at each cell with a value (0.1 mm); today = the hours still to come."""
            if away > 0:
                return {i: forecast.day_rain[d][i] for i in members if forecast.day_rain[d][i] is not None}
            return {i: sum(forecast.rain[h][i] for h in rest) for i in members
                    if rest and all(forecast.rain[h][i] is not None for h in rest)}

        for province, members in cells.items():
            for d, day, away in days:
                values = list(day_values(d, away, members).values())
                if not values:
                    continue
                heavy = sum(v >= HEAVY for v in values)
                very = sum(v >= VERY_HEAVY for v in values)
                if very >= max(1, math.ceil(VERY_HEAVY_SHARE * len(values))):
                    word, base = "ฝนหนักมาก", 4
                elif heavy >= max(1, math.ceil(HEAVY_SHARE * len(values))):
                    word, base = "ฝนหนัก", 2
                else:
                    continue
                share = heavy / len(values)
                whole = "เกือบทั่ว กทม." if province == "10" else "เกือบทั้งจังหวัด"
                extent = "บางพื้นที่" if share < 0.4 else "หลายพื้นที่" if share < 0.8 else whole
                score = base + (share >= 0.4) + (share >= 0.8) + (2 if away == 0 else 1 if away == 1 else 0)
                ahead[province].append((score, OverviewReason(
                    kind="rain_forecast", text_th=f"{word}{extent} สูงสุดราว {max(values) / 10:.0f} มม.",
                    day=day, source_th="Open-Meteo", at=forecast.fetched_at)))
            # three days from today at one cell (ThaiWater 3-day watch)
            three = [(d, away) for d, _, away in days if away < 3]
            if len(three) == 3:
                parts = [day_values(d, away, members) for d, away in three]
                sums = [sum(part[i] for part in parts) for i in members if all(i in part for part in parts)]
                if sums and max(sums) >= THREE_DAYS_WATCH:
                    ahead[province].append((3, OverviewReason(
                        kind="rain_3days", text_th=f"ฝนสะสม 3 วันราว {max(sums) / 10:.0f} มม. ถึงเกณฑ์เฝ้าระวังของ สสน.",
                        day=today, source_th="Open-Meteo", at=forecast.fetched_at)))
            # a short burst in the next 24 hours (ThaiWater 1-hour watch)
            burst = [(forecast.rain[h][i], end) for h, end in enumerate(forecast.hours)
                     if now < end <= now + timedelta(hours=24) for i in members if forecast.rain[h][i] is not None]
            if burst:
                value, end = max(burst, key=lambda pair: pair[0])
                if value >= BURST:
                    ahead[province].append((2, OverviewReason(
                        kind="rain_burst", text_th=f"ฝนแรงช่วงสั้นราว {value / 10:.0f} มม./ชม. เสี่ยงน้ำขังรอระบาย",
                        day=end.astimezone(ICT).date(), source_th="Open-Meteo", at=forecast.fetched_at)))

    # a place already on the "now" list takes the heaviest rain of today or tomorrow of its province with it
    attached: set[tuple[str, date | None]] = set()
    for spot in sorted(spots.values(), key=lambda s: -max(score for score, _ in s.reasons)):
        soon = [pair for pair in ahead.get(spot.province or "", [])
                if pair[1].kind == "rain_forecast" and pair[1].day is not None and (pair[1].day - today).days <= 1]
        if soon:
            best = max(soon, key=lambda pair: (pair[0], -(pair[1].day - today).days))
            spot.reasons.append((1, best[1]))
            attached.add((spot.province or "", best[1].day))
    nexts: list[_Spot] = []
    for province, reasons in ahead.items():
        left = [pair for pair in reasons if pair[1].kind != "rain_forecast" or (province, pair[1].day) not in attached]
        if left and province in g.places:
            place = g.places[province]
            nexts.append(_Spot("next", place.label, province, list(place.location), 8, left))

    # ---------- next: rivers the model sees rising a lot (GloFAS) ----------
    rivers = _load(files, "forecast/rivers.json", RiverForecast)
    state = _input("แนวโน้มแม่น้ำ (GloFAS)", rivers.fetched_at if rivers else None, now, RIVERS_MAX_AGE)
    inputs.append(state)
    if rivers and state.status == "fresh" and today in rivers.days:
        at = rivers.days.index(today)
        for point in rivers.points:
            base = point.median[at] if point.median[at] is not None else point.discharge[at]
            week = point.median[at + 1:at + 1 + RIVER_AHEAD]
            # as the web: a trend needs every day of the week ahead (Codex M18)
            if not base or base <= 0 or len(week) < RIVER_AHEAD or any(v is None for v in week):
                continue
            later = [(v, rivers.days[at + 1 + k]) for k, v in enumerate(week)]
            peak, day = max(later, key=lambda pair: pair[0])
            change = peak / base - 1
            if change >= RIVER_FAST - 1e-9:
                sub = g.nearest(point.location)
                nexts.append(_Spot("next", f"แม่น้ำ{point.name_th}", sub.code[:2] if sub else None,
                                   list(point.location), 9, [(5 + (change >= 0.6), OverviewReason(
                                       kind="river_rising",
                                       text_th=f"น้ำเพิ่มขึ้นมาก สูงสุดราว +{change * 100:.0f}% (ค่าแบบจำลอง)",
                                       day=day, source_th="GloFAS", at=rivers.fetched_at))]))

    # ---------- next: dams over their storage capacity (the Royal Irrigation Department's class) ----------
    dams = _load(files, "water/dams.json", DamReport)
    state = _input("เขื่อนใหญ่ (กรมชลประทาน)", dams.fetched_at if dams else None, now, DAMS_MAX_AGE)
    inputs.append(state)
    if dams and state.status == "fresh":
        for dam in dams.dams:
            if dam.percent is not None and dam.percent > 100 and dam.location:
                sub = g.nearest(dam.location)
                nexts.append(_Spot("next", dam.name_th, sub.code[:2] if sub else None, list(dam.location), 10, [
                    (2, OverviewReason(kind="dam_full",
                                       text_th=f"น้ำเกินความจุเก็บกัก {dam.percent:.1f}% ติดตามการระบายน้ำ",
                                       day=None, source_th="กรมชลประทาน", at=dams.fetched_at))]))

    now_items = sorted((s.item() for s in spots.values()), key=lambda i: (-i.score, i.place_th))[:MAX_NOW]
    next_items = sorted((s.item() for s in nexts),
                        key=lambda i: (-i.score, min((r.day or date.max) for r in i.reasons), i.place_th))[:MAX_NEXT]
    return Overview(generated_at=now, items=now_items + next_items, inputs=inputs, notes_th=NOTES_TH)
