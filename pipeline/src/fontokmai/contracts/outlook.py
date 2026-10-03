"""An experimental, point-sampled 14-day rain ensemble; never a flood probability."""
from __future__ import annotations

from datetime import date, timedelta, timezone
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from fontokmai.contracts.common import ContractModel, Position

Rain = Annotated[float, Field(ge=0, le=2000, allow_inf_nan=False)] | None


class HydrologyPoint(ContractModel):
    id: str
    area_id: str
    area_th: str
    name_th: str
    location: Position
    source_url: str
    credit_th: str
    bank_m: float | None = Field(default=None, allow_inf_nan=False)
    bank_datum: str | None = None
    flow_capacity_m3s: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    pump_capacity_m3s: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    gate_operation_known: bool = False


class EnsembleMember(ContractModel):
    id: str
    rain_mm: list[Rain]


class PointEnsemble(ContractModel):
    model: Literal["ecmwf_ifs025", "gfs05"]
    expected_members: int = Field(ge=1)
    fetched_at: AwareDatetime
    issued_at: AwareDatetime | None = None
    grid_location: Position
    members: list[EnsembleMember]


class OutlookPoint(ContractModel):
    point: HydrologyPoint
    models: list[PointEnsemble]
    missing_models: list[Literal["ecmwf_ifs025", "gfs05"]]


class RainOutlook(ContractModel):
    schema_version: Literal["1"] = "1"
    product: Literal["pilot_rain_ensemble"] = "pilot_rain_ensemble"
    experimental: Literal[True] = True
    spatial_scope: Literal["sampled_points"] = "sampled_points"
    fetched_at: AwareDatetime
    source_url: str = "https://open-meteo.com/en/docs/ensemble-api"
    credit_th: str = "Open-Meteo.com (CC BY 4.0), ECMWF และ NOAA"
    days: list[date] = Field(min_length=14, max_length=14)
    points: list[OutlookPoint]
    notes_th: list[str]

    @model_validator(mode="after")
    def shapes(self) -> RainOutlook:
        today = self.fetched_at.astimezone(timezone(timedelta(hours=7))).date()
        if self.days[0] != today + timedelta(days=1):
            raise ValueError("the first day must be tomorrow in Thailand")
        if self.days != sorted(set(self.days)):
            raise ValueError("days must be unique and ordered")
        if any((b - a).days != 1 for a, b in zip(self.days, self.days[1:], strict=False)):
            raise ValueError("days must be consecutive")
        ids = [p.point.id for p in self.points]
        if len(ids) != len(set(ids)):
            raise ValueError("point ids must be unique")
        for point in self.points:
            names = [m.model for m in point.models]
            if len(point.missing_models) != len(set(point.missing_models)):
                raise ValueError("missing models must be unique")
            if len(names) != len(set(names)) or set(names) & set(point.missing_models):
                raise ValueError("models must be unique and cannot be both present and missing")
            if set(names) | set(point.missing_models) != {"ecmwf_ifs025", "gfs05"}:
                raise ValueError("every requested model must be accounted for")
            for model in point.models:
                if model.expected_members != {"ecmwf_ifs025": 51, "gfs05": 31}[model.model]:
                    raise ValueError("expected member count does not match the model")
                member_ids = [m.id for m in model.members]
                if len(member_ids) != len(set(member_ids)) or len(member_ids) > model.expected_members:
                    raise ValueError("ensemble member ids must be unique and within the expected count")
                if any(len(m.rain_mm) != len(self.days) for m in model.members):
                    raise ValueError("every member must have one value per day")
        return self
