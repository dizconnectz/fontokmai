"""Contract of /data/v1/water/flows.json: the 06:00 flows of the Chao Phraya's stations, barrages and gates from the
Royal Irrigation Department's daily report, with each station's state from its chart (contract section 25, D35)."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position


class FlowPoint(ContractModel):
    id: str = Field(description="Stable id, e.g. c29b, rama6, phranarai")
    name_th: str
    kind: Literal["station", "barrage", "gate", "intake"] = Field(description=(
        "station: a gauging station on the river; barrage: the flow through a barrage; gate: a gate that lets water"
        " into a canal or river; intake: the total of several gates (an irrigation side)"))
    code: str | None = Field(default=None, description="RID's station code, e.g. C.29B")
    flow_cms: float | None = Field(description="m³/s at 06:00 of report_date, as the report gives it; null when the"
                                               " report gives none")
    yesterday_cms: float | None = Field(default=None, description="The report's figure for the day before")
    capacity_cms: float | None = Field(default=None, description=(
        "As RID's chart prints it: a station's channel capacity, or the most a gate or barrage releases (Qmax)"))
    capacity_kind: Literal["channel", "release"] | None = None
    into_th: str | None = Field(default=None, description="Where a gate's water goes, e.g. คลองระพีพัฒน์ → ทุ่งรังสิต")
    level_m: float | None = Field(default=None, description="Water level, m above mean sea level, when the report"
                                                            " gives it")
    below_bank_m: float | None = Field(default=None, description=(
        "How far the water is below the bank (m), when the report says it; negative = above the bank"))
    flow_backup_at: AwareDatetime | None = Field(default=None, description=(
        "Set when flow_cms (and level_m, if the report has none) come from the backup instead of the report: RID's"
        " hydrology centre page, read by the manual run from a computer in Thailand (user 2026-10-04), at this time."
        " Null when the figures are the report's own"))
    state: Literal["normal", "critical", "flood"] | None = Field(default=None, description=(
        "RID's own state of the station from the coloured dot of its chart (green, yellow, red): RID's assessment,"
        " not this site's; null when the chart has no dot there or could not be read"))


class FlowSite(ContractModel):
    id: str
    name_th: str
    location: Position = Field(description="[lon, lat] of the pin; see location_note_th for how exact it is")
    location_note_th: str
    points: list[str] = Field(description="The ids of points shown at this site, in this order")


class RidFlows(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime = Field(description="When this site read the report")
    report_date: dt.date = Field(description="The report's own date")
    observed_at: AwareDatetime = Field(description="06:00 of report_date (Thai time): the time of the figures")
    source_url: str = Field(description="RID's daily report (PDF), to link to")
    chart_url: str | None = Field(description="RID's chart of that day (picture), to link to; null when not read")
    page_url: str = Field(description="RID's page of the daily charts")
    credit_th: str
    location_credit_th: str
    points: list[FlowPoint]
    sites: list[FlowSite]
    flooded_districts: list[str] = Field(default_factory=list, description=(
        "DOPA codes of the districts the report's flood section (section 6) names as affected by flooding that day:"
        " RID's report, not this site's assessment"))
    backup_url: str | None = Field(default=None, description=(
        "RID's hydrology centre page the backup figures come from (points with flow_backup_at), to link to"))
    notes_th: list[str]


class HydroStation(ContractModel):
    code: str = Field(description="RID's station code as the page prints it, e.g. C.35")
    flow_cms: float | None = Field(description="m³/s the page gives at observed_at")
    level_m: float | None = Field(description="Water level, m above mean sea level, the page gives at observed_at")


class RidHydro(ContractModel):
    """bkk/rid_hydro.json: the backup figures of RID's Chao Phraya stations, from the page of RID's hydrology centre
    (hyd-app-db.rid.go.th), which answers computers in Thailand only: read by the manual Bangkok run (D31) and
    copied to the server with the Bangkok files. Used only where the daily report gives a station no figure."""

    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime = Field(description="When the manual run read the page")
    observed_at: AwareDatetime = Field(description="The time the page prints for its figures")
    source_url: str
    credit_th: str
    stations: list[HydroStation]
    notes_th: list[str]

