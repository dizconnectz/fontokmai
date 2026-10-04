"""Flooded area seen from satellites, by GISTDA's disaster platform (user 2026-10-04, key of the user's account).

GISTDA maps flood water on radar scenes (Sentinel-1 and others) and serves it as open government data through its API
gateway: GeoJSON of OGC API Features, one feature per piece of water inside an H3 cell (resolution 9, about 0.1 km²),
each with its DOPA district (ap_idn), its area in m² (f_area), the people and buildings GISTDA counts in the cell
and the scenes it was seen on (file_name). The window of 3 days had about 83,000 features (some 280 MB with their
shapes) on 2026-10-04, and the API keeps the shapes in every answer, so the server reads it a page at a time, keeps
only the sums by district and never writes the pages to disk.

The key: a file mounted at /run/secrets/gistda_key (deploy/vps, outside the repository), sent only as the API-Key
header. It never goes into a URL, a log line, an error or a published file, and nothing the API answers is linked
from the site (its own links carry an api_key parameter).
"""

from __future__ import annotations

import json
import re
import urllib.request
from collections import defaultdict
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import urlencode

from fontokmai.contracts.satellite import SatelliteDistrict, SatelliteFloods
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources.open_data.http import TIMEOUT_S, OpenDataError
from fontokmai.sources.tmd_cap.fetch import USER_AGENT, make_ssl_context
from fontokmai.state import StateStore

API_URL = "https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/3days"
PAGE_URL = "https://disaster.gistda.or.th/"
PATH = "floods/satellite.json"
WINDOW_DAYS = 3
PAGE = 1000  # tried on 2026-10-04: about 3.3 MB a page, answered in a second
MAX_PAGES = 300  # 300,000 features: far above a big flood season, and a bound on the work of one refresh
PAGE_LIMIT = 30_000_000  # bytes of one page
REFRESH = timedelta(hours=3)  # GISTDA adds scenes about once or twice a day: a first small page says if anything moved
MAX_AGE = timedelta(hours=36)  # the web marks the layer old after this
ATTEMPT_KEY = "gistda.last_attempt"
SIGNATURE_KEY = "gistda.signature"
NAME_TH = "พื้นที่น้ำท่วมจากภาพดาวเทียม (ในรอบ 3 วัน)"
CREDIT_TH = "สำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (GISTDA) ข้อมูลเปิดภาครัฐ"
NOTES_TH = [
    "พื้นที่น้ำท่วมที่ GISTDA แปลจากภาพดาวเทียมเรดาร์ในรอบ 3 วัน ไม่ใช่ระดับน้ำ และไม่ใช่การพยากรณ์",
    "ดาวเทียมผ่านแต่ละพื้นที่ไม่ทุกวัน พื้นที่ที่ไม่มีภาพในรอบนี้จะไม่ปรากฏ ไม่ได้แปลว่าไม่ท่วม",
    "จำนวนประชากรและอาคารเป็นค่าประมาณของ GISTDA ในช่องพื้นที่ที่มีน้ำ",
]
_SCENE = re.compile(r"^[A-Za-z0-9]+_(\d{8})_(\d{4})$")

Opener = Callable[[str], AbstractContextManager[BinaryIO]]


def load_key(path: Path | None) -> str | None:
    """The key from its file, or None without one (the refresh is then skipped)."""
    if path is None or not path.is_file():
        return None
    key = "".join(path.read_text(encoding="utf-8").split())
    return key or None


def keyed_opener(key: str) -> Opener:
    """HTTPS reads with the key in the API-Key header; an error names the URL, never the key."""

    @contextmanager
    def opener(url: str) -> Iterator[BinaryIO]:
        if not url.startswith(API_URL):
            raise OpenDataError(f"{url}: not GISTDA's flood API")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "API-Key": key})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=make_ssl_context()) as response:
                yield response
        except OSError as exc:
            raise OpenDataError(f"{url}: {type(exc).__name__}: {getattr(exc, 'code', '') or getattr(exc, 'reason', '')}"
                                ) from None

    return opener


def _page(opener: Opener, offset: int, limit: int) -> dict[str, Any]:
    url = f"{API_URL}?{urlencode({'limit': limit, 'offset': offset})}"
    with opener(url) as fh:
        data = fh.read(PAGE_LIMIT + 1)
    if len(data) > PAGE_LIMIT:
        raise OpenDataError(f"{url}: larger than {PAGE_LIMIT} bytes")
    try:
        page = json.loads(data)
    except ValueError as exc:
        raise OpenDataError(f"{url}: not JSON") from exc
    if not isinstance(page, dict) or page.get("type") != "FeatureCollection" or not isinstance(
            page.get("features"), list) or not isinstance(page.get("numberMatched"), int):
        raise OpenDataError(f"{url}: not a feature collection with numberMatched")
    return page


def signature(opener: Opener) -> str:
    """What says whether the layer changed: how many features, and when the first one was made."""
    page = _page(opener, 0, 1)
    first = (page["features"][0].get("properties") or {}) if page["features"] else {}
    return f"{page['numberMatched']}|{first.get('_createdAt', '')}"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value != value or value < 0:
        return None
    return float(value)


def summarize(features: Iterator[dict[str, Any]], now: datetime) -> SatelliteFloods:
    """The sums by district of every feature, and the scenes they were seen on."""
    area: dict[str, float] = defaultdict(float)
    cells: dict[str, set[str]] = defaultdict(set)
    people: dict[str, float] = defaultdict(float)
    buildings: dict[str, float] = defaultdict(float)
    scenes: set[str] = set()
    for feature in features:
        props = feature.get("properties") or {}
        code, size = props.get("ap_idn"), _number(props.get("f_area"))
        if isinstance(code, bool) or not isinstance(code, int) or not 1000 <= code <= 9999 or size is None:
            continue  # a feature without a district or an area cannot be summed; it is never guessed
        key = f"{code:04d}"
        area[key] += size
        cells[key].add(str(props.get("h3_address") or props.get("_id") or id(feature)))
        people[key] += _number(props.get("population")) or 0.0
        buildings[key] += _number(props.get("building")) or 0.0
        for name in str(props.get("file_name") or "").split(","):
            if _SCENE.match(name.strip()):
                scenes.add(name.strip())
    ordered = sorted(scenes, key=lambda name: _SCENE.match(name).groups(), reverse=True)  # type: ignore[union-attr]
    latest = None
    if ordered:
        day = _SCENE.match(ordered[0]).group(1)  # type: ignore[union-attr]
        try:
            latest = date(int(day[:4]), int(day[4:6]), int(day[6:]))
        except ValueError:
            latest = None
    districts = [SatelliteDistrict(code=code, area_km2=round(area[code] / 1e6, 3), cells=len(cells[code]),
                                   population=round(people[code]), buildings=round(buildings[code]))
                 for code in sorted(area, key=lambda c: -area[c])]
    return SatelliteFloods(name_th=NAME_TH, credit_th=CREDIT_TH, source_url=PAGE_URL, fetched_at=now,
                           window_days=WINDOW_DAYS, scenes=ordered, latest_scene_day=latest,
                           total_km2=round(sum(area.values()) / 1e6, 3), districts=districts, notes_th=NOTES_TH)


def collect(opener: Opener, now: datetime, *, page: int | None = None) -> SatelliteFloods:
    """Every page of the window, summed as it comes; the count must hold from the first page to the last."""
    page = page or PAGE
    first = _page(opener, 0, page)
    matched = first["numberMatched"]
    if matched > MAX_PAGES * page:
        raise OpenDataError(f"GISTDA flood layer has {matched} features, more than {MAX_PAGES} pages")

    def features() -> Iterator[dict[str, Any]]:
        seen = 0
        current = first
        offset = 0
        while True:
            if current["numberMatched"] != matched:
                raise OpenDataError("GISTDA flood layer changed while it was read")
            batch = [f for f in current["features"] if isinstance(f, dict)]
            seen += len(batch)
            yield from batch
            offset += page
            if offset >= matched or not batch:
                break
            current = _page(opener, offset, page)
        if seen != matched:
            raise OpenDataError(f"GISTDA flood layer gave {seen} of {matched} features")

    return summarize(features(), now)


def refresh(out_dir: Path, db: Path, now: datetime, key_path: Path | None, *,
            opener_for: Callable[[str], Opener] = keyed_opener) -> str | None:
    """Every REFRESH: a small first page, and the whole layer only when it changed. A line for the round log, or None
    when there is no key or it is not time yet; the last good file stays on any failure."""
    key = load_key(key_path)
    if key is None:
        return None
    with StateStore(db) as store:
        last = store.get_meta(ATTEMPT_KEY)
        if last and now - datetime.fromisoformat(last) < REFRESH:
            return None
        store.set_meta(ATTEMPT_KEY, now.isoformat())
        known = store.get_meta(SIGNATURE_KEY)
    opener = opener_for(key)
    del key
    path = out_dir / PATH
    try:
        mark = signature(opener)
        if mark == known:
            try:
                current = SatelliteFloods.model_validate_json(path.read_bytes())
            except (OSError, ValueError):
                current = None
            if current is not None:  # checked now: the layer is current, though nothing in it moved
                atomic_write(path, current.model_copy(update={"fetched_at": now}).model_dump_json().encode("utf-8"))
                return "unchanged"
        floods = collect(opener, now)
    except Exception as exc:  # noqa: BLE001 - reported in the round log; the last good file stays
        return f"error: {type(exc).__name__}: {exc}"[:300]
    atomic_write(path, floods.model_dump_json().encode("utf-8"))
    with StateStore(db) as store:
        store.set_meta(SIGNATURE_KEY, mark)
    return f"built {len(floods.districts)} districts, {floods.total_km2:.1f} km² (scene {floods.latest_scene_day})"
