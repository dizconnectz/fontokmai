"""Contracts of /data/v1/forecast/: rain.json (rain on a lattice, Open-Meteo) and rivers.json (GloFAS discharge)."""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position

LatticeIndex = Annotated[list[int], Field(min_length=2, max_length=2)]


class ForecastLattice(ContractModel):
    west: float = Field(description="Longitude of column 0")
    south: float = Field(description="Latitude of row 0")
    step: float = Field(gt=0, description=(
        "Spacing in degrees: point [col, row] is at [west + col*step, south + row*step]"))


class RainForecast(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    product: Literal["open_meteo_best_match"] = "open_meteo_best_match"
    name_th: str
    credit_th: str
    source_url: str
    fetched_at: AwareDatetime = Field(description="When fontokmai fetched this forecast")
    lattice: ForecastLattice
    points: list[LatticeIndex] = Field(description="[col, row] of every point with data, sorted by row then column")
    hours: list[AwareDatetime] = Field(description="End of each one-hour rain total (Thai time), oldest first")
    rain: list[list[int | None]] = Field(description=(
        "rain[h][p]: forecast rain in 0.1 mm during the hour that ends at hours[h], at points[p]"))
    days: list[dt.date] = Field(description="Thai calendar days, today first")
    day_rain: list[list[int | None]] = Field(description="day_rain[d][p]: forecast rain of the day in 0.1 mm")
    day_probability: list[list[int | None]] = Field(description=(
        "day_probability[d][p]: highest hourly chance of rain during the day, in %"))
    day_code: list[list[int | None]] = Field(description="day_code[d][p]: WMO weather code of the day")
    notes_th: list[str]

    @model_validator(mode="after")
    def _shapes(self) -> RainForecast:
        width = len(self.points)
        if len(self.rain) != len(self.hours) or any(len(row) != width for row in self.rain):
            raise ValueError("rain must be hours x points")
        for name in ("day_rain", "day_probability", "day_code"):
            table = getattr(self, name)
            if len(table) != len(self.days) or any(len(row) != width for row in table):
                raise ValueError(f"{name} must be days x points")
        return self


Flow = float | None


class RiverPoint(ContractModel):
    id: str = Field(description="Stable id of the point, e.g. cp-bangkok")
    kind: Literal["station", "reach"] = Field(default="station", description=(
        "station = a point chosen by hand, a pin on the map and on the summary's list; reach = a point about every"
        " 50 km between them (added 2026-10-02) that only colours its stretch of ref/river_lines.json"))
    name_th: str = Field(description="Where on which river, e.g. เจ้าพระยา ที่กรุงเทพฯ")
    river_th: str
    location: Position = Field(description=(
        "[lon, lat] asked of the model, chosen once so that its 0.05° GloFAS cell lies on the main stream"))
    discharge: list[Flow] = Field(description=(
        "discharge[d]: river discharge of the model's control run in m³/s on days[d] (model value, not measured)"))
    median: list[Flow] = Field(description="Median of the ensemble forecast in m³/s")
    p25: list[Flow] = Field(description="25th percentile of the ensemble in m³/s")
    p75: list[Flow] = Field(description="75th percentile of the ensemble in m³/s")


class RiverForecast(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    product: Literal["glofas_open_meteo"] = "glofas_open_meteo"
    name_th: str
    credit_th: str
    source_url: str
    fetched_at: AwareDatetime = Field(description="When fontokmai fetched this forecast")
    days: list[dt.date] = Field(description=(
        "Thai calendar days, oldest first: 7 days before the day of the fetch, that day, then 29 more "
        "(the API's forecast_days=30 counts the day of the fetch)"))
    points: list[RiverPoint]
    notes_th: list[str]

    @model_validator(mode="after")
    def _shapes(self) -> RiverForecast:
        width = len(self.days)
        for point in self.points:
            if any(len(getattr(point, name)) != width for name in ("discharge", "median", "p25", "p75")):
                raise ValueError(f"every series of {point.id} must have one value per day")
        return self
