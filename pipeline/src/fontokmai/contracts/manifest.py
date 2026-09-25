"""Contract of /data/v1/manifest.json: one complete snapshot generation (design 4.4 and 4.6)."""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, SourceStatus


class ManifestFile(ContractModel):
    path: str = Field(description="Path relative to the data base URL (/data/v1/)")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(ge=0)
    revision: int = Field(ge=1, description="Increases only when the file bytes change")


class Manifest(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    generation_id: str
    generated_at: AwareDatetime
    next_due_at: AwareDatetime
    writer: str
    owner_epoch: int = Field(ge=1)
    recovery_epoch: int = Field(ge=1)
    completeness: Literal["complete", "partial"]
    files: list[ManifestFile]
    source_status: list[SourceStatus]
