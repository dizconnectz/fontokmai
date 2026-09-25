"""Contract of /data/v1/ref/cctv.json: where public cameras are and which owner page opens them (link-out only)."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, Position


class Camera(ContractModel):
    id: str
    name_th: str
    owner_th: str
    kind: Literal["river", "canal", "dam", "road"]
    location: Position | None = Field(description="[lon, lat]; null when the place is not known well enough to pin")
    position: Literal["source", "approximate"] = Field(description=(
        "source = coordinates published with the camera list; approximate = placed by fontokmai from a landmark"))
    page_url: str = Field(description="Owner page that shows the camera; open it in a new tab, never embed it")
    note_th: str | None


class CctvRegistry(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    updated: dt.date
    cameras: list[Camera] = Field(description="Sorted by id")
    notes_th: list[str]
