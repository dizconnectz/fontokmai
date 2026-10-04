"""Backup figures of RID's Chao Phraya stations from the page of RID's hydrology centre (user 2026-10-04).

RID's daily report (rid_report.py) is the main source of every station, the same way for all of them. It prints no
figure for C.35 (Ayutthaya), while the hydrology centre's page (hyd-app-db.rid.go.th/SVG/flow_water.html) shows the
flow and level of C.2, C.13, C.3, C.7A and C.35 through the day. That server answers computers in Thailand only
(timeouts from the VPS, resets from abroad, 2026-10-04), so the page is read by the manual Bangkok run (bkk-fetch,
D31) into bkk/rid_hydro.json, copied to the server with the Bangkok files, and used only where the report gives a
station no figure: shown as a backup with its own time, and counted by the canal outlook like a report figure.

The shape of the page was not seen from here: `fontokmai rid-hydro-probe` (on a computer in Thailand) saves the page
and what it loads and prints the texts that look like figures, so that the reader can be checked against the page.
The reader below is written for an SVG whose texts carry the figures: a station's box ("สถานี C.35") with its level
(blue, m) and flow (green, m³/s) printed above it in the same column, and the time in the title.
"""

from __future__ import annotations

import re
import urllib.request
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from fontokmai.contracts.flows import HydroStation, RidFlows, RidHydro

PAGE_URL = "https://hyd-app-db.rid.go.th/SVG/flow_water.html?svg=hydro5_637977164104194493"
PATH = "bkk/rid_hydro.json"
CREDIT_TH = "ศูนย์อุทกวิทยาชลประทานภาคกลาง กรมชลประทาน (ตัวเลขสำรอง)"
NOTES_TH = ["ตัวเลขสำรองจากหน้าสถานการณ์น้ำของศูนย์อุทกวิทยาฯ ใช้เฉพาะสถานีที่รายงานประจำวันของกรมชลฯ ไม่มีตัวเลข"]
ICT = timezone(timedelta(hours=7))
MAX_AGE = timedelta(hours=36)  # a backup older than this says nothing of today's river
SKEW = timedelta(minutes=10)
TIMEOUT_S = 60
LIMIT = 5_000_000
MONTHS_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน",
             "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
_STATION = re.compile(r"สถานี\s*(C\.\d+[A-Z]?)")
_FIGURE = re.compile(r"^-?\d{1,3}(?:,\d{3})*\.\d{2}$")
_TIME = re.compile(r"(\d{1,2})\s+(" + "|".join(MONTHS_TH) + r")\s+(\d{4})\s+เวลา\s*(\d{1,2})[.:](\d{2})")

Getter = Callable[[str], bytes]


def http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "fontokmai/1.0 (+https://dizconnectz.github.io/fontokmai/)"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise OSError(f"{url}: larger than {LIMIT} bytes")
    return data


def _texts(svg: bytes) -> list[tuple[str, float, float]]:
    """Every text of the SVG with its x and y (the first of a text's own or its tspan's coordinates)."""
    root = ET.fromstring(svg)
    out = []
    for node in root.iter():
        if not node.tag.endswith("}text") and node.tag != "text":
            continue
        words = "".join(node.itertext()).strip()
        if not words:
            continue
        x = y = None
        for part in [node, *node.iter()]:
            try:
                x = x if x is not None else float(str(part.get("x", "")).split()[0])
                y = y if y is not None else float(str(part.get("y", "")).split()[0])
            except (ValueError, IndexError):
                continue
        transform = node.get("transform") or ""
        moved = re.search(r"translate\(\s*([-\d.]+)[ ,]+([-\d.]+)", transform)
        if moved:
            x = (x or 0.0) + float(moved.group(1))
            y = (y or 0.0) + float(moved.group(2))
        if x is not None and y is not None:
            out.append((re.sub(r"\s+", " ", words), x, y))
    return out


def parse(svg: bytes, now: datetime, source_url: str = PAGE_URL) -> RidHydro | None:
    """The stations' figures from the SVG, or None when it has no station or no time (another shape of page)."""
    texts = _texts(svg)
    observed = None
    for words, _, _ in texts:
        match = _TIME.search(words)
        if match:
            day, month, year, hour, minute = match.groups()
            observed = datetime(int(year) - 543 if int(year) > 2400 else int(year), MONTHS_TH.index(month) + 1,
                                int(day), int(hour), int(minute), tzinfo=ICT)
            break
    stations = [(m.group(1), x, y) for words, x, y in texts if (m := _STATION.search(words))]
    if observed is None or not stations:
        return None
    figures = [(float(words.replace(",", "")), x, y) for words, x, y in texts if _FIGURE.match(words)]
    found = []
    for code, sx, sy in stations:
        # the column of the station: figures printed above its box, within half the distance to its neighbours
        gaps = [abs(sx - ox) for _, ox, _ in stations if ox != sx]
        reach = min(gaps) / 2 if gaps else 100.0
        above = sorted((y, value) for value, x, y in figures if abs(x - sx) <= reach and y < sy)
        level = above[0][1] if len(above) >= 2 else None
        flow = above[1][1] if len(above) >= 2 else None
        found.append(HydroStation(code=code, flow_cms=flow if flow is not None and flow >= 0 else None,
                                  level_m=level))
    return RidHydro(fetched_at=now, observed_at=observed, source_url=source_url, credit_th=CREDIT_TH,
                    stations=found, notes_th=NOTES_TH)


def _svg_urls(html: str, base: str) -> list[str]:
    from urllib.parse import urljoin
    found = re.findall(r"""(?:src|data|href)\s*=\s*["']([^"']+\.svg[^"']*)["']""", html, re.IGNORECASE)
    return [urljoin(base, url) for url in dict.fromkeys(found)]


def collect(now: datetime, get: Getter = http_get, url: str = PAGE_URL) -> RidHydro | None:
    """The page, or the SVG it loads, read into backup figures; None when neither has the shape expected."""
    page = get(url)
    if b"<svg" in page[:200_000]:
        start = page.index(b"<svg")
        end = page.rfind(b"</svg>")
        result = parse(page[start:end + 6], now, url) if end > start else None
        if result is not None:
            return result
    for svg_url in _svg_urls(page.decode("utf-8", "replace"), url):
        result = parse(get(svg_url), now, url)
        if result is not None:
            return result
    return None


def probe(out: Path, get: Getter = http_get, url: str = PAGE_URL) -> list[str]:
    """Save the page and the files it names into `out`, and say what they hold, to check the reader against them."""
    from urllib.parse import urljoin
    out.mkdir(parents=True, exist_ok=True)
    page = get(url)
    (out / "page.html").write_bytes(page)
    html = page.decode("utf-8", "replace")
    lines = [f"page: {len(page)} bytes, inline svg: {b'<svg' in page}"]
    named = re.findall(r"""(?:src|data|href)\s*=\s*["']([^"']+)["']""", html, re.IGNORECASE)
    named += re.findall(r"""["']([^"'\s]+\.(?:svg|json|ashx|aspx|php)(?:\?[^"'\s]*)?)["']""", html)
    for n, link in enumerate(dict.fromkeys(named)):
        lines.append(f"names: {link}")
        if re.search(r"\.(svg|json|ashx|aspx|php|js)(\?|$)", link) and n < 30:
            try:
                data = get(urljoin(url, link))
            except OSError as exc:
                lines.append(f"  could not read: {exc}")
                continue
            name = re.sub(r"[^A-Za-z0-9._-]", "_", link.rsplit("/", 1)[-1])[:80] or f"file{n}"
            (out / name).write_bytes(data)
            lines.append(f"  saved {name}: {len(data)} bytes")
            for words in re.findall(r"(สถานี\s*C\.\d+[A-Z]?|\d{1,3}(?:,\d{3})*\.\d{2}|เวลา\s*\d{1,2}[.:]\d{2})",
                                    data.decode("utf-8", "replace"))[:40]:
                lines.append(f"    {words}")
    try:
        result = collect(datetime.now(ICT), get, url)
    except Exception as exc:  # noqa: BLE001 - a probe says what went wrong
        result = None
        lines.append(f"reader: {type(exc).__name__}: {exc}")
    lines.append("reader: " + ("; ".join(f"{s.code} flow {s.flow_cms} level {s.level_m}" for s in result.stations)
                               + f" at {result.observed_at}" if result else "found nothing it knows"))
    return lines


def with_backup(flows: RidFlows, backup: RidHydro | None, now: datetime) -> RidFlows:
    """The report's figures, with the backup's where the report has none for a station, while the backup is recent."""
    if backup is None or not (now - MAX_AGE <= backup.observed_at <= now + SKEW):
        return flows
    by_code = {station.code: station for station in backup.stations}
    points, used = [], False
    for point in flows.points:
        spare = by_code.get(point.code or "")
        if point.flow_cms is None and spare is not None and spare.flow_cms is not None:
            point = point.model_copy(update={"flow_cms": spare.flow_cms, "flow_backup_at": backup.observed_at,
                                             "level_m": point.level_m if point.level_m is not None else spare.level_m})
            used = True
        points.append(point)
    return flows.model_copy(update={"points": points, "backup_url": backup.source_url}) if used else flows
