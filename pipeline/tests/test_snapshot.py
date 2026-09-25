import hashlib
from datetime import datetime, timedelta

from fontokmai.contracts.common import SourceStatus
from fontokmai.contracts.manifest import Manifest
from fontokmai.publish.snapshot import write_snapshot
from fontokmai.state import StateStore

NOW = datetime.fromisoformat("2026-09-25T18:20:00+07:00")
BASE = {"generation_id": "20260925T112000Z-local", "now": NOW, "writer": "local", "owner_epoch": 1,
        "recovery_epoch": 1, "due": timedelta(minutes=15)}


def _status(state="ok"):
    return SourceStatus(source_id="tmd_cap", status=state, last_attempt_at=NOW, last_success_at=NOW,
                        items_seen=13, items_rejected=0)


def test_snapshot_writes_files_then_matching_manifest(tmp_path):
    out = tmp_path / "out"
    with StateStore(tmp_path / "s.db") as store:
        manifest = write_snapshot(out, {"alerts.json": b'{"a":1}'}, store, source_status=[_status()], **BASE)
    on_disk = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert on_disk == manifest
    (entry,) = on_disk.files
    assert (entry.path, entry.size, entry.revision) == ("alerts.json", 7, 1)
    assert entry.sha256 == hashlib.sha256(b'{"a":1}').hexdigest()
    assert (on_disk.generation_id, on_disk.completeness) == ("20260925T112000Z-local", "complete")
    assert on_disk.next_due_at == NOW + timedelta(minutes=15)
    assert sorted(p.name for p in out.iterdir()) == ["alerts.json", "manifest.json"]


def test_file_revision_follows_content_and_degraded_source_marks_partial(tmp_path):
    out = tmp_path / "out"
    with StateStore(tmp_path / "s.db") as store:
        write_snapshot(out, {"alerts.json": b"1"}, store, source_status=[_status()], **BASE)
        same = write_snapshot(out, {"alerts.json": b"1"}, store, source_status=[_status()], **BASE)
        changed = write_snapshot(out, {"alerts.json": b"2"}, store, source_status=[_status("degraded")], **BASE)
    assert same.files[0].revision == 1
    assert (changed.files[0].revision, changed.completeness) == (2, "partial")
