"""Contract of /data/v1/ref/places.json: provinces, districts and subdistricts with one point each, for place search."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position


class Place(ContractModel):
    kind: Literal["province", "district", "subdistrict"]
    code: str = Field(description="DOPA code: 2 digits = province, 4 = district, 6 = subdistrict; parents are prefixes")
    name: str = Field(description="Bare name without ต./อ./จ./แขวง/เขต, e.g. คลองหนึ่ง")
    label: str = Field(description="Full Thai label, e.g. ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี or แขวง…/เขต… กรุงเทพมหานคร")
    location: Position = Field(description=(
        "[lon, lat]; subdistrict = DOPA reference point (mean when DOPA lists several), district and province = mean"
        " of their subdistrict points. A point to zoom to, not a boundary"))


class PlaceGazetteer(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    updated: dt.date = Field(description="Date of the source dataset")
    credit_th: str
    license: str
    source_url: str
    places: list[Place] = Field(description="Provinces, then districts, then subdistricts, each sorted by code")
    notes_th: list[str]
