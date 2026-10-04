"""TMD radar composite (weather.tmd.go.th/composite): the latest rain-rate frames, republished with credit.

TMD names its frames by position (zr/0.png … zr/24.png) and shifts them every 15 minutes, so the list is read
again after the downloads; if the mapping moved in between, the round is retried once rather than labelling a
frame with the wrong time.

The colour scale is read from the colour bar of the TMD page every round: TMD replaced it between 26 and 28 Sep
2026, and a reader matching pixels to an old scale says wrong things (a light 3 mm/hr as 32). A latest frame whose
colours do not match the scale is published with no legend, so that nobody reads values from it.
"""

from __future__ import annotations

import html
import math
import re
import struct
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image

from fontokmai.contracts.radar import RadarFeed, RadarFrame, RadarLegendItem
from fontokmai.sources.tmd_cap.fetch import Fetcher, FetchError

SOURCE_ID = "tmd_radar"
PAGE_URL = "https://weather.tmd.go.th/composite/index_composite.html"
LIST_URL = "https://weather.tmd.go.th/composite/images_composite.list"
IMAGE_BASE = "https://weather.tmd.go.th/composite/images/"
COORDINATES = [[95.0, 22.5], [108.0, 22.5], [108.0, 4.0], [95.0, 4.0]]
FRAMES = 4  # one hour
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# TMD draws the composite in Web Mercator between COORDINATES (1800 x 2644 px: the Mercator height of that
# box is 2644.5 px, a lat/lon grid would be 2561.5 px), the same way its own MapLibre viewer places it.
# A frame of another shape means the product changed and would be drawn or read in the wrong place.
SHAPE_TOLERANCE = 0.01  # of the height
# The colour bar of the TMD page on 2026-09-28 (mm/hr), used when the page cannot be read. A colour the bar lists
# twice (#66C43C at 0.50 and 0.72, #D79C37 at 12.5 and 17.9, #B72D54 at 74.6 and 106.7, #EFE6F1 at 445 and > 636)
# covers both classes, so it keeps the lower value.
LEGEND = [
    (445.0, "#EFE6F1", "445"), (311.4, "#F3CBFA", "311.4"), (217.9, "#EA8CF8", "217.9"),
    (152.5, "#E345F5", "152.5"), (74.6, "#B72D54", "74.6"), (52.2, "#CA325D", "52.2"), (36.5, "#D43320", "36.5"),
    (25.6, "#E3622A", "25.6"), (12.5, "#D79C37", "12.5"), (8.76, "#F1C946", "8.76"), (6.13, "#D6D648", "6.13"),
    (4.29, "#DEDF4B", "4.29"), (3.0, "#F3F453", "3"), (2.1, "#7BEC4B", "2.1"), (1.47, "#73DE45", "1.47"),
    (1.03, "#69CB5A", "1.03"), (0.5, "#66C43C", "0.5"), (0.24, "#5EB738", "0.24"), (0.21, "#54A431", "0.21"),
]
LEGEND_OPACITY = 1.0  # since the scale of 28 Sep the frames draw its colours as they are (the old one was 0.816)
MATCH_MIN = 0.9  # share of the drawn pixels of the latest frame that must be legend colours
MATCH_DISTANCE = 3 * 12**2  # squared RGB distance still counted as a legend colour
_SWATCH = re.compile(r'class="cbar-swatch"\s+style="background:\s*(#[0-9A-Fa-f]{6})\s*"\s*>\s*</span>\s*'
                     r'<span class="cbar-val">([^<]+)</span>')
NOTES_TH = [
    "ภาพเรดาร์บอกว่าฝนตกตรงไหนและแรงแค่ไหนโดยประมาณ ไม่ใช่ปริมาณฝนที่วัดได้จากสถานี",
    "เป็นค่าที่ระดับสูง 2 กม. ฝนที่พื้นอาจต่างออกไป และบางพื้นที่อยู่นอกรัศมีเรดาร์",
]
SAMPLE_KM = 1.5  # a frame is read about every 1.5 km (a pixel is ~0.8 km): finer adds time, not places
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


def mercator_y(lat: float) -> float:
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def mercator_height(width: int, coordinates: list[list[float]] = COORDINATES) -> float:
    """Height in pixels of a Web Mercator image of this width between the corners (square pixels)."""
    (west, north), _, (east, south), _ = coordinates
    return width * (mercator_y(north) - mercator_y(south)) / math.radians(east - west)


def png_size(data: bytes) -> tuple[int, int] | None:
    if not (data.startswith(PNG_SIGNATURE) and data[12:16] == b"IHDR" and len(data) >= 24):
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _is_frame(data: bytes) -> bool:
    """A PNG with the Web Mercator shape of COORDINATES."""
    size = png_size(data)
    return size is not None and size[0] > 0 and abs(size[1] - mercator_height(size[0])) <= SHAPE_TOLERANCE * size[1]


def _fetch_allowed(fetch: Fetcher, url: str) -> bytes:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != "weather.tmd.go.th" or not parts.path.startswith("/composite/"):
        raise FetchError(f"{url}: outside the radar allowlist")
    return fetch(url)


def parse_legend(page: str) -> list[tuple[float, str, str]] | None:
    """(mm/hr, colour, label) of the colour bar of the TMD page, highest first; a colour listed twice keeps its
    lower value. None when the page has no bar that looks right."""
    lowest: dict[str, float] = {}
    for colour, text in _SWATCH.findall(page):
        number = re.sub(r"[^0-9.]", "", html.unescape(text))
        try:
            value = float(number)
        except ValueError:
            return None
        colour = colour.upper()
        lowest[colour] = min(value, lowest.get(colour, value))
    if len(lowest) < 5 or min(lowest.values()) <= 0:
        return None
    return sorted(((value, colour, f"{value:g}") for colour, value in lowest.items()), reverse=True)


def _legend_colours(feed: RadarFeed) -> list[tuple[float | None, tuple[float, float, float]]]:
    return [(item.min_mm_per_hr, _blend(item.color, feed.legend_opacity)) for item in feed.legend]


def legend_match(feed: RadarFeed, png: bytes) -> float | None:
    """Share of the drawn pixels of a frame whose colour is one of the legend; None when nothing is drawn."""
    image = Image.open(BytesIO(png)).convert("RGBA")
    legend = _legend_colours(feed)
    drawn = matched = 0
    for count, rgba in image.getcolors(image.width * image.height) or []:
        if rgba[3] < 16:
            continue
        drawn += count
        if legend and min(sum((a - b) ** 2 for a, b in zip(colour, rgba, strict=False))
                          for _, colour in legend) <= MATCH_DISTANCE:
            matched += count
    return matched / drawn if drawn else None


def _feed(frames: list[tuple[datetime, str]], generation_id: str,
          legend: list[tuple[float, str, str]] | None = None) -> RadarFeed:
    return RadarFeed(
        generation_id=generation_id, name_th="ความเข้มฝนจากเรดาร์ (ระดับ 2 กม.)", credit_th="กรมอุตุนิยมวิทยา",
        source_url=PAGE_URL, coordinates=COORDINATES,
        frames=[RadarFrame(time=when, path=path) for when, path in frames],
        legend=[RadarLegendItem(min_mm_per_hr=v, color=c, label=label) for v, c, label in
                (LEGEND if legend is None else legend)],
        legend_opacity=LEGEND_OPACITY, notes_th=NOTES_TH,
    )


def _page_legend(fetch: Fetcher) -> tuple[list[tuple[float, str, str]], str | None]:
    """The colour bar of the page, or the one written here with the reason it was not read."""
    try:
        parsed = parse_legend(_fetch_allowed(fetch, PAGE_URL).decode("utf-8", errors="replace"))
    except (FetchError, OSError, ValueError) as exc:
        return LEGEND, f"colour bar not read ({str(exc)[:80]}); the one of 2026-09-28 is used"
    return (parsed, None) if parsed else (LEGEND, "no colour bar on the page; the one of 2026-09-28 is used")


def _previous_feed(out: Path, generation_id: str) -> RadarFeed:
    """The last published radar.json with only the frames whose PNG files are still on disk, under this generation.
    The frames keep the colour bar, opacity and corners they were published with (an empty bar stays empty: those
    pictures were not readable then either, Codex M29); without a readable file, nothing is shown or read."""
    try:
        previous = RadarFeed.model_validate_json((out / "radar.json").read_bytes())
    except (OSError, ValueError):
        return _feed([], generation_id, [])
    frames = [frame for frame in previous.frames if (out / frame.path).is_file()]
    return previous.model_copy(update={"generation_id": generation_id, "frames": frames})


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
                if not _is_frame(data):
                    rejected += 1
                    continue
                files[path] = data
                frames.append((when, path))
            recheck = parse_list(_fetch_allowed(fetch, LIST_URL).decode("utf-8", errors="replace"))
            if set(listed) <= set(recheck):
                break
            if attempt == 1:
                raise FetchError("frame list kept moving during the download")
        legend, note = _page_legend(fetch)
        feed = _feed(frames, generation_id, legend)
        notes = [f"{rejected} frame(s) rejected: not a PNG of the Web Mercator shape"] if rejected else []
        matches = [legend_match(feed, files[path]) for _, path in frames]
        if frames and (matches[-1] is None or matches[-1] >= MATCH_MIN):
            # the latest frame is in this scale: older frames drawn in another one (TMD changed it) are left out
            old = [path for (_, path), match in zip(frames, matches, strict=True)
                   if match is not None and match < MATCH_MIN]
            if old:
                frames = [(when, path) for when, path in frames if path not in old]
                files = {path: data for path, data in files.items() if path not in old}
                feed = _feed(frames, generation_id, legend)
                notes.append(f"{len(old)} older frame(s) left out: drawn in another colour scale")
        elif frames:
            # the colours are not the scale of the page: the pictures go out, but no legend to read values with
            feed = _feed(frames, generation_id, [])
            notes.append(f"latest frame matches the colour bar for {matches[-1]:.0%} of its pixels: legend left empty")
        if note:
            notes.append(note)
        files["radar.json"] = feed.model_dump_json().encode("utf-8")
        message = " · ".join(notes) or None
        return RadarRound(files=files, feed=feed, ok=bool(frames), frames_seen=len(listed), rejected=rejected,
                          message=message if frames else f"no valid frame ({message or 'empty list'})")
    except (FetchError, OSError) as exc:
        feed = _previous_feed(out, generation_id)
        files = {frame.path: (out / frame.path).read_bytes() for frame in feed.frames}
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


def _blend(color: str, opacity: float) -> tuple[float, float, float]:
    """A legend colour as the frames draw it: blended over white at the legend opacity."""
    return tuple(int(color[i:i + 2], 16) * opacity + 255 * (1 - opacity) for i in (1, 3, 5))


def rain_samples(feed: RadarFeed, png: bytes, box: tuple[float, float, float, float],
                 min_mm: float) -> list[tuple[float, float, float, float]]:
    """(lon, lat, km², mm/hr) of the samples of a frame inside box (west, south, east, north) whose rain-rate class
    is at least min_mm. A pixel takes the nearest legend colour, as the web reads one (geo.radarClass), only when it is
    within MATCH_DISTANCE of it; a frame of another shape is not read at all."""
    image = Image.open(BytesIO(png))
    width, height = image.size
    if not feed.legend or abs(height - mercator_height(width, feed.coordinates)) > SHAPE_TOLERANCE * height:
        return []
    (west, north), _, (east, south), _ = feed.coordinates
    top, span = mercator_y(north), mercator_y(north) - mercator_y(south)
    x0 = max(0, math.floor((box[0] - west) / (east - west) * width))
    x1 = min(width, math.ceil((box[2] - west) / (east - west) * width))
    y0 = max(0, math.floor((top - mercator_y(box[3])) / span * height))
    y1 = min(height, math.ceil((top - mercator_y(box[1])) / span * height))
    if x1 <= x0 or y1 <= y0:
        return []
    degrees = (east - west) / width  # one pixel in longitude; pixels are square in Web Mercator
    km = degrees * 111.32 * math.cos(math.radians((box[1] + box[3]) / 2))
    stride = max(1, round(SAMPLE_KM / km))
    cols, rows = max(1, (x1 - x0) // stride), max(1, (y1 - y0) // stride)
    sample = image.convert("RGBA").crop((x0, y0, x1, y1)).resize((cols, rows), Image.Resampling.NEAREST)
    legend = _legend_colours(feed)
    rates: dict[bytes, float] = {}
    for _, rgba in sample.getcolors(cols * rows) or []:
        if rgba[3] < 16:  # transparent: no echo
            continue
        distance, value = min(((sum((a - b) ** 2 for a, b in zip(colour, rgba, strict=False)), rate)
                               for rate, colour in legend), key=lambda pair: pair[0])
        # a colour far from every legend colour (a line, a label, a border) is not rain of any class
        if distance <= MATCH_DISTANCE and value is not None and value >= min_mm:
            rates[bytes(rgba)] = value
    if not rates:
        return []
    data = sample.tobytes()
    per_x, per_y = (x1 - x0) / cols, (y1 - y0) / rows  # frame pixels per sample
    found = []
    for index in range(cols * rows):
        value = rates.get(data[4 * index:4 * index + 4])
        if value is None:
            continue
        col, row = index % cols, index // cols
        lon = west + (x0 + (col + 0.5) * per_x) * degrees
        lat = math.degrees(2 * math.atan(math.exp(top - (y0 + (row + 0.5) * per_y) / height * span)) - math.pi / 2)
        side = degrees * 111.32 * math.cos(math.radians(lat))
        found.append((lon, lat, per_x * per_y * side * side, value))
    return found


def summary(feed: RadarFeed) -> dict[str, object]:
    return {"frames": len(feed.frames), "latest": feed.frames[-1].time.isoformat() if feed.frames else None}
