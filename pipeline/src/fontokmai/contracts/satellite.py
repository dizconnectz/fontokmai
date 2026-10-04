"""Contract of /data/v1/floods/satellite.json: flooded area seen from satellites by GISTDA, summed by district."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel


class SatelliteDistrict(ContractModel):
    code: str = Field(pattern=r"^\d{4}$", description="DOPA district code, as in ref/places.json")
    name_th: str = Field(description="The district and province, e.g. อ.คีรีมาศ จ.สุโขทัย (ref/places.json label)")
    area_km2: float = Field(ge=0, description="Water GISTDA mapped as flood in the district, km²")
    cells: int = Field(ge=1, description="H3 cells (resolution 9, about 0.1 km² each) with flood water")
    population: int | None = Field(description="People GISTDA estimates live in the flooded cells")
    buildings: int | None = Field(description="Buildings in the flooded cells, by GISTDA")


class SatelliteFloods(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    product: Literal["gistda_flood_3days"] = "gistda_flood_3days"
    name_th: str
    credit_th: str
    source_url: str = Field(description="GISTDA's disaster platform, to link to (never an API address)")
    fetched_at: AwareDatetime = Field(description="When fontokmai fetched the layer")
    window_days: int = Field(description="GISTDA's window: flood seen in any scene of the last this many days")
    scenes: list[str] = Field(description="The satellite scenes GISTDA names, e.g. S1D_20261002_0609, newest first")
    latest_scene_day: dt.date | None = Field(description="Day of the newest scene (Thai calendar as GISTDA names it)")
    total_km2: float = Field(ge=0)
    districts: list[SatelliteDistrict] = Field(description="Districts with flood water, the largest area first")
    notes_th: list[str]
