"""Contract of /data/v1/summary/overview.json: places to watch now and to prepare for, by fixed rules (not official).

Built every round from the other files of the round (overview_build.py). Official alerts are not copied here: the
web reads them from alerts.json and shows them apart, so a computed line is never mistaken for an announcement.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position

ReasonKind = Literal["flood_reports", "road_flooding", "rain_measured", "rain_radar", "rain_forecast",
                     "rain_burst", "rain_3days", "river_rising", "dam_full", "dam_release_up", "satellite_flood"]


class OverviewReason(ContractModel):
    kind: ReasonKind
    text_th: str = Field(description=(
        "Plain words without the day, e.g. น้ำท่วมหลายจุด (รายงาน 4 จุด) or ฝนหนักบางพื้นที่ สูงสุดราว 60 มม."))
    day: dt.date | None = Field(description=(
        "Thai day a forecast speaks of (the web says วันนี้/พรุ่งนี้/อีก 2 วัน from it); null for what is happening"))
    source_th: str = Field(description="Short name of the source, e.g. Longdo Traffic or Open-Meteo")
    at: AwareDatetime = Field(description=(
        "Time of the data behind the reason: the latest report, the measurement, the day of a dam report, or when the"
        " forecast was fetched"))
    until: AwareDatetime | None = Field(default=None, description=(
        "What is happening holds until this time, and the web leaves the reason out after it (Codex M27): flood"
        " reports while two are still within their time (stop, or 12 hours after start), a gauge 60 minutes, the"
        " radar 45 minutes, a road report the end of its day, GISTDA's satellite water 36 hours from its check. The"
        " count in the text is of the round, so it may be"
        " one or two too many until the next round. Null for forecasts, which the web drops when their day passes"))


class OverviewItem(ContractModel):
    when: Literal["now", "next"] = Field(description=(
        "now = happening (reports, measurements); next = forecast, river trend, or a dam that is full or releases"
        " a lot more, to prepare for"))
    place_th: str = Field(description="e.g. อ.ธัญบุรี จ.ปทุมธานี, จ.กาญจนบุรี, แม่น้ำบางปะกง ที่ฉะเชิงเทรา")
    detail_th: str | None = Field(description="Where in the place, e.g. แถว ถ.พหลโยธิน, ถ.รังสิต-นครนายก")
    province_code: str | None = Field(description=(
        "DOPA province code (2 digits), so the web can mark items under an official alert (TH-<code>)"))
    area_code: str | None = Field(default=None, description=(
        "DOPA code of the area the web outlines on the map from ref/boundaries.json (added 2026-10-01): the district"
        " (4 digits) of a place to watch now, the province (2 digits) of a forecast; null for a river point or a dam"))
    location: Position = Field(description="[lon, lat] the map goes to: the reports' centre, a district or province")
    zoom: float = Field(ge=3, le=17)
    score: int = Field(ge=0, description="Higher first within `when`; the rules of v0 on /method")
    reasons: list[OverviewReason] = Field(min_length=1)


class OverviewInput(ContractModel):
    name_th: str
    status: Literal["fresh", "stale", "missing"] = Field(description=(
        "stale or missing inputs add nothing to the items, so old data never raises a place"))
    at: AwareDatetime | None = Field(description="When the input was fetched, null when missing")


class OverviewEarlier(ContractModel):
    generated_at: AwareDatetime = Field(description=(
        "The round compared with: of the rounds 45 to 75 minutes before this one, the one nearest an hour"))
    now: list[str] = Field(description="place_th of the places to watch now in that round")
    next: list[str] = Field(description="place_th of the places to prepare for in that round")


class Overview(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    rules: Literal["v0"] = "v0"
    generated_at: AwareDatetime
    items: list[OverviewItem] = Field(description="now first (highest score first), then next")
    inputs: list[OverviewInput]
    notes_th: list[str]
    earlier: OverviewEarlier | None = Field(default=None, description=(
        "The lists of about an hour before (added 2026-10-01), so the web can say what is new and what has passed;"
        " null when no round of that age was kept"))
