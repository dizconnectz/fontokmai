"""BMA open data: flooded main roads per year (สำนักการระบายน้ำ, CC BY) from data.bangkok.go.th dataset frd_dds."""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta, timezone

from fontokmai.feeds.road_flood import FloodReport, SourceInfo, SourceRead
from fontokmai.feeds.road_names import clean_name
from fontokmai.sources.open_data.http import Opener, read_bytes, read_json

PACKAGE_API = "https://data.bangkok.go.th/api/3/action/package_show?id=frd_dds"
INFO = SourceInfo(
    source_id="bma_road_flood_stats",
    name_th="สถิติน้ำท่วมขังบนถนนสายหลัก สำนักการระบายน้ำ กรุงเทพมหานคร",
    credit_th="สำนักการระบายน้ำ กรุงเทพมหานคร (ข้อมูลเปิด data.bangkok.go.th, CC BY)",
    license="CC BY",
    url="https://data.bangkok.go.th/dataset/frd_dds",
)
ICT = timezone(timedelta(hours=7))
_YEAR_IN_NAME = re.compile(r"\((\d{4})\)\s*$")
_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
_TIME = re.compile(r"^(\d{1,2}):(\d{2})$")
_NUMBER = re.compile(r"^\d+(?:\.\d+)?$")
DATE_FIELDS = ("frd_rain_datestart", "frd_rain_datestop", "frd_flood_date_begin", "frd_flood_date_end")


def yearly_resources(package: dict) -> list[tuple[int, str]]:
    """(year, url) of the per-year CSV files; the older combined export has no year in its name and is skipped."""
    found = []
    for resource in package["result"]["resources"]:
        match = _YEAR_IN_NAME.search(resource.get("name") or "")
        if match and (resource.get("format") or "CSV").upper() == "CSV":
            found.append((int(match.group(1)), resource["url"]))
    return sorted(found)


def decode_lines(raw: bytes) -> str:
    """UTF-8 as in the yearly files, with a per-line fallback to TIS-620 (cp874) used by older exports."""
    lines = []
    for line in raw.removeprefix(b"\xef\xbb\xbf").split(b"\n"):
        try:
            lines.append(line.decode("utf-8"))
        except UnicodeDecodeError:
            lines.append(line.decode("cp874", errors="replace"))
    return "\n".join(lines)


def date_order(rows: list[dict[str, str]]) -> str:
    """'dmy' when any first part is above 12, else 'mdy' (the yearly exports are month first)."""
    for row in rows:
        for field in DATE_FIELDS:
            match = _DATE.match((row.get(field) or "").strip())
            if match and int(match.group(1)) > 12:
                return "dmy"
    return "mdy"


def _date(text: str | None, order: str) -> date | None:
    match = _DATE.match((text or "").strip())
    if not match:
        return None
    first, second, year = (int(g) for g in match.groups())
    month, day = (first, second) if order == "mdy" else (second, first)
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _moment(day_text: str | None, time_text: str | None, order: str) -> datetime | None:
    day = _date(day_text, order)
    match = _TIME.match((time_text or "").strip())
    if day is None or not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ICT)


def _text(value: str | None) -> str | None:
    text = " ".join((value or "").split())
    return text or None


def _number(value: str | None) -> float | None:
    text = (value or "").strip().replace(",", "")
    return float(text) if _NUMBER.match(text) else None


def parse_year_file(raw: bytes, year: int) -> tuple[list[FloodReport], int]:
    rows = list(csv.DictReader(io.StringIO(decode_lines(raw))))
    order = date_order(rows)
    reports: list[FloodReport] = []
    rejected = 0
    for row in rows:
        start = _moment(row.get("frd_flood_date_begin"), row.get("frd_flood_begin"), order)
        stop = _moment(row.get("frd_flood_date_end"), row.get("frd_flood_end"), order)
        day = start.date() if start else _date(row.get("frd_rain_datestart"), order)
        if day is None or day.year != year:  # e.g. 7/13/2026 inside the 2024 file
            rejected += 1
            continue
        road = clean_name(row.get("frd_road") or "")
        depth, length = _number(row.get("frd_flood_height")), _number(row.get("frd_flood_distance"))
        district = _text(row.get("district"))
        reports.append(FloodReport(
            source_id=INFO.source_id, date=day, start=start, stop=stop, names=(road,) if road else (),
            spot=_text(row.get("frd_area")),
            district=district.removeprefix("เขต").strip() or None if district else None,
            depth_cm=int(depth) if depth is not None else None, length_m=int(length) if length is not None else None,
            lanes=_text(row.get("frd_flood_lane")), rain_mm=_number(row.get("frd_total_rainfall")),
        ))
    return reports, rejected


def collect(opener: Opener, now: datetime) -> SourceRead:
    package = read_json(opener, PACKAGE_API)
    reports: list[FloodReport] = []
    rejected = 0
    for year, url in yearly_resources(package):
        found, dropped = parse_year_file(read_bytes(opener, url), year)
        reports.extend(found)
        rejected += dropped
    return SourceRead(info=INFO, reports=reports, rejected=rejected, retrieved_at=now)
