"""Contract of /data/v1/alerts.json: official alerts with a lifecycle (design section 9)."""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, GeoMultiPolygon, SourceStatus

LifecycleStatus = Literal["pending", "active", "expired", "cancelled"]
EVENT_ID_PATTERN = r"^[a-z0-9_]+:\S+$"


class AlertTarget(ContractModel):
    kind: Literal["province"]
    code: str = Field(pattern=r"^TH-[0-9A-Z]{1,2}$", description="ISO 3166-2 code")


class Alert(ContractModel):
    event_id: str = Field(pattern=EVENT_ID_PATTERN, description="Namespaced id of the event lineage")
    revision: int = Field(ge=1, description="Increases only when the published content of the event changes")
    message_type: Literal["new", "update", "cancel"]
    lifecycle_status: LifecycleStatus
    is_effective: bool
    origin: Literal["official"]
    issuer: str
    source_message_id: str
    supersedes: list[str]
    event: str
    severity: str
    urgency: str
    certainty: str
    headline_th: str | None
    body_th: str | None
    instruction_th: str | None
    area_desc_th: str | None
    sent: AwareDatetime
    effective: AwareDatetime
    onset: AwareDatetime | None
    expires: AwareDatetime
    expires_policy: Literal["source", "default_24h"]
    qc_flags: list[str]
    targets: list[AlertTarget]
    geometry: GeoMultiPolygon | None
    source_url: str
    credit_th: str
    notify_eligible: bool


class AlertTombstone(ContractModel):
    event_id: str = Field(pattern=EVENT_ID_PATTERN)
    revision: int = Field(ge=1)
    lifecycle_status: Literal["expired", "cancelled"]
    ended_at: AwareDatetime


class AlertsFeed(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    generation_id: str = Field(description="Must equal manifest.generation_id; otherwise the files are mixed")
    recovery_epoch: int = Field(ge=1, description="Changes when published state could not be recovered")
    feed_generated_at: AwareDatetime
    feed_sequence: int = Field(ge=1, description="Increases only when alerts or tombstones change")
    history_since: AwareDatetime
    alerts: list[Alert]
    tombstones: list[AlertTombstone]
    source_status: list[SourceStatus]
