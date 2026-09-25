"""Build and refresh /data/v1/ref/road_flood_history.json from open data (weekly on the VPS)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path

from pydantic import ValidationError

from fontokmai.contracts.road_flood import RoadFloodHistory
from fontokmai.feeds.road_flood import build_history
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources.open_data import bma_road_flood, itic_events
from fontokmai.sources.open_data.http import Opener, open_url

REF_PATH = "ref/road_flood_history.json"
MAX_AGE = timedelta(days=7)
AREA_TH = "กรุงเทพมหานครและปริมณฑล"
BBOX = (100.20, 13.45, 100.95, 14.30)  # lon_min, lat_min, lon_max, lat_max


def build_road_flood_history(out_dir: Path, cache_dir: Path, now: datetime, *, opener: Opener = open_url,
                             backfill: bool = True, first_year: int = itic_events.FIRST_YEAR) -> RoadFloodHistory:
    """Read both sources, then replace out_dir/ref/road_flood_history.json atomically.

    With backfill=False (the scheduled refresh) a missing cache of a finished iTIC year stops the build before any
    download, so the 15-minute job never pulls the whole archive.
    """
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    if not backfill and itic_events.missing_years(cache_dir, now, BBOX, first_year):
        raise itic_events.BackfillNeeded("run `fontokmai road-flood-history` once to fill the iTIC cache")
    reads = [
        bma_road_flood.collect(opener, now),
        itic_events.collect(opener, now, cache_dir, BBOX, first_year=first_year, backfill=backfill),
    ]
    history = build_history(reads, built_at=now, bbox=BBOX, area_th=AREA_TH)
    atomic_write(out_dir / REF_PATH, history.model_dump_json().encode("utf-8"))
    return history


def fixture_files(directory: Path) -> dict[str, Path]:
    """URL → local file for pipeline/tests/fixtures/road_flood (tests and contract examples)."""
    package = directory / "bma_package.json"
    files = {bma_road_flood.PACKAGE_API: package}
    for resource in json.loads(package.read_text(encoding="utf-8"))["result"]["resources"]:
        match = re.search(r"\((\d{4})\)", resource["name"])
        files[resource["url"]] = directory / (f"bma_{match.group(1)}.csv" if match else "bma_legacy.csv")
    for path in directory.glob("itic_*.csv"):
        files[itic_events.FEED_URL.format(year=int(path.stem.split("_")[1]))] = path
    return files


def is_fresh(out_dir: Path, now: datetime, max_age: timedelta = MAX_AGE) -> bool:
    try:
        built = RoadFloodHistory.model_validate_json((out_dir / REF_PATH).read_bytes()).built_at
    except (OSError, ValidationError):
        return False
    return now - built < max_age
