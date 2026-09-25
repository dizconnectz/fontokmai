"""One snapshot round of the TMD CAP slice, shared by the CLI and the contract examples."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pydantic import BaseModel, ValidationError

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.common import SourceStatus
from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.road_flood import RoadFloodHistory
from fontokmai.feeds.alerts import assemble_alerts_feed
from fontokmai.publish.snapshot import write_snapshot
from fontokmai.sources.tmd_cap.collect import collect, load_messages
from fontokmai.sources.tmd_cap.fetch import Fetcher
from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from fontokmai.state import StateStore

SNAPSHOT_INTERVAL = timedelta(minutes=15)
REF_MODELS: dict[str, type[BaseModel]] = {"ref/road_flood_history.json": RoadFloodHistory}
LAST_SUCCESS_KEY = "tmd_cap.last_success_at"
RECOVERY_EPOCH_KEY = "recovery_epoch"


@dataclass(frozen=True)
class SnapshotResult:
    manifest: Manifest
    feed: AlertsFeed
    status: SourceStatus


def generation_id_for(now: datetime, writer: str) -> str:
    return f"{now.astimezone(UTC):%Y%m%dT%H%M%SZ}-{writer}"


def read_ref_files(out: Path) -> dict[str, bytes]:
    """Reference files already in the snapshot directory (built by their own jobs) that still pass their contract.

    A file that fails validation is left out of the manifest rather than published broken.
    """
    files = {}
    for rel, model in REF_MODELS.items():
        try:
            content = (out / rel).read_bytes()
            model.model_validate_json(content)
        except (OSError, ValidationError):
            continue
        files[rel] = content
    return files


def run_cap_snapshot(*, db: Path, out: Path, fetch: Fetcher, now: datetime, writer: str,
                     owner_epoch: int) -> SnapshotResult:
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    generation_id = generation_id_for(now, writer)
    with StateStore(db) as store:
        result = collect(store, fetch, now)
        if result.index_ok:
            store.set_meta(LAST_SUCCESS_KEY, now.isoformat())
        last_success = store.get_meta(LAST_SUCCESS_KEY)
        recovery_epoch = int(store.get_meta(RECOVERY_EPOCH_KEY) or "1")
        status = SourceStatus(
            source_id="tmd_cap", status=result.status, last_attempt_at=now,
            last_success_at=datetime.fromisoformat(last_success) if last_success else None,
            items_seen=result.items_seen, items_rejected=result.rejected,
            message="; ".join(result.errors[:3]) or None,
        )
        pairs = load_messages(store)
        urls = {msg.key: url for msg, url in pairs}
        candidates = alert_candidates(group_events(msg for msg, _ in pairs), urls, now)
        feed = assemble_alerts_feed(candidates, store, now=now, generation_id=generation_id,
                                    recovery_epoch=recovery_epoch, source_status=[status])
        files = {"alerts.json": feed.model_dump_json().encode("utf-8"), **read_ref_files(out)}
        manifest = write_snapshot(out, files, store,
                                  generation_id=generation_id, now=now, writer=writer,
                                  owner_epoch=owner_epoch, recovery_epoch=recovery_epoch,
                                  due=SNAPSHOT_INTERVAL, source_status=[status])
    return SnapshotResult(manifest=manifest, feed=feed, status=status)
