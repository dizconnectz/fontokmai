"""Contracts of /data/v1/bkk/*.json: Bangkok readings of the Drainage and Sewerage Department through BMA DXS."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position


class CanalStation(ContractModel):
    code: str
    name_th: str = Field(description="Station name as DXS gives it, e.g. ส.คลองเตย (ส. = pumping station, "
                                     "ปตร. = water gate, ค. = canal gauge)")
    canal_th: str | None
    district_th: str | None
    location: Position | None = Field(description="[lon, lat]; null when DXS gives none or it lies outside the "
                                                  "Bangkok area")
    observed_at: AwareDatetime | None = Field(description="Time of the latest reading (Thai time)")
    level_in_m: float | None = Field(description="Water level on the inner side (ระดับน้ำด้านใน), metres above mean "
                                                 "sea level (ม.รทก.), not the depth of water on a road")
    level_out_m: float | None = Field(description="Water level on the outer side (ระดับน้ำด้านนอก), m above MSL")
    pumps: int | None = Field(description="Number of pumps, for a pumping station")


class CanalLevels(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    source_url: str = Field(description="Public page of the department to link out to (never a DXS page)")
    credit_th: str
    stations: list[CanalStation] = Field(description="Every station DXS lists, sorted by code")
    notes_th: list[str]


class RainGauge(ContractModel):
    code: str
    name_th: str
    district_th: str | None
    location: Position | None = Field(description="[lon, lat]; null when DXS gives none or it lies outside the "
                                                  "Bangkok area")
    observed_at: AwareDatetime | None = Field(description="Time of the latest reading (Thai time)")
    rain_15min_mm: float | None
    rain_1h_mm: float | None
    rain_3h_mm: float | None
    rain_24h_mm: float | None


class RainGauges(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    source_url: str = Field(description="Public page of the department to link out to (never a DXS page)")
    credit_th: str
    gauges: list[RainGauge] = Field(description="Every gauge DXS lists, sorted by code")
    notes_th: list[str]


class RoadFloodingReport(ContractModel):
    district_th: str | None
    road_th: str
    area_th: str | None = Field(description="Where on the road, as the department writes it")
    depth_cm: float | None = Field(description="Water on the road at its deepest, centimetres")
    length_m: float | None
    lanes_th: str | None = Field(description="Traffic lanes affected, e.g. 1-2 เลน or เต็มผิว")
    flood_start: AwareDatetime | None
    dry_at: AwareDatetime | None = Field(description="When the road was dry again; null while it is still flooded")
    rain_mm: float | None


class RoadFloodingDaily(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    report_date: date = Field(description="Day of the department's report (it can list water still there "
                                          "from the evening before)")
    updated_at: AwareDatetime | None = Field(description="When the department last updated the report")
    source_url: str = Field(description="Public page of the report to link out to (never a DXS page)")
    credit_th: str
    reports: list[RoadFloodingReport] = Field(description="Still flooded first, then the latest start first")
    notes_th: list[str]
