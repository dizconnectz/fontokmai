"""TMD radar composite (weather.tmd.go.th/composite): the latest rain-rate frames, republished with credit.

TMD names its frames by position (zr/0.png … zr/24.png) and shifts them every 15 minutes, so the list is read
again after the downloads; if the mapping moved in between, the round is retried once rather than labelling a
frame with the wrong time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from fontokmai.contracts.radar import RadarFeed, RadarFrame, RadarLegendItem
from fontokmai.sources.tmd_cap.fetch import Fetcher, FetchError

SOURCE_ID = "tmd_radar"
PAGE_URL = "https://weather.tmd.go.th/composite/index_composite.html"
LIST_URL = "https://weather.tmd.go.th/composite/images_composite.list"
IMAGE_BASE = "https://weather.tmd.go.th/composite/images/"
COORDINATES = [[95.0, 22.5], [108.0, 22.5], [108.0, 4.0], [95.0, 4.0]]
FRAMES = 4  # one hour
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
LEGEND = [  # read from the colour bar of the TMD page on 2026-09-26 (mm/hr, Z = 200 R^1.6)
    (80.0, "#DD0000", "> 80"), (56.0, "#FE45A2", "56"), (48.0, "#FF86FF", "48"), (40.0, "#FF8000", "40"),
    (32.0, "#FFFF00", "32"), (24.0, "#7CCE02", "24"), (16.0, "#46FF09", "16"), (12.0, "#00E10C", "12"),
    (8.0, "#00B347", "8"), (4.0, "#009375", "4"), (2.0, "#0006F0", "2"), (1.0, "#003C6C", "1"),
    (0.1, "#0077C6", "0.1"), (0.0, "#00FFFF", "0"), (None, "#CCCCCC", "ไม่มีข้อมูล"),
]
LEGEND_OPACITY = 0.816  # measured: #0077C6 is drawn as #2F8DCB, #0006F0 as #2F35EC
NOTES_TH = [
    "ภาพเรดาร์บอกว่าฝนตกตรงไหนและแรงแค่ไหนโดยประมาณ ไม่ใช่ปริมาณฝนที่วัดได้จากสถานี",
    "เป็นค่าที่ระดับสูง 2 กม. ฝนที่พื้นอาจต่างออกไป และบางพื้นที่อยู่นอกรัศมีเรดาร์",
]
_LINE = re.compile(r'^(\S+)\s+"([^"]+)"\s+overlay=(.+)$')
_OVERLAY = re.compile(r"^zr/\d+\.png$")


@dataclass(frozen=True)
class RadarRound:
    files: dict[str, bytes]
    feed: RadarFeed
    ok: bool
    frames_seen: int
    rejected: int
    message: str | None


def parse_list(text: str) -> list[tuple[datetime, str]]:
    """(UTC time, overlay path) of every rain-rate frame, oldest first."""
    frames = []
    for line in text.splitlines():
        match = _LINE.match(line.strip())
        if not match:
            continue
        overlay = next((part.strip() for part in match.group(3).split(",") if _OVERLAY.match(part.strip())), None)
        try:
            when = datetime.strptime(match.group(2), "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
        except ValueError:
            continue
        if overlay:
            frames.append((when, overlay))
    return sorted(frames)


def frame_path(when: datetime) -> str:
    return f"radar/{when:%Y%m%dT%H%MZ}.png"


def _is_png(data: bytes) -> bool:
    return data.startswith(PNG_SIGNATURE) and data[12:16] == b"IHDR"


def _fetch_allowed(fetch: Fetcher, url: str) -> bytes:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != "weather.tmd.go.th" or not parts.path.startswith("/composite/"):
        raise FetchError(f"{url}: outside the radar allowlist")
    return fetch(url)


def _feed(frames: list[tuple[datetime, str]], generation_id: str) -> RadarFeed:
    return RadarFeed(
        generation_id=generation_id, name_th="ความเข้มฝนจากเรดาร์ (ระดับ 2 กม.)", credit_th="กรมอุตุนิยมวิทยา",
        source_url=PAGE_URL, coordinates=COORDINATES,
        frames=[RadarFrame(time=when, path=path) for when, path in frames],
        legend=[RadarLegendItem(min_mm_per_hr=v, color=c, label=label) for v, c, label in LEGEND],
        legend_opacity=LEGEND_OPACITY, notes_th=NOTES_TH,
    )


def _previous_frames(out: Path) -> list[tuple[datetime, str]]:
    """Frames of the last published radar.json whose PNG files are still on disk."""
    try:
        previous = RadarFeed.model_validate_json((out / "radar.json").read_bytes())
    except (OSError, ValueError):
        return []
    return [(f.time, f.path) for f in previous.frames if (out / f.path).is_file()]


def collect_radar(fetch: Fetcher, out: Path, generation_id: str) -> RadarRound:
    rejected = 0
    try:
        for attempt in range(2):
            listed = parse_list(_fetch_allowed(fetch, LIST_URL).decode("utf-8", errors="replace"))[-FRAMES:]
            if not listed:
                raise FetchError(f"{LIST_URL}: no rain-rate frames")
            files: dict[str, bytes] = {}
            frames: list[tuple[datetime, str]] = []
            for when, overlay in listed:
                path = frame_path(when)
                existing = out / path
                data = existing.read_bytes() if existing.is_file() else _fetch_allowed(fetch, IMAGE_BASE + overlay)
                if not _is_png(data):
                    rejected += 1
                    continue
                files[path] = data
                frames.append((when, path))
            recheck = parse_list(_fetch_allowed(fetch, LIST_URL).decode("utf-8", errors="replace"))
            if set(listed) <= set(recheck):
                break
            if attempt == 1:
                raise FetchError("frame list kept moving during the download")
        feed = _feed(frames, generation_id)
        files["radar.json"] = feed.model_dump_json().encode("utf-8")
        return RadarRound(files=files, feed=feed, ok=bool(frames), frames_seen=len(listed), rejected=rejected,
                          message=None if frames else "no valid frame")
    except (FetchError, OSError) as exc:
        frames = _previous_frames(out)
        feed = _feed(frames, generation_id)
        files = {path: (out / path).read_bytes() for _, path in frames}
        files["radar.json"] = feed.model_dump_json().encode("utf-8")
        return RadarRound(files=files, feed=feed, ok=False, frames_seen=0, rejected=rejected, message=str(exc)[:200])


def prune_frames(out: Path, feed: RadarFeed) -> list[str]:
    """Remove PNG files of frames that the published radar.json no longer lists."""
    keep = {f.path for f in feed.frames}
    removed = []
    for png in sorted((out / "radar").glob("*.png")):
        rel = f"radar/{png.name}"
        if rel not in keep:
            png.unlink(missing_ok=True)
            removed.append(rel)
    return removed


def summary(feed: RadarFeed) -> dict[str, object]:
    return {"frames": len(feed.frames), "latest": feed.frames[-1].time.isoformat() if feed.frames else None}
