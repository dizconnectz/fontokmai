"""Build forecast/rain.json for the map timeline and the 7-day pin card (Open-Meteo, contract section 12)."""

from __future__ import annotations

from datetime import datetime, timedelta
from importlib import resources
from pathlib import Path

from pydantic import ValidationError

from fontokmai.contracts.forecast import ForecastLattice, RainForecast
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources import open_meteo
from fontokmai.sources.open_data.http import Opener, open_url

FORECAST_PATH = "forecast/rain.json"
MAX_AGE = timedelta(hours=6)


def default_lattice() -> tuple[ForecastLattice, list[list[int]]]:
    gazetteer = PlaceGazetteer.model_validate_json(
        resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes())
    return open_meteo.thailand_lattice(gazetteer)


def build_rain_forecast(out_dir: Path, now: datetime, *, opener: Opener = open_url,
                        lattice: tuple[ForecastLattice, list[list[int]]] | None = None,
                        pause: float = open_meteo.PAUSE_S) -> RainForecast:
    """Fetch the whole lattice, then replace out_dir/forecast/rain.json atomically (nothing older is kept)."""
    grid, points = lattice or default_lattice()
    forecast = open_meteo.collect(now, grid, points, opener=opener, pause=pause)
    atomic_write(out_dir / FORECAST_PATH, forecast.model_dump_json().encode("utf-8"))
    return forecast


def is_fresh(out_dir: Path, now: datetime, max_age: timedelta = MAX_AGE) -> bool:
    try:
        fetched = RainForecast.model_validate_json((out_dir / FORECAST_PATH).read_bytes()).fetched_at
    except (OSError, ValidationError):
        return False
    return now - fetched < max_age
