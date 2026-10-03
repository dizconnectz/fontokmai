"""Contracts of the canals of the Rangsit pilot: /data/v1/ref/canals.json (their lines, contract section 26) and
/data/v1/summary/canals.json (which may overflow, by this site's trial rules, contract section 27; user 2026-10-03:
"เป็น 1 ใน factor ในการพยากรณ์ด้วยว่าจะท่วมคลองเส้นไหน")."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, GeoMultiLineString


class CanalLine(ContractModel):
    id: str = Field(description="Stable id, e.g. rangsit")
    name_th: str
    line: GeoMultiLineString = Field(description="[lon, lat] in WGS84, simplified for drawing")
    districts: list[str] = Field(description="DOPA codes of the districts the canal runs through or along")
    fed_by: list[str] = Field(description="ids of water/flows.json points whose water reaches this canal")
    drains_to: str | None = Field(description="id of the river station whose state limits how fast it drains")
    dxs_canals: list[str] = Field(description="Its name in Bangkok's canal levels (bkk/water.json canal_th)")


class CanalLines(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    updated: dt.date = Field(description="Date of the OpenStreetMap extract")
    credit_th: str
    license: str
    source_url: str
    canals: list[CanalLine]
    notes_th: list[str]


FactorKind = Literal["inflow", "rain", "drainage", "level", "flooding"]


class CanalFactor(ContractModel):
    kind: FactorKind = Field(description=(
        "inflow: water let into the canal network (RID's gates); rain: rain forecast over its districts; drainage:"
        " the state of the river it drains to; level: Bangkok's gauges on it rising; flooding: RID's report of"
        " flooded districts along it"))
    points: int = Field(ge=0, le=2, description="What this factor adds to the canal's score (0 = noted, no points)")
    text_th: str
    source_th: str
    at: AwareDatetime | None = Field(description="Time of the data the factor uses")


class CanalGap(ContractModel):
    kind: FactorKind = Field(description="A factor that applies to the canal but could not be judged")
    text_th: str = Field(description="Why, e.g. ไม่มีพยากรณ์ฝนที่ใหม่พอ")


class CanalWatch(ContractModel):
    id: str = Field(description="The canal's id in ref/canals.json")
    name_th: str
    score: int = Field(ge=0)
    level: Literal["watch", "warn"] | None = Field(description=(
        "warn (score 3 or more) or watch (2) by this site's trial rules; null below. Not an announcement and not a"
        " forecast of how high the water will be"))
    factors: list[CanalFactor]
    assessed: bool = Field(default=True, description=(
        "False when no factor that applies to the canal had data fresh enough: its score and level then say"
        " nothing, and it is shown as not assessed, never as below the rules (M50)"))
    gaps: list[CanalGap] = Field(default_factory=list, description=(
        "The factors that apply to the canal but could not be judged, with why; the score counts only the others"))


class CanalInput(ContractModel):
    source: Literal["flows", "rain", "levels"] = Field(description=(
        "flows: water/flows.json (RID); rain: forecast/rain.json; levels: bkk/water.json (Bangkok's gauges)"))
    name_th: str
    status: Literal["fresh", "stale", "missing"] = Field(description=(
        "fresh: used; stale: older than the rules allow, not used; missing: not in the round or unreadable"))
    at: AwareDatetime | None = Field(description="The time of the data (RID's 06:00, the forecast's fetch, the"
                                                 " Bangkok file's fetch); null when missing")


class CanalOutlook(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    generated_at: AwareDatetime
    rules: str = Field(description="Version of the trial rules, e.g. canals-v1")
    canals: list[CanalWatch] = Field(description="Every canal of ref/canals.json, the highest score first")
    inputs: list[CanalInput] = Field(default_factory=list, description="What each source was when this was made")
    notes_th: list[str]
