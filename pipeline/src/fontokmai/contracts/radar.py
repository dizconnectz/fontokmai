"""Contract of /data/v1/radar.json: the latest TMD radar composite frames (rain rate at 2 km)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position

Corners = Annotated[list[Position], Field(min_length=4, max_length=4, description=(
    "Image corners [lon, lat] in the order top-left, top-right, bottom-right, bottom-left"
    " (a MapLibre image source takes them as they are)"))]


class RadarFrame(ContractModel):
    time: AwareDatetime = Field(description="Observation time of the frame (UTC)")
    path: str = Field(description="PNG path relative to the data base URL")


class RadarLegendItem(ContractModel):
    min_mm_per_hr: float | None = Field(description="Lower bound of the class; null for the no-data colour")
    color: str = Field(pattern=r"^#[0-9A-F]{6}$", description="Legend colour as TMD publishes it")
    label: str


class RadarFeed(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    generation_id: str
    product: Literal["tmd_composite_zr"] = "tmd_composite_zr"
    name_th: str
    credit_th: str
    source_url: str
    coordinates: Corners
    frames: list[RadarFrame] = Field(description="Oldest first; the last frame is the latest; may be empty")
    legend: list[RadarLegendItem] = Field(description="Highest class first, as on the TMD page")
    legend_opacity: float = Field(gt=0, le=1, description=(
        "Pixels show a legend colour blended over white at this opacity; undo it before matching a pixel to"
        " a class. Transparent pixels mean no echo"))
    notes_th: list[str]
