"""Run a job on the fixed 15-minute grid of design 4.3: :03, :18, :33 and :48 past each hour (same in UTC and ICT)."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

SLOT_MINUTES = (3, 18, 33, 48)


def next_slot(now: datetime) -> datetime:
    """First slot strictly after `now`, in UTC."""
    now = now.astimezone(UTC)
    hour = now.replace(minute=0, second=0, microsecond=0)
    for offset in (timedelta(0), timedelta(hours=1)):
        for minute in SLOT_MINUTES:
            slot = hour + offset + timedelta(minutes=minute)
            if slot > now:
                return slot
    raise AssertionError("a slot always exists within two hours")


def _utc_now() -> datetime:
    return datetime.now(UTC)


def run_forever(job: Callable[[datetime], dict[str, Any]], *, clock: Callable[[], datetime] = _utc_now,
                sleep: Callable[[float], None] = time.sleep, log: Callable[[str], None] = print,
                max_rounds: int | None = None) -> None:
    """Sleep until each slot and run the job. A failing round is logged and the schedule continues,
    because a stopped scheduler is worse than one failed round (stale data stays visible on the web)."""
    rounds = 0
    while max_rounds is None or rounds < max_rounds:
        slot = next_slot(clock())
        delay = (slot - clock()).total_seconds()
        if delay > 0:
            sleep(delay)
        started = clock()
        record: dict[str, Any] = {"slot": slot.isoformat(), "started": started.isoformat()}
        try:
            record.update(ok=True, **job(started))
        except Exception as exc:
            record.update(ok=False, error=f"{type(exc).__name__}: {exc}")
        log(json.dumps(record, ensure_ascii=False))
        rounds += 1
