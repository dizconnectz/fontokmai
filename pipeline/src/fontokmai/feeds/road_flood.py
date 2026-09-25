"""Group flood reports by road into the published ref/road_flood_history.json (contracts/v1 section 8)."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime

from fontokmai.contracts.road_flood import (
    POINT_LIMIT,
    RECENT_LIMIT,
    RoadFloodHistory,
    RoadFloodReport,
    RoadFloodRoad,
    RoadFloodSource,
)
from fontokmai.feeds.road_names import kind_of, search_key

NOTES_TH = [
    "นับจากรายงานของหน่วยงานและผู้ใช้ ไม่ครบทุกครั้ง ถนนที่ไม่มีรายงานไม่ได้แปลว่าไม่เคยท่วม",
    "“วัน” นับวันที่มีรายงานอย่างน้อยหนึ่งครั้ง หลายรายงานในวันเดียวกันนับเป็นหนึ่งวัน",
    "ชื่อถนนจาก iTIC/Longdo อ่านจากหัวเรื่องของเหตุการณ์ จึงอาจตกหล่นหรือผิดได้",
    "สถิติของ กทม. ครอบคลุมถนนสายหลักในความรับผิดชอบของสำนักการระบายน้ำ และไม่มีพิกัด",
]


@dataclass(frozen=True)
class FloodReport:
    source_id: str
    date: date
    start: datetime | None
    stop: datetime | None
    names: tuple[str, ...]
    spot: str | None = None
    district: str | None = None
    depth_cm: int | None = None
    length_m: int | None = None
    lanes: str | None = None
    rain_mm: float | None = None
    lon: float | None = None
    lat: float | None = None
    url: str | None = None


@dataclass(frozen=True)
class SourceInfo:
    source_id: str
    name_th: str
    credit_th: str
    license: str
    url: str


@dataclass(frozen=True)
class SourceRead:
    info: SourceInfo
    reports: list[FloodReport]
    rejected: int
    retrieved_at: datetime


def _order(report: FloodReport) -> tuple:
    """Newest first, then a fixed tie-break so the output is byte-for-byte reproducible."""
    moment = report.start.isoformat() if report.start else ""
    return (report.date.isoformat(), moment, report.source_id, report.url or "", report.spot or "")


def _published(report: FloodReport) -> RoadFloodReport:
    has_location = report.lon is not None and report.lat is not None
    location = [round(report.lon, 4), round(report.lat, 4)] if has_location else None
    return RoadFloodReport(date=report.date, source_id=report.source_id, start=report.start, stop=report.stop,
                           spot=report.spot, district=report.district, depth_cm=report.depth_cm,
                           length_m=report.length_m, lanes=report.lanes, rain_mm=report.rain_mm,
                           location=location, url=report.url)


def _road(key: str, items: list[tuple[str, FloodReport]]) -> RoadFloodRoad:
    names = Counter(name for name, _ in items)
    name_th = sorted(names, key=lambda n: (-names[n], n))[0]
    reports = sorted({id(r): r for _, r in items}.values(), key=_order, reverse=True)
    days = {r.date for r in reports}
    by_year = Counter(d.year for d in days)
    districts = Counter(r.district for r in reports if r.district)
    depths = [r.depth_cm for r in reports if r.depth_cm is not None]
    points: list[list[float]] = []
    for r in reports:
        if r.lon is None or r.lat is None:
            continue
        point = [round(r.lon, 4), round(r.lat, 4)]
        if point not in points:
            points.append(point)
        if len(points) == POINT_LIMIT:
            break
    return RoadFloodRoad(
        key=key, name_th=name_th, kind=kind_of(key),
        districts=sorted(districts, key=lambda d: (-districts[d], d)),
        flood_days=len(days), reports=len(reports), first_date=min(days), last_date=max(days),
        days_by_year={str(y): by_year[y] for y in sorted(by_year)},
        max_depth_cm=max(depths) if depths else None, points=points,
        recent=[_published(r) for r in reports[:RECENT_LIMIT]],
    )


def _source(read: SourceRead) -> RoadFloodSource:
    dates = [r.date for r in read.reports]
    info = read.info
    return RoadFloodSource(
        source_id=info.source_id, name_th=info.name_th, credit_th=info.credit_th, license=info.license, url=info.url,
        period_from=min(dates) if dates else None, period_to=max(dates) if dates else None,
        reports=len(read.reports), reports_without_place=sum(1 for r in read.reports if not r.names),
        rejected=read.rejected, retrieved_at=read.retrieved_at,
    )


def build_history(reads: list[SourceRead], *, built_at: datetime, bbox: tuple[float, float, float, float],
                  area_th: str) -> RoadFloodHistory:
    groups: dict[str, list[tuple[str, FloodReport]]] = defaultdict(list)
    for read in reads:
        for report in read.reports:
            for name in report.names:
                key = search_key(name)
                if key:
                    groups[key].append((name, report))
    roads = [_road(key, groups[key]) for key in sorted(groups)]
    return RoadFloodHistory(built_at=built_at, area_th=area_th, bbox=list(bbox), sources=[_source(r) for r in reads],
                            roads=roads, notes_th=NOTES_TH)


def distance_m(a: list[float], b: list[float]) -> float:
    """Great-circle distance between two [lon, lat] points in metres (haversine, R = 6,371,008.8 m)."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(math.sqrt(h))


def roads_near(history: RoadFloodHistory, pin: list[float],
               radius_m: float = 2000) -> list[tuple[RoadFloodRoad, float]]:
    """Reference 'near a pin' rule: roads with a report point within radius_m, nearest first, then most flood days."""
    hits = []
    for road in history.roads:
        if road.points:
            nearest = min(distance_m(pin, point) for point in road.points)
            if nearest <= radius_m:
                hits.append((road, nearest))
    return sorted(hits, key=lambda hit: (round(hit[1]), -hit[0].flood_days, hit[0].key))


def search_roads(history: RoadFloodHistory, query: str) -> list[RoadFloodRoad]:
    """Reference search for the web: key contains the query key; most flood days first, then latest, then key."""
    key = search_key(query)
    if not key:
        return []
    hits = [road for road in history.roads if key in road.key]
    return sorted(hits, key=lambda r: (-r.flood_days, -r.last_date.toordinal(), r.key))
