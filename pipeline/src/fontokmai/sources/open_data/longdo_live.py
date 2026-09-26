"""Live flood reports from the Longdo Event feed (event.longdo.com/feed, iTIC and Longdo Traffic, CC BY 4.0).

The RSS lists events that are still open: reports by the public and iTIC staff (one hour each) and Department of
Highways reports that last until the road is clear. Only floods (type 6) are kept, and only type, place, time, road
and title: descriptions and photos often come from other people, and contributor names are never published.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree

from pydantic import ValidationError

from fontokmai.contracts.live_floods import LiveFloodReport, LiveFloods
from fontokmai.sources.open_data.http import OpenDataError, Opener, read_bytes

SOURCE_ID = "longdo_floods"
FEED_URL = "https://event.longdo.com/feed"
PAGE_URL = "https://traffic.longdo.com/"
FILE_PATH = "live/floods.json"
FLOOD_TYPE = "6"
RECENT = timedelta(hours=2)
FEED_LIMIT = 8_000_000
ICT = timezone(timedelta(hours=7))
CREDIT_TH = "iTIC และ Longdo Traffic (CC BY 4.0)"
NOTES_TH = [
    "เป็นรายงานจากผู้ใช้ เจ้าหน้าที่ iTIC และกรมทางหลวง ไม่ใช่การตรวจวัด และไม่ครบทุกจุดที่ท่วม",
    "รายงานของผู้ใช้มีอายุ 1 ชั่วโมง น้ำอาจยังท่วมอยู่หรือลดลงแล้ว",
    "ไม่มีรายงานใกล้จุดหนึ่งไม่ได้แปลว่าที่นั่นไม่ท่วม",
]


@dataclass(frozen=True)
class FloodsRound:
    feed: LiveFloods | None
    ok: bool
    seen: int
    rejected: int
    message: str | None


def _reporter(contributor: str) -> str:
    if contributor == "DOH Admin":
        return "highway_department"
    return "itic_staff" if contributor.startswith("itic.") else "public"


def _time(stamp: str | None) -> datetime | None:
    return datetime.fromtimestamp(int(stamp), tz=UTC).astimezone(ICT) if stamp and stamp.isdigit() else None


def _url(link: str | None, eid: str) -> str:
    parts = urlsplit(link or "")
    if parts.scheme == "https" and parts.hostname in ("traffic.longdo.com", "event.longdo.com"):
        return link  # type: ignore[return-value]
    return f"https://traffic.longdo.com/e/A{int(eid):08d}"


def parse_feed(data: bytes, now: datetime) -> tuple[list[LiveFloodReport], int, int]:
    """(reports, flood items seen, flood items rejected), newest start first."""
    root = ElementTree.fromstring(data)
    reports: list[LiveFloodReport] = []
    seen = rejected = 0
    for item in root.iterfind("./channel/item"):
        if (item.findtext("type") or "").strip() != FLOOD_TYPE:
            continue
        seen += 1
        try:
            eid = (item.findtext("eid") or "").strip()
            start = _time(item.findtext("starttimestamp"))
            stop = _time(item.findtext("stoptimestamp"))
            lon, lat = float(item.findtext("longitude") or ""), float(item.findtext("latitude") or "")
            if not eid.isdigit() or start is None or not (97 <= lon <= 106 and 5 <= lat <= 21):
                raise ValueError("incomplete report")
        except ValueError:
            rejected += 1
            continue
        if (item.findtext("status") or "1").strip() != "1" or start > now + timedelta(minutes=10):
            continue
        if stop is not None and stop < now - RECENT:
            continue
        try:
            reports.append(LiveFloodReport(
                id=f"longdo:{eid}", title_th=" ".join((item.findtext("title") or "น้ำท่วม").split())[:160],
                road_th=" ".join((item.findtext("road") or "").split())[:120] or None,
                location=[round(lon, 6), round(lat, 6)], start=start, stop=stop,
                reporter=_reporter((item.findtext("contributor") or "").strip()),
                url=_url(item.findtext("link"), eid),
            ))
        except ValidationError:
            rejected += 1
    reports.sort(key=lambda r: (r.start, r.id), reverse=True)
    return reports, seen, rejected


def _previous(out: Path) -> LiveFloods | None:
    try:
        return LiveFloods.model_validate_json((out / FILE_PATH).read_bytes())
    except (OSError, ValueError):
        return None


def collect_floods(opener: Opener, out: Path, now: datetime) -> FloodsRound:
    """Read the feed; on failure keep publishing the last good file (its fetched_at shows its age)."""
    try:
        reports, seen, rejected = parse_feed(read_bytes(opener, FEED_URL, FEED_LIMIT), now)
    except (OpenDataError, ElementTree.ParseError) as exc:
        return FloodsRound(feed=_previous(out), ok=False, seen=0, rejected=0, message=str(exc)[:200])
    feed = LiveFloods(fetched_at=now.astimezone(ICT), source_url=PAGE_URL, credit_th=CREDIT_TH, reports=reports,
                      notes_th=NOTES_TH)
    return FloodsRound(feed=feed, ok=True, seen=seen, rejected=rejected, message=None)
