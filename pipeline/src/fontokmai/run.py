"""One snapshot round of the TMD CAP slice, shared by the CLI and the contract examples."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from importlib import resources
from pathlib import Path

from pydantic import BaseModel, ValidationError

from fontokmai.contracts.alerts import Alert, AlertsFeed
from fontokmai.contracts.cctv import CctvRegistry
from fontokmai.contracts.common import SourceStatus
from fontokmai.contracts.forecast import RainForecast
from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.contracts.radar import RadarFeed
from fontokmai.contracts.road_flood import RoadFloodHistory
from fontokmai.feeds.alerts import LIVE_STATUSES, AlertCandidate, assemble_alerts_feed
from fontokmai.publish.snapshot import atomic_write, write_snapshot
from fontokmai.sources.open_data import longdo_live
from fontokmai.sources.open_data.http import Opener
from fontokmai.sources.tmd_cap.collect import collect, load_messages
from fontokmai.sources.tmd_cap.fetch import Fetcher
from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from fontokmai.sources.tmd_radar import SOURCE_ID as RADAR_SOURCE_ID
from fontokmai.sources.tmd_radar import collect_radar, prune_frames
from fontokmai.state import StateStore

SNAPSHOT_INTERVAL = timedelta(minutes=15)
REF_MODELS: dict[str, type[BaseModel]] = {"ref/road_flood_history.json": RoadFloodHistory,
                                          "ref/cctv.json": CctvRegistry,
                                          "ref/places.json": PlaceGazetteer,
                                          "forecast/rain.json": RainForecast}
# curated files shipped with the package and copied into every snapshot
STATIC_REFS = {"ref/cctv.json": "cctv.json", "ref/places.json": "places.json"}
LAST_SUCCESS_KEY = "tmd_cap.last_success_at"
RADAR_SUCCESS_KEY = "tmd_radar.last_success_at"
FLOODS_SUCCESS_KEY = "longdo_floods.last_success_at"
RECOVERY_EPOCH_KEY = "recovery_epoch"


@dataclass(frozen=True)
class SnapshotResult:
    manifest: Manifest
    feed: AlertsFeed
    status: SourceStatus
    radar: RadarFeed | None = None


def generation_id_for(now: datetime, writer: str) -> str:
    return f"{now.astimezone(UTC):%Y%m%dT%H%M%SZ}-{writer}"


def sync_static_refs(out: Path) -> None:
    """Copy the curated reference files of this release into the snapshot directory when they differ."""
    for rel, name in STATIC_REFS.items():
        content = resources.files("fontokmai.ref_data").joinpath(name).read_bytes()
        REF_MODELS[rel].model_validate_json(content)
        target = out / rel
        if not target.is_file() or target.read_bytes() != content:
            atomic_write(target, content)


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


def _valid_candidates(candidates: list[AlertCandidate]) -> tuple[list[AlertCandidate], list[str]]:
    """Candidates whose live payload passes the Alert contract, and a note for each one that does not."""
    valid, broken = [], []
    for candidate in candidates:
        if candidate.payload["lifecycle_status"] in LIVE_STATUSES:
            try:
                Alert(revision=1, **candidate.payload)
            except ValidationError as exc:
                field = ".".join(str(part) for part in exc.errors()[0]["loc"])
                broken.append(f"{candidate.event_id}: {field} {exc.errors()[0]['msg']}"[:200])
                continue
        valid.append(candidate)
    return valid, broken


def run_cap_snapshot(*, db: Path, out: Path, fetch: Fetcher, now: datetime, writer: str,
                     owner_epoch: int, radar_fetch: Fetcher | None = None,
                     floods_opener: Opener | None = None) -> SnapshotResult:
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    generation_id = generation_id_for(now, writer)
    with StateStore(db) as store:
        result = collect(store, fetch, now)
        pairs = load_messages(store)
        urls = {msg.key: url for msg, url in pairs}
        candidates = alert_candidates(group_events(msg for msg, _ in pairs), urls, now)
        # an event whose content breaks the contract is left out and reported, never the whole round
        candidates, broken = _valid_candidates(candidates)
        if broken:
            result.rejected += len(broken)
            result.errors.extend(broken)
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
        feed = assemble_alerts_feed(candidates, store, now=now, generation_id=generation_id,
                                    recovery_epoch=recovery_epoch, source_status=[status])
        sync_static_refs(out)
        files = {"alerts.json": feed.model_dump_json().encode("utf-8"), **read_ref_files(out)}
        statuses = [status]
        radar = collect_radar(radar_fetch, out, generation_id) if radar_fetch is not None else None
        if radar is not None:
            if radar.ok:
                store.set_meta(RADAR_SUCCESS_KEY, now.isoformat())
            radar_success = store.get_meta(RADAR_SUCCESS_KEY)
            statuses.append(SourceStatus(
                source_id=RADAR_SOURCE_ID, status="ok" if radar.ok else "failed", last_attempt_at=now,
                last_success_at=datetime.fromisoformat(radar_success) if radar_success else None,
                items_seen=radar.frames_seen, items_rejected=radar.rejected, message=radar.message,
            ))
            files.update(radar.files)
        if floods_opener is not None:
            floods = longdo_live.collect_floods(floods_opener, out, now)
            if floods.ok:
                store.set_meta(FLOODS_SUCCESS_KEY, now.isoformat())
            floods_success = store.get_meta(FLOODS_SUCCESS_KEY)
            statuses.append(SourceStatus(
                source_id=longdo_live.SOURCE_ID, status="ok" if floods.ok else "failed", last_attempt_at=now,
                last_success_at=datetime.fromisoformat(floods_success) if floods_success else None,
                items_seen=floods.seen, items_rejected=floods.rejected, message=floods.message,
            ))
            if floods.feed is not None:
                files[longdo_live.FILE_PATH] = floods.feed.model_dump_json().encode("utf-8")
        manifest = write_snapshot(out, files, store,
                                  generation_id=generation_id, now=now, writer=writer,
                                  owner_epoch=owner_epoch, recovery_epoch=recovery_epoch,
                                  due=SNAPSHOT_INTERVAL, source_status=statuses)
        if radar is not None:
            prune_frames(out, radar.feed)
    return SnapshotResult(manifest=manifest, feed=feed, status=status, radar=radar.feed if radar else None)
