"""Conservative building blocks; no operational routing without verified local parameters."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime


def daily_release_flow(volume_mcm: float | None) -> float | None:
    """A daily volume's average m3/s, not its hourly peak or a future release plan."""
    if volume_mcm is None:
        return None
    if isinstance(volume_mcm, bool) or not math.isfinite(volume_mcm) or volume_mcm < 0:
        raise ValueError("release volume must be finite and nonnegative")
    return volume_mcm * 1_000_000 / 86400


@dataclass(frozen=True)
class FlowInput:
    scope: frozenset[str]
    flow_m3s: float | None
    start: datetime
    end: datetime


def combine_flows(inputs: list[FlowInput]) -> float | None:
    """Reject overlapping catchment/source scopes: a downstream flow already contains its upstream water."""
    seen: set[str] = set()
    total = 0.0
    missing = False
    window = (inputs[0].start, inputs[0].end) if inputs else None
    for item in inputs:
        scope, value = item.scope, item.flow_m3s
        if (item.start.tzinfo is None or item.end.tzinfo is None or item.start >= item.end
                or (item.start, item.end) != window):
            raise ValueError("flow time windows must be aware, valid and aligned")
        if not scope or seen & scope:
            raise ValueError("flow scope missing or double counted")
        seen |= scope
        if value is None:
            missing = True
        elif isinstance(value, bool) or not math.isfinite(value) or value < 0:
            raise ValueError("flow must be finite and nonnegative")
        else:
            total += value
    return None if missing or not inputs else total


def muskingum(inflow: list[float | None], *, k_hours: float, x: float, step_hours: float,
              initial_outflow: float) -> list[float | None]:
    """Only for calibrated suitable reaches; never for the gated/tidal Rangsit network by default."""
    if not all(math.isfinite(v) for v in [k_hours, x, step_hours, initial_outflow]):
        raise ValueError("finite routing parameters required")
    if k_hours <= 0 or not 0 <= x <= 0.5 or initial_outflow < 0:
        raise ValueError("invalid routing parameters")
    if not 2 * k_hours * x <= step_hours <= 2 * k_hours * (1 - x) or step_hours <= 0:
        raise ValueError("routing timestep would have negative coefficients")
    denominator = k_hours * (1 - x) + step_hours / 2
    c0 = (step_hours / 2 - k_hours * x) / denominator
    c1 = (step_hours / 2 + k_hours * x) / denominator
    c2 = (k_hours * (1 - x) - step_hours / 2) / denominator
    out: list[float | None] = []
    previous_in: float | None = initial_outflow
    previous_out: float | None = initial_outflow
    for value in inflow:
        if value is not None and (isinstance(value, bool) or not math.isfinite(value) or value < 0):
            raise ValueError("invalid inflow")
        current = (c0 * value + c1 * previous_in + c2 * previous_out
                   if value is not None and previous_in is not None and previous_out is not None else None)
        out.append(current)
        previous_in, previous_out = value, current
    return out


def bank_margin(level_m: float | None, bank_m: float | None, *, level_datum: str | None,
                bank_datum: str | None) -> float | None:
    """Positive means water below this bank; absence or incompatible datums cannot establish safety."""
    if level_m is None or bank_m is None or not level_datum or level_datum != bank_datum:
        return None
    if not math.isfinite(level_m) or not math.isfinite(bank_m):
        return None
    return bank_m - level_m
