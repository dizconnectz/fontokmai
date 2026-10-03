"""Refresh the pilot only after the existing jobs; failures leave the old, honestly dated file in place."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from pydantic import ValidationError

from fontokmai.contracts.outlook import RainOutlook
from fontokmai.forecast_build import budget
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources import ensemble
from fontokmai.sources.open_data.http import Opener, open_url
from fontokmai.state import StateStore

PATH = "forecast/outlook.json"
KEY = "ensemble_last_attempt"
MAX_AGE = timedelta(hours=12)
RETRY = timedelta(hours=3)


def refresh(out: Path, db: Path, now: datetime, *, opener: Opener = open_url, pause: float = ensemble.PACE,
            points: list | None = None) -> str | None:
    try:
        old = RainOutlook.model_validate_json((out / PATH).read_bytes())
        if timedelta(0) <= now - old.fetched_at < MAX_AGE:
            return None
    except (OSError, ValidationError):
        pass
    points = points if points is not None else ensemble.load_points()
    with StateStore(db) as store:
        last = store.get_meta(KEY)
        if last and now - datetime.fromisoformat(last) < RETRY:
            return "waiting to retry the pilot ensemble"
        calls = budget(store)
        if not calls.allows(now, ensemble.calls(len(points))):
            return "waiting for the shared Open-Meteo call budget"
        store.set_meta(KEY, now.isoformat())
        try:
            result = ensemble.collect(now, points=points, opener=opener, pause=pause,
                                      spend=lambda n: calls.spend(now, n))
            atomic_write(out / PATH, result.model_dump_json().encode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - the pilot must not fail the live-data round
            return f"error: {type(exc).__name__}: {exc}"[:300]
    missing = sum(len(p.missing_models) for p in result.points)
    return f"built {len(result.points)} pilot points x 14 days; {missing} point-models missing"
