"""Time windows for hourly forecast values (each value covers the hour ending at its timestamp)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

ICT = timezone(timedelta(hours=7))
ONE_HOUR = timedelta(hours=1)


def full_future_hour_indices(hours: list[datetime], now: datetime, until: datetime) -> tuple[list[int], bool]:
    """Return indices for full forecast hours starting at or after now and whether the axis covers them all.

    A forecast value ending at 17:00 covers 16:00–17:00. At 16:30 that interval is partly elapsed, so do not count
    its full rainfall as future rain. Hourly data cannot resolve the remaining half hour; skip that partial interval.
    """
    local_now = now.astimezone(ICT)
    cutoff = until.astimezone(ICT)
    first_start = local_now.replace(minute=0, second=0, microsecond=0)
    if first_start < local_now:
        first_start += ONE_HOUR

    expected_ends: list[datetime] = []
    end = first_start + ONE_HOUR
    while end <= cutoff:
        expected_ends.append(end)
        end += ONE_HOUR

    by_end = {hour.astimezone(ICT): index for index, hour in enumerate(hours)}
    indices = [by_end[hour] for hour in expected_ends if hour in by_end]
    complete = bool(expected_ends) and len(indices) == len(expected_ends)
    return indices, complete
