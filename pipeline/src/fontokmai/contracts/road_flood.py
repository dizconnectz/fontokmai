"""Contract of /data/v1/ref/road_flood_history.json: how often roads in Bangkok and vicinity were reported flooded."""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position

SourceId = Literal["bma_road_flood_stats", "itic_longdo_events"]
BBox = Annotated[list[float], Field(min_length=4, max_length=4,
                                    description="[lon_min, lat_min, lon_max, lat_max] in WGS84")]
RECENT_LIMIT = 10
POINT_LIMIT = 30


class RoadFloodSource(ContractModel):
    source_id: SourceId
    name_th: str
    credit_th: str = Field(description="Show this with every number that uses the source")
    license: str
    url: str = Field(description="Dataset page for the 'read more' link")
    period_from: dt.date | None
    period_to: dt.date | None
    reports: int = Field(ge=0, description="Reports read from the source after QC")
    reports_without_place: int = Field(ge=0, description="Reports without a road, soi or tunnel name we could read")
    rejected: int = Field(ge=0, description="Rows dropped by QC, e.g. a date outside the year of its file")
    retrieved_at: AwareDatetime


class RoadFloodReport(ContractModel):
    date: dt.date = Field(description="Local date (Asia/Bangkok) the flooding started")
    source_id: SourceId
    start: AwareDatetime | None
    stop: AwareDatetime | None
    spot: str | None = Field(description="Place on the road, or the report title, as written by the source")
    district: str | None
    depth_cm: int | None = Field(ge=0)
    length_m: int | None = Field(ge=0)
    lanes: str | None = Field(description="Traffic lanes affected as written by the source, e.g. เต็มผิว")
    rain_mm: float | None = Field(ge=0, description="Rain total of the event reported by the source")
    location: Position | None = Field(description="[lon, lat] of the report when the source gives one")
    url: str | None = Field(description="Page of this report at the source, when the source has one")


class RoadFloodRoad(ContractModel):
    key: str = Field(description="Search key; see contracts/v1/README.md section 8")
    name_th: str
    kind: Literal["road", "soi", "tunnel"]
    districts: list[str] = Field(description="Most reported first")
    flood_days: int = Field(ge=1, description="Distinct local dates with at least one report")
    reports: int = Field(ge=1)
    first_date: dt.date
    last_date: dt.date
    days_by_year: dict[str, int] = Field(description="Gregorian year → flood_days in that year")
    max_depth_cm: int | None
    points: list[Position] = Field(max_length=POINT_LIMIT, description=(
        "Distinct report locations [lon, lat] rounded to 4 decimals, newest first; empty when no report of this road"
        " has coordinates (the BMA statistics give road names only). Used to find roads near a pin"))
    recent: list[RoadFloodReport] = Field(max_length=RECENT_LIMIT, description="Newest first")


class RoadFloodHistory(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    built_at: AwareDatetime
    area_th: str
    bbox: BBox
    sources: list[RoadFloodSource]
    roads: list[RoadFloodRoad] = Field(description="Sorted by key")
    notes_th: list[str] = Field(description="Limits every reader must see next to the numbers")
