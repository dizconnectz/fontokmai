"""A rolling 24-hour count of calls to a free API, kept in the state database so it survives restarts.

Every attempted request is counted, also one that fails, because the service may have counted it too.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from fontokmai.sources.open_data.http import OpenDataError
from fontokmai.state import StateStore

WINDOW = timedelta(hours=24)


class BudgetExceeded(OpenDataError):
    """The next request would go over the call budget."""


class CallBudget:
    def __init__(self, store: StateStore, key: str, limit: int, window: timedelta = WINDOW) -> None:
        self._store = store
        self._key = key
        self.limit = limit
        self._window = window

    def _entries(self, now: datetime) -> list[tuple[datetime, int]]:
        raw = self._store.get_meta(self._key)
        try:
            entries = [(datetime.fromisoformat(at), int(calls)) for at, calls in json.loads(raw or "[]")]
        except (TypeError, ValueError):
            # a count we cannot read is treated as a full budget spent now: the service waits a day
            # rather than risk going over
            entries = [(now, self.limit)]
        return [(at, calls) for at, calls in entries if now - at < self._window]

    def used(self, now: datetime) -> int:
        return sum(calls for _, calls in self._entries(now))

    def allows(self, now: datetime, calls: int) -> bool:
        return self.used(now) + calls <= self.limit

    def spend(self, now: datetime, calls: int) -> None:
        """Count calls before they are made; raises BudgetExceeded instead of going over."""
        entries = self._entries(now)
        used = sum(count for _, count in entries)
        if used + calls > self.limit:
            raise BudgetExceeded(f"call budget: {used} of {self.limit} calls already used in 24 hours")
        entries.append((now, calls))
        self._store.set_meta(self._key, json.dumps([[at.isoformat(), count] for at, count in entries]))
