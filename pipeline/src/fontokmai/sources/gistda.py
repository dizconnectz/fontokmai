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
import math
import re
import time
import urllib.request
from collections import defaultdict
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import urlencode

from fontokmai.contracts.satellite import (
    FloodFrequency,
    FloodFrequencyArea,
    SatelliteDistrict,
    SatelliteFloods,
)
from fontokmai.downstream import places
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources.open_data.http import TIMEOUT_S, OpenDataError
from fontokmai.sources.tmd_cap.fetch import USER_AGENT, make_ssl_context
from fontokmai.state import StateStore

API_BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/features"
API_URL = f"{API_BASE}/flood/3days"
FREQ_URL = f"{API_BASE}/flood-freq"
FREQ_PATH = "ref/flood_freq.json"
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
        if not url.startswith(API_BASE + "/"):
            raise OpenDataError(f"{url}: not GISTDA's features API")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "API-Key": key})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=make_ssl_context()) as response:
                yield response
        except OSError as exc:
            raise OpenDataError(f"{url}: {type(exc).__name__}: {getattr(exc, 'code', '') or getattr(exc, 'reason', '')}"
                                ) from None

    return opener


def _page(opener: Opener, offset: int, limit: int, base: str = API_URL,
          query: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{base}?{urlencode({**(query or {}), 'limit': limit, 'offset': offset})}"
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
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value) or value < 0:
        return None
    return float(value)


def summarize(features: Iterator[dict[str, Any]], now: datetime) -> SatelliteFloods:
    """The sums by district of every feature, and the scenes they were seen on."""
    area: dict[str, float] = defaultdict(float)
    cells: dict[str, set[str]] = defaultdict(set)
    people: dict[str, dict[str, float]] = defaultdict(dict)
    buildings: dict[str, dict[str, float]] = defaultdict(dict)
    unknown_people: set[str] = set()
    unknown_buildings: set[str] = set()
    scenes: set[str] = set()
    known = {code: place.label for code, place in places().items() if place.kind == "district"}
    for feature in features:
        props = feature.get("properties") or {}
        code, size = props.get("ap_idn"), _number(props.get("f_area"))
        if isinstance(code, bool) or not isinstance(code, int) or not 1000 <= code <= 9999 or size is None:
            continue  # a feature without a district or an area cannot be summed; it is never guessed
        key = f"{code:04d}"
        if key not in known:
            continue  # a code that is no DOPA district of ours cannot be placed
        area[key] += size
        h3 = props.get("h3_address")
        cells[key].add(str(h3 or props.get("_id") or id(feature)))
        # GISTDA can return multiple flooded polygons from one H3 cell. Area belongs to each polygon; the cell's
        # population/building estimates belong to the cell, so add each estimate once and reject conflicts.
        for field, samples, unknown in (("population", people, unknown_people),
                                        ("building", buildings, unknown_buildings)):
            value = _number(props.get(field))
            if not isinstance(h3, str) or not h3 or value is None:
                unknown.add(key)
                continue
            previous = samples[key].get(h3)
            if previous is not None and not math.isclose(previous, value, rel_tol=0, abs_tol=1e-9):
                unknown.add(key)
            else:
                samples[key][h3] = value
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
    districts = [SatelliteDistrict(
        code=code, name_th=known[code], area_km2=round(area[code] / 1e6, 3), cells=len(cells[code]),
        population=None if code in unknown_people else round(sum(people[code].values())),
        buildings=None if code in unknown_buildings else round(sum(buildings[code].values())),
    )
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


FREQ_NAME_TH = "พื้นที่น้ำท่วมซ้ำซาก (สถิติจากภาพดาวเทียม)"
FREQ_NOTES_TH = [
    "สถิติพื้นที่ที่ GISTDA เคยแปลว่าน้ำท่วมจากภาพดาวเทียมในอดีต นับว่าท่วมกี่ครั้ง ไม่ใช่การพยากรณ์",
    "พื้นที่ที่ไม่มีในรายการอาจไม่เคยมีภาพตอนท่วม ไม่ได้แปลว่าไม่เคยท่วม",
]
FREQ_PROVINCES = ("10", "11", "12", "13", "14")  # the pilot (D15): Bangkok and the provinces around it
FREQ_PAUSE_S = 0.5  # between pages: the whole country is about 7,900 pages, read once, gently
FREQ_MAX_PAGES = 3000  # of one province
FREQ_TRIES = 4  # a page the server drops or times out on is asked again after 5, 15 and 45 seconds


def all_provinces() -> tuple[str, ...]:
    """Every DOPA province code of ref_data/places.json."""
    return tuple(sorted(code for code, place in places().items() if place.kind == "province"))


def _freq_page(opener: Opener, offset: int, page: int, query: dict[str, Any],
               sleep: Callable[[float], None]) -> dict[str, Any]:
    for attempt in range(FREQ_TRIES):
        try:
            return _page(opener, offset, page, FREQ_URL, query)
        except OpenDataError:
            if attempt == FREQ_TRIES - 1:
                raise
            sleep(5 * 3**attempt)
    raise AssertionError("unreachable")


def _freq_province(opener: Opener, province: str, known: dict[str, str], page: int, pause: float,
                   sleep: Callable[[float], None]) -> tuple[dict[str, dict[int, float]], str, int]:
    """The sums of one province by subdistrict, the newest _createdAt and how many features were read."""
    query = {"pv_idn": int(province)}
    area: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    created = ""
    current = _freq_page(opener, 0, page, query, sleep)
    matched, offset, seen = current["numberMatched"], 0, 0
    if matched > FREQ_MAX_PAGES * page:
        raise OpenDataError(f"GISTDA flood-freq of {province} has {matched} features, more than {FREQ_MAX_PAGES} pages")
    while True:
        if current["numberMatched"] != matched:
            raise OpenDataError(f"GISTDA flood-freq of {province} changed while it was read")
        batch = [f for f in current["features"] if isinstance(f, dict)]
        seen += len(batch)
        for feature in batch:
            props = feature.get("properties") or {}
            code = f"{props.get('pv_code', '')}{props.get('ap_code', '')}{props.get('tb_code', '')}"
            freq, rai = props.get("freq"), _number(props.get("area_rai"))
            if (code not in known or isinstance(freq, bool) or not isinstance(freq, int) or not 1 <= freq <= 100
                    or rai is None):
                continue  # a piece without a subdistrict of ours, a count or an area is never guessed
            area[code][freq] += rai
            created = max(created, str(props.get("_createdAt") or ""))
        offset += page
        if offset >= matched or not batch:
            break
        if pause:
            sleep(pause)
        current = _freq_page(opener, offset, page, query, sleep)
    if seen != matched:
        raise OpenDataError(f"GISTDA flood-freq of {province} gave {seen} of {matched} features")
    return area, created, matched


def _freq_areas(area: dict[str, dict[int, float]], known: dict[str, str]) -> list[FloodFrequencyArea]:
    out = []
    for code in sorted(area):
        top = max(area[code])
        out.append(FloodFrequencyArea(
            code=code, name_th=known[code], area_rai=round(sum(area[code].values()), 1), max_freq=top,
            rai_by_freq=[round(area[code].get(k, 0.0), 1) for k in range(1, top + 1)]))
    return out


def _freq_file(subdistricts: list[FloodFrequencyArea], provinces: list[str], created: str,
               now: datetime) -> FloodFrequency:
    try:
        data_created = date.fromisoformat(created[:10]) if created else None
    except ValueError:
        data_created = None
    return FloodFrequency(name_th=FREQ_NAME_TH, credit_th=CREDIT_TH, source_url=PAGE_URL, built_at=now,
                          data_created=data_created, provinces=sorted(provinces),
                          subdistricts=sorted(subdistricts, key=lambda s: s.code), notes_th=FREQ_NOTES_TH)


def collect_freq(opener: Opener, now: datetime, provinces: tuple[str, ...] = FREQ_PROVINCES, *,
                 page: int | None = None, pause: float = 0.0,
                 sleep: Callable[[float], None] = time.sleep) -> FloodFrequency:
    """GISTDA's recurrent flooding of the provinces, summed by subdistrict: a statistic, read by hand once."""
    known = {code: place.label for code, place in places().items() if place.kind == "subdistrict"}
    subdistricts: list[FloodFrequencyArea] = []
    created = ""
    for province in provinces:
        area, made, _ = _freq_province(opener, province, known, page or PAGE, pause, sleep)
        subdistricts += _freq_areas(area, known)
        created = max(created, made)
    return _freq_file(subdistricts, list(provinces), created, now)


def build_freq(out_dir: Path, now: datetime, key_path: Path, provinces: tuple[str, ...] = FREQ_PROVINCES, *,
               opener_for: Callable[[str], Opener] = keyed_opener, pause: float = FREQ_PAUSE_S,
               again: bool = False, sleep: Callable[[float], None] = time.sleep,
               log: Callable[[str], None] = print) -> FloodFrequency:
    """The hand-run command: read the provinces one at a time into out_dir/ref/flood_freq.json (the rounds publish
    it). The file is written after each province, so a run that stops resumes where it stopped: a province already
    in the file is skipped unless `again`."""
    key = load_key(key_path)
    if key is None:
        raise OpenDataError("no GISTDA key in the key file")
    opener = opener_for(key)
    del key
    known = {code: place.label for code, place in places().items() if place.kind == "subdistrict"}
    path = out_dir / FREQ_PATH
    try:
        current = FloodFrequency.model_validate_json(path.read_bytes())
    except (OSError, ValueError):
        current = None
    subdistricts = list(current.subdistricts) if current else []
    done = list(current.provinces) if current else []
    created = current.data_created.isoformat() if current and current.data_created else ""
    freq = current
    for n, province in enumerate(provinces, 1):
        if province in done and not again:
            log(f"{n}/{len(provinces)} {province}: in the file already")
            continue
        area, made, matched = _freq_province(opener, province, known, PAGE, pause, sleep)
        subdistricts = [s for s in subdistricts if s.code[:2] != province] + _freq_areas(area, known)
        done = sorted(set(done) | {province})
        created = max(created, made)
        freq = _freq_file(subdistricts, done, created, now)
        atomic_write(path, freq.model_dump_json().encode("utf-8"))
        log(f"{n}/{len(provinces)} {province}: {len(area)} subdistricts from {matched} features")
    if freq is None:
        freq = _freq_file([], [], "", now)
    return freq
