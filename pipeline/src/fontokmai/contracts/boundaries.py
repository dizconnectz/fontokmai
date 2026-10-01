"""Contract of /data/v1/ref/boundaries.json: outlines of provinces and districts, simplified for drawing on the map."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, GeoMultiPolygon


class AreaOutline(ContractModel):
    code: str = Field(description=(
        "DOPA code as in ref/places.json: 2 digits = province, 4 = district (the เขต of Bangkok included)"))
    outline: GeoMultiPolygon = Field(description=(
        "[lon, lat] in WGS84: polygons of an outer ring and its holes. Simplified (see geometry_version), so a point"
        " near the line may fall on the wrong side: draw it, do not test with it"))


class Boundaries(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    geometry_version: str = Field(description="Source release and how far it was simplified")
    updated: dt.date = Field(description="Date of the source data")
    credit_th: str
    license: str
    source_url: str
    areas: list[AreaOutline] = Field(description="Provinces, then districts, each sorted by code")
    notes_th: list[str]
