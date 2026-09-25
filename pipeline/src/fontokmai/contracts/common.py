"""Shared building blocks of the public data contract published under /data/v1."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

SCHEMA_VERSION: Literal["1"] = "1"

# GeoJSON positions are [longitude, latitude] in WGS84 (RFC 7946).
Position = Annotated[list[float], Field(min_length=2, max_length=2)]
LinearRing = Annotated[list[Position], Field(min_length=4)]


class ContractModel(BaseModel):
    """Base for published models: unknown fields are rejected and instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class GeoMultiPolygon(ContractModel):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[LinearRing]]


class SourceStatus(ContractModel):
    source_id: str
    status: Literal["ok", "degraded", "failed"]
    last_attempt_at: AwareDatetime
    last_success_at: AwareDatetime | None
    items_seen: int = Field(ge=0)
    items_rejected: int = Field(ge=0)
    message: str | None = None
