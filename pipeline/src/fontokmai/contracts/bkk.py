"""Contracts of /data/v1/bkk/*.json: Bangkok readings of the Drainage and Sewerage Department through BMA DXS."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position


def _draft7_tuple(schema: dict) -> None:
    # The browser's AJV and type generator consume draft 7, not 2020-12 prefixItems.
    schema["items"] = schema.pop("prefixItems")
    schema["additionalItems"] = False


BankPosition = Annotated[
    tuple[Annotated[float, Field(ge=-180, le=180)], Annotated[float, Field(ge=-90, le=90)]],
    Field(json_schema_extra=_draft7_tuple),
]


class BankPointGeometry(ContractModel):
    type: Literal["Point"] = "Point"
    coordinates: BankPosition


class BankReachGeometry(ContractModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[BankPosition] = Field(min_length=2)


class BankEvidence(ContractModel):
    id: str = Field(min_length=1)
    name_th: str = Field(min_length=1)
    observed_at: AwareDatetime | None
    verified: bool = Field(description="Source quality control passed and evidence scope checked by producer")
    source_url: AnyHttpUrl
    credit_th: str = Field(min_length=1)


class BankMeasurement(BankEvidence):
    kind: Literal["measurement"]
    geometry: BankPointGeometry
    level_m: float | None = Field(allow_inf_nan=False)
    bank_m: float | None = Field(allow_inf_nan=False)
    level_datum: str | None = Field(min_length=1)
    bank_datum: str | None = Field(min_length=1)
    level_side: str | None = Field(min_length=1)
    bank_side: str | None = Field(min_length=1)


class BankReachReport(BankEvidence):
    kind: Literal["reported_reach"]
    geometry: BankReachGeometry
    status: Literal["above_bank", "at_bank", "below_bank", "unknown"] = Field(
        description="Explicit source observation for this exact reach, never extrapolated from one gauge")


BankObservation = Annotated[BankMeasurement | BankReachReport, Field(discriminator="kind")]


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
    pumps_running: int | None = Field(default=None, description=(
        "Pumps running at the reading (pumpdata true); null when the station gives no pump status. A count of "
        "pumps, not a drainage capacity"))


class CanalLevels(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    source_url: str = Field(description="Public page of the department to link out to (never a DXS page)")
    credit_th: str
    stations: list[CanalStation] = Field(description="Every station DXS lists, sorted by code")
    notes_th: list[str]
    bank_observations: list[BankObservation] = Field(default_factory=list, description=(
        "Optional verified bank-level evidence. DXS currently supplies none: keep empty, never invent banks or "
        "reaches. Register rights and evidence coverage before enabling a source. Consumers expire at 60 minutes."))


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


# ---------- also from DXS: the department's daily situation text, large dams and TMD stations ----------

class SituationReport(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    subject_th: str
    text_th: str = Field(description="The department's message as plain text (paragraphs separated by newlines)")
    created_at: AwareDatetime | None
    updated_at: AwareDatetime | None
    source_url: str = Field(description="Public page of the department to link out to (never a DXS page)")
    credit_th: str
    notes_th: list[str]


class DamFigures(ContractModel):
    report_date: date = Field(description="Day of the department's report these figures are from")
    fetched_at: AwareDatetime = Field(description="When this site fetched that report")
    percent: float | None
    volume_mcm: float | None
    inflow_mcm: float | None
    outflow_mcm: float | None


class Dam(ContractModel):
    id: str
    name_th: str
    region_th: str | None
    owner_th: str | None
    location: Position | None = Field(description="[lon, lat] from OpenStreetMap; null when not found")
    location_kind: Literal["dam", "reservoir"] | None = Field(
        description="dam = on the dam wall, reservoir = the middle of its lake (used when the wall is not mapped)")
    storage_mcm: float | None = Field(description="Capacity at normal storage level, million cubic metres")
    volume_mcm: float | None = Field(description="Water in the reservoir on the report day, million cubic metres")
    percent: float | None = Field(description="volume as a percentage of storage")
    inflow_mcm: float | None = Field(description="Inflow of the day, million cubic metres")
    outflow_mcm: float | None = Field(description="Release of the day, million cubic metres")
    previous_outflow_mcm: float | None = Field(default=None, description=(
        "Release on previous_report_date of the file, million cubic metres; null when there is no earlier report"
        " or the dam had no figure then. Release up a lot (the site's trial rule, /method): at least 1 million m³"
        " a day more and at least half as much again"))
    downstream_th: str | None = Field(default=None, description=(
        "Provinces the dam's river runs through, down to the sea or out of Thailand, e.g. ท้ายน้ำ: นครนายก → "
        "ปราจีนบุรี → ฉะเชิงเทรา · ออกทะเลที่ อ.บางปะกง จ.ฉะเชิงเทรา (HydroRIVERS river network); places to follow "
        "when the dam releases water, not a flood forecast. Null when the dam has no place or river"))
    last_known: DamFigures | None = Field(default=None, description=(
        "Only when this report has none of percent, volume_mcm, inflow_mcm and outflow_mcm for the dam: its latest"
        " figures from an earlier report this site published, at most 7 days before report_date, with their own"
        " day and fetch time. Shown dated, never as this report's (user 2026-10-01: the department's report of a"
        " day can be blank for most dams until later in the day)"))


class DamReport(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    report_date: date
    previous_report_date: date | None = Field(default=None, description=(
        "Day of the report the releases are compared with, at most 3 days before report_date: from RID's history,"
        " the latest earlier day with figures for most dams (automatic); from DXS, which gives only the latest day,"
        " the last one this site published (by hand). Null when there is none"))
    automatic: bool = Field(default=False, description=(
        "True when the server fetches this file by itself every 2 hours from RID's open API (added 2026-10-02);"
        " False when it comes with the Bangkok update run by hand (DXS, D31). The web judges its age by this"))
    source_url: str
    credit_th: str
    location_credit_th: str
    dams: list[Dam]
    notes_th: list[str]


class WeatherStation(ContractModel):
    wmo: str
    name_th: str
    province_th: str | None
    location: Position | None
    observed_at: AwareDatetime | None
    temperature_c: float | None
    max_c: float | None
    min_c: float | None
    humidity_pct: float | None
    rain_mm: float | None = Field(description="Rain reported with the morning observation (the 24 hours to it)")


class WeatherToday(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    source_url: str
    credit_th: str
    stations: list[WeatherStation]
    notes_th: list[str]
