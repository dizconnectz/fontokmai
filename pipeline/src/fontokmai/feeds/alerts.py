"""Assemble /data/v1/alerts.json from source-specific alert candidates (design 9.1)."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from fontokmai.contracts.alerts import Alert, AlertsFeed, AlertTombstone
from fontokmai.contracts.common import SourceStatus

HISTORY = timedelta(days=7)
LIVE_STATUSES = ("pending", "active")


@dataclass(frozen=True)
class AlertCandidate:
    event_id: str
    payload: dict[str, Any]  # every Alert field except `revision`
    ended_at: datetime | None  # set for expired and cancelled events


class RevisionStore(Protocol):
    def revision_for(self, key: str, content_hash: str, now: datetime) -> int: ...

    def feed_sequence_for(self, feed_hash: str, now: datetime) -> int: ...


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def content_hash(value: Any) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def assemble_alerts_feed(candidates: Iterable[AlertCandidate], store: RevisionStore, *, now: datetime,
                         generation_id: str, recovery_epoch: int,
                         source_status: list[SourceStatus]) -> AlertsFeed:
    """Live events go to `alerts`; events that ended within HISTORY become tombstones."""
    since = now - HISTORY
    alerts: list[Alert] = []
    tombstones: list[AlertTombstone] = []
    for cand in sorted(candidates, key=lambda c: c.event_id):
        revision = store.revision_for(f"alert:{cand.event_id}", content_hash(cand.payload), now)
        status = cand.payload["lifecycle_status"]
        if status in LIVE_STATUSES:
            alerts.append(Alert(revision=revision, **cand.payload))
        elif cand.ended_at is not None and cand.ended_at >= since:
            tombstones.append(AlertTombstone(event_id=cand.event_id, revision=revision,
                                             lifecycle_status=status, ended_at=cand.ended_at))
    body = {"alerts": [a.model_dump(mode="json") for a in alerts],
            "tombstones": [t.model_dump(mode="json") for t in tombstones]}
    return AlertsFeed(generation_id=generation_id, recovery_epoch=recovery_epoch, feed_generated_at=now,
                      feed_sequence=store.feed_sequence_for(content_hash(body), now), history_since=since,
                      alerts=alerts, tombstones=tombstones, source_status=source_status)
