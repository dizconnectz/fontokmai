"""Run a job on the fixed 15-minute grid of design 4.3: :03, :18, :33 and :48 past each hour (same in UTC and ICT).

Between slots a check may start the round early (user 2026-10-09: the radar on the site was 20–35 minutes old,
mostly waiting for the next slot after TMD had posted the frame): when `ready` says new data is there, the round runs
at once, and a slot that would come within MIN_GAP of it is skipped, so the rounds stay about four an hour and the
grid takes over whenever the check says nothing (a source that stopped)."""

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
PROBE_EVERY = timedelta(minutes=1)  # how often `ready` is asked between slots (it asks the source only when due)
MIN_GAP = timedelta(minutes=10)  # no round starts sooner than this after the last one began
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
                on_stuck: Callable[[dict[str, Any], Callable[[str], None]], None] = end_stuck_round,
                ready: Callable[[datetime], bool] | None = None, probe_every: timedelta = PROBE_EVERY,
                min_gap: timedelta = MIN_GAP) -> None:
    """Sleep until each slot and run the job; between slots, start it early once `ready` says new data is there
    (a check that fails counts as not ready). A failing round is logged and the schedule continues, because a
    stopped scheduler is worse than one failed round (stale data stays visible on the web). A round still running
    after `round_limit` goes to `on_stuck`, from a watchdog thread."""
    rounds = 0
    last: datetime | None = None
    while max_rounds is None or rounds < max_rounds:
        slot = next_slot(clock())
        # a slot right after a round that started early is skipped: about four rounds an hour, as before
        while last is not None and slot - last < min_gap:
            slot = next_slot(slot)
        early = False
        delay = (slot - clock()).total_seconds()
        waited = 0.0
        # the wait ends at the slot by the clock, or once the sleeps add up to it (a clock that does not move, as in
        # a test, must not keep the loop going)
        while (remaining := min(delay - waited, (slot - clock()).total_seconds())) > 0:
            now = clock()
            if ready is not None and (last is None or now - last >= min_gap):
                try:
                    early = bool(ready(now))
                except Exception:  # noqa: BLE001 - a check that cannot tell is not ready; the slot still comes
                    early = False
                if early:
                    break
            step = min(remaining, probe_every.total_seconds()) if ready is not None else remaining
            sleep(step)
            waited += step
        started = clock()
        last = started
        record: dict[str, Any] = {"slot": (started if early else slot).isoformat(), "started": started.isoformat()}
        if early:
            record["early"] = "new data ready before the slot"
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
