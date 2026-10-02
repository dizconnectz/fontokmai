"""Contract of /data/v1/ref/river_lines.json: the main rivers cut into stretches, each nearest to one GloFAS point."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, GeoMultiLineString


class RiverStretch(ContractModel):
    point_id: str = Field(description=(
        "id of the point of forecast/rivers.json nearest to this stretch on the same river: the web colours the"
        " stretch by that point's 7-day trend"))
    river_th: str = Field(description="e.g. แม่น้ำเจ้าพระยา")
    line: GeoMultiLineString = Field(description="[lon, lat] in WGS84, simplified for drawing")


class RiverLines(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    geometry_version: str = Field(description="Source extract and how far it was simplified")
    updated: dt.date = Field(description="Date of the OpenStreetMap extract")
    credit_th: str
    license: str
    source_url: str
    stretches: list[RiverStretch] = Field(description="By river, then by point id")
    notes_th: list[str]
