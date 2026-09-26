"""Contract of /data/v1/live/floods.json: flood reports of the last hours from the Longdo/iTIC event feed."""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position


class LiveFloodReport(ContractModel):
    id: str = Field(description="longdo:<event id>")
    title_th: str = Field(description="Short title as reported, e.g. น้ำท่วม ถนนรัชดาภิเษก")
    road_th: str | None
    location: Position = Field(description="[lon, lat] of the report (placed by the reporter)")
    start: AwareDatetime = Field(description="When the report began (Thai time)")
    stop: AwareDatetime | None = Field(description="When the report is set to end; public reports last one hour")
    reporter: Literal["highway_department", "itic_staff", "public"] = Field(description=(
        "Who reported it: Department of Highways, iTIC staff or a member of the public (names are not published)"))
    url: str = Field(description="The report on Longdo Traffic; link out, never copy its photos")


class LiveFloods(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    fetched_at: AwareDatetime
    source_url: str
    credit_th: str
    reports: list[LiveFloodReport] = Field(description="Newest start first; ongoing or ended within 2 hours")
    notes_th: list[str]
