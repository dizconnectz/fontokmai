"""Run a job on the fixed 15-minute grid of design 4.3: :03, :18, :33 and :48 past each hour (same in UTC and ICT)."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

SLOT_MINUTES = (3, 18, 33, 48)
RESTART_EXIT = 75  # EX_TEMPFAIL: ended on purpose, to be started again
# a round takes seconds, about 3 minutes with the forecast refreshes; one still running after this is stuck (a
# download or git that hangs), and the restarts at the end of a round never come (2026-10-02 review)
ROUND_LIMIT = timedelta(minutes=30)


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


def end_stuck_round(record: dict[str, Any], log: Callable[[str], None]) -> None:
    """The round is logged as stuck and the process ends at once, whatever its main thread waits on: Docker's
    restart policy starts the collector again (a stuck SQLite write rolls back; files are written by rename)."""
    log(json.dumps({**record, "ok": False, "error": f"the round was still running after {ROUND_LIMIT}",
                    "restart": "stuck round"}, ensure_ascii=False))
    sys.stdout.flush()
    os._exit(RESTART_EXIT)


def run_forever(job: Callable[[datetime], dict[str, Any]], *, clock: Callable[[], datetime] = _utc_now,
                sleep: Callable[[float], None] = time.sleep, log: Callable[[str], None] = print,
                max_rounds: int | None = None, round_limit: timedelta = ROUND_LIMIT,
                on_stuck: Callable[[dict[str, Any], Callable[[str], None]], None] = end_stuck_round) -> None:
    """Sleep until each slot and run the job. A failing round is logged and the schedule continues,
    because a stopped scheduler is worse than one failed round (stale data stays visible on the web). A round
    still running after `round_limit` goes to `on_stuck`, from a watchdog thread."""
    rounds = 0
    while max_rounds is None or rounds < max_rounds:
        slot = next_slot(clock())
        delay = (slot - clock()).total_seconds()
        if delay > 0:
            sleep(delay)
        started = clock()
        record: dict[str, Any] = {"slot": slot.isoformat(), "started": started.isoformat()}
        watchdog = threading.Timer(round_limit.total_seconds(), on_stuck, args=(dict(record), log))
        watchdog.daemon = True
        watchdog.start()
        try:
            record.update(ok=True, **job(started))
        except Exception as exc:
            # a round that failed part way may say what it did before (round_summary, e.g. its backup)
            record.update(getattr(exc, "round_summary", {}))
            record.update(ok=False, error=f"{type(exc).__name__}: {exc}")
        finally:
            watchdog.cancel()
        log(json.dumps(record, ensure_ascii=False))
        if record.get("restart"):
            # the round asked for a fresh start (publishing failed round after round, or the process limit is
            # near): the process ends and Docker's restart policy starts the collector again
            raise SystemExit(RESTART_EXIT)
        rounds += 1
