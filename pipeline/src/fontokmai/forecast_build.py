"""Build forecast/rain.json for the map timeline and the 7-day pin card (Open-Meteo, contract section 12)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from importlib import resources
from pathlib import Path

from pydantic import ValidationError

from fontokmai.contracts.forecast import ForecastLattice, RainForecast
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources import open_meteo
from fontokmai.sources.call_budget import CallBudget
from fontokmai.sources.open_data.http import Opener, open_url
from fontokmai.state import StateStore

FORECAST_PATH = "forecast/rain.json"
MAX_AGE = timedelta(hours=6)
RETRY = timedelta(hours=2)
# of the 10,000 calls a day the free service allows, leaving room for manual runs; a normal day is 4 x 924
DAILY_CALLS = 8_000
CALLS_KEY = "open_meteo_calls"
ATTEMPT_KEY = "open_meteo_last_attempt"


def default_lattice() -> tuple[ForecastLattice, list[list[int]]]:
    gazetteer = PlaceGazetteer.model_validate_json(
        resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes())
    return open_meteo.thailand_lattice(gazetteer)


def build_rain_forecast(out_dir: Path, now: datetime, *, opener: Opener = open_url,
                        lattice: tuple[ForecastLattice, list[list[int]]] | None = None,
                        pause: float = open_meteo.PAUSE_S,
                        spend: Callable[[int], None] | None = None) -> RainForecast:
    """Fetch the whole lattice, then replace out_dir/forecast/rain.json atomically (nothing older is kept)."""
    grid, points = lattice or default_lattice()
    forecast = open_meteo.collect(now, grid, points, opener=opener, pause=pause, spend=spend)
    atomic_write(out_dir / FORECAST_PATH, forecast.model_dump_json().encode("utf-8"))
    return forecast


def is_fresh(out_dir: Path, now: datetime, max_age: timedelta = MAX_AGE) -> bool:
    try:
        fetched = RainForecast.model_validate_json((out_dir / FORECAST_PATH).read_bytes()).fetched_at
    except (OSError, ValidationError):
        return False
    return now - fetched < max_age


def budget(store: StateStore, limit: int = DAILY_CALLS) -> CallBudget:
    return CallBudget(store, CALLS_KEY, limit)


def refresh_rain_forecast(out_dir: Path, db: Path, now: datetime, *, opener: Opener = open_url,
                          lattice: tuple[ForecastLattice, list[list[int]]] | None = None,
                          pause: float = open_meteo.PAUSE_S, limit: int = DAILY_CALLS) -> str | None:
    """The scheduled refresh: a line for the round log, or None when the forecast is still fresh.

    The last attempt and a rolling 24-hour call count live in the state database, so neither a retry after
    a failure nor a restart of the service can take more than `limit` calls a day.
    """
    if is_fresh(out_dir, now):
        return None
    grid, points = lattice or default_lattice()
    with StateStore(db) as store:
        last = store.get_meta(ATTEMPT_KEY)
        if last and now - datetime.fromisoformat(last) < RETRY:
            return "waiting to retry"
        calls = budget(store, limit)
        if not calls.allows(now, len(points)):
            return f"waiting for the Open-Meteo budget: {calls.used(now)} of {limit} calls used in 24 hours"
        store.set_meta(ATTEMPT_KEY, now.isoformat())
        try:
            forecast = build_rain_forecast(out_dir, now, opener=opener, lattice=(grid, points), pause=pause,
                                           spend=lambda n: calls.spend(now, n))
        except Exception as exc:  # noqa: BLE001 - reported in the round log, the job goes on
            return f"error: {type(exc).__name__}: {exc}"[:300]
    return f"built {len(forecast.points)} points x {len(forecast.hours)} hours"
