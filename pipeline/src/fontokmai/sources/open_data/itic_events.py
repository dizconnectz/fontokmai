"""iTIC / Longdo Traffic event archive (CC BY 4.0): flood reports (type 6) inside the pilot bounding box.

Each yearly CSV is 20-50 MB, so it is streamed and only flood rows inside the box are kept. Finished years are
cached as small JSON files; the scheduled refresh only downloads the current year.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TextIO

from fontokmai.feeds.road_flood import FloodReport, SourceInfo, SourceRead
from fontokmai.feeds.road_names import names_in_text
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources.open_data.http import Opener

FEED_URL = "https://event.longdo.com/feed/{year}"
EVENT_PAGE = "https://traffic.longdo.com/main/e/A{eid:08d}/"
FLOOD_TYPE = "6"
FIRST_YEAR = 2012
CACHE_VERSION = 1
INFO = SourceInfo(
    source_id="itic_longdo_events",
    name_th="เหตุการณ์น้ำท่วมจาก iTIC และ Longdo Traffic",
    credit_th="iTIC และ Longdo Traffic (ผู้สร้างเหตุการณ์แต่ละราย) · CC BY 4.0"
              " · fontokmai คัดเฉพาะเหตุน้ำท่วมและอ่านชื่อถนนจากหัวเรื่อง",
    license="CC BY 4.0",
    url="https://traffic.longdo.com/download",
)
ICT = timezone(timedelta(hours=7))
BBox = tuple[float, float, float, float]  # lon_min, lat_min, lon_max, lat_max


class BackfillNeeded(RuntimeError):
    """A finished year has no cache; run `fontokmai road-flood-history` once to download the archive."""


@dataclass(frozen=True)
class FloodRow:
    eid: int | None
    title: str
    lon: float
    lat: float
    start: str
    stop: str


def _moment(text: str) -> datetime | None:
    text = text.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=ICT)
        except ValueError:
            continue
    return None


def parse_feed(stream: TextIO, bbox: BBox) -> tuple[list[FloodRow], int]:
    """Flood rows inside bbox, and how many flood rows were rejected for bad coordinates or times."""
    csv.field_size_limit(10_000_000)
    reader = csv.DictReader(stream)
    # some yearly files start with two byte-order marks; utf-8-sig removes only the first
    reader.fieldnames = [name.lstrip("﻿").strip() for name in reader.fieldnames or []]
    rows: list[FloodRow] = []
    rejected = 0
    for row in reader:
        if (row.get("type") or "").strip() != FLOOD_TYPE:
            continue
        try:
            lat, lon = float(row["latitude"]), float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            rejected += 1
            continue
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            continue
        start = (row.get("start") or "").strip()
        if _moment(start) is None:
            rejected += 1
            continue
        eid = (row.get("eid") or "").strip()
        rows.append(FloodRow(eid=int(eid) if eid.isdigit() else None, title=" ".join((row.get("title") or "").split()),
                             lon=lon, lat=lat, start=start, stop=(row.get("stop") or "").strip()))
    return rows, rejected


def to_report(row: FloodRow) -> FloodReport:
    start = _moment(row.start)
    assert start is not None  # parse_feed keeps only rows with a valid start
    return FloodReport(
        source_id=INFO.source_id, date=start.date(), start=start, stop=_moment(row.stop) if row.stop else None,
        names=tuple(names_in_text(row.title)), spot=row.title[:160] or None, lon=row.lon, lat=row.lat,
        url=EVENT_PAGE.format(eid=row.eid) if row.eid is not None else None,
    )


def _cache_path(cache_dir: Path, year: int) -> Path:
    return cache_dir / f"itic_flood_{year}.json"


def _load_cache(path: Path, bbox: BBox) -> tuple[list[FloodRow], int] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if data.get("version") != CACHE_VERSION or data.get("bbox") != list(bbox):
        return None
    return [FloodRow(**row) for row in data["rows"]], int(data["rejected"])


def _save_cache(path: Path, bbox: BBox, rows: list[FloodRow], rejected: int) -> None:
    data = {"version": CACHE_VERSION, "bbox": list(bbox), "rejected": rejected,
            "rows": [row.__dict__ for row in rows]}
    atomic_write(path, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def missing_years(cache_dir: Path, now: datetime, bbox: BBox, first_year: int = FIRST_YEAR) -> list[int]:
    current = now.astimezone(ICT).year
    return [y for y in range(first_year, current) if _load_cache(_cache_path(cache_dir, y), bbox) is None]


def collect(opener: Opener, now: datetime, cache_dir: Path, bbox: BBox, *, first_year: int = FIRST_YEAR,
            backfill: bool = True) -> SourceRead:
    """Read every year from first_year to the current year; finished years come from the cache when present."""
    current = now.astimezone(ICT).year
    missing = missing_years(cache_dir, now, bbox, first_year)
    if missing and not backfill:
        raise BackfillNeeded(f"no cache for {missing[0]}..{missing[-1]} in {cache_dir}")
    reports: list[FloodReport] = []
    rejected = 0
    for year in range(first_year, current + 1):
        cached = _load_cache(_cache_path(cache_dir, year), bbox) if year < current else None
        if cached is None:
            with opener(FEED_URL.format(year=year)) as fh:
                cached = parse_feed(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""), bbox)
            if year < current:
                _save_cache(_cache_path(cache_dir, year), bbox, *cached)
        rows, dropped = cached
        reports.extend(to_report(row) for row in rows)
        rejected += dropped
    return SourceRead(info=INFO, reports=reports, rejected=rejected, retrieved_at=now)
