"""Consumer guarantees for recovery and evaluation; only temporary SQLite/files, no network."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fontokmai import cli
from fontokmai import housekeeping as keep
from fontokmai.state import StateStore

NOW = datetime(2026, 9, 29, 5, 0, tzinfo=UTC)


def state(path, epoch, marker):
    with StateStore(path) as store:
        store.set_meta("recovery_epoch", str(epoch))
        store.set_meta("review_marker", marker)


def published(out, payload):
    raw = json.dumps(payload).encode()
    target = out / "bkk/water.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest()
    (out / "manifest.json").write_text(
        json.dumps(
            {
                "generation_id": "review-1",
                "generated_at": NOW.isoformat(),
                "files": [{"path": "bkk/water.json", "sha256": sha, "size": len(raw)}],
            }
        ),
        encoding="utf-8",
    )
    return sha


def rows(root, kind):
    return [
        row
        for path in sorted((root / kind).glob("*.jsonl.gz"))
        for row in keep.read_lines(path)
    ]


@pytest.mark.parametrize("manifest_kind", ["invalid", "missing"])
def test_restore_rejects_unusable_manifest_before_replacing_database(
    tmp_path, manifest_kind
):
    source, target = tmp_path / "source.db", tmp_path / "live.db"
    state(source, 1, "backup")
    state(target, 8, "current")
    keep.backup_db(source, tmp_path / "backups", NOW)
    manifest = tmp_path / "manifest.json"
    if manifest_kind == "invalid":
        manifest.write_text("{incomplete", encoding="utf-8")
    error = None
    try:
        cli.main(
            [
                "restore-db",
                "--backup",
                str(tmp_path / "backups/fontokmai-20260929.db.gz"),
                "--db",
                str(target),
                "--manifest",
                str(manifest),
            ]
        )
    except (ValueError, OSError, SystemExit) as exc:
        error = exc
    with StateStore(target) as store:
        marker, epoch = (
            store.get_meta("review_marker"),
            store.get_meta("recovery_epoch"),
        )
    assert (marker, epoch) == ("current", "8"), (
        "a rejected/unreadable manifest must not replace the live DB"
    )
    assert error is not None, "an explicitly supplied missing manifest must fail closed"


def test_valid_restore_moves_above_published_epoch_and_retains_backup(tmp_path):
    source, target = tmp_path / "source.db", tmp_path / "drill.db"
    state(source, 2, "saved")
    keep.backup_db(source, tmp_path / "backups", NOW)
    backup = tmp_path / "backups/fontokmai-20260929.db.gz"
    before = backup.read_bytes()
    manifest = tmp_path / "manifest.json"
    manifest.write_text('{"recovery_epoch": 9}', encoding="utf-8")
    assert (
        cli.main(
            [
                "restore-db",
                "--backup",
                str(backup),
                "--db",
                str(target),
                "--manifest",
                str(manifest),
            ]
        )
        == 0
    )
    with StateStore(target) as store:
        assert (store.get_meta("recovery_epoch"), store.get_meta("review_marker")) == (
            "10",
            "saved",
        )
    assert backup.read_bytes() == before


def test_retention_keeps_input_versions_needed_by_retained_rounds(
    tmp_path, monkeypatch
):
    out, root = tmp_path / "out", tmp_path / "eval"
    sha = published(out, {"observed_at": NOW.isoformat(), "stations": []})
    keep.archive_round(root, out, NOW, {"published": "first"}, NOW)
    later = NOW + timedelta(days=2)
    keep.archive_round(root, out, later, {"published": "second"}, later)
    # Accelerate the retention boundary; the input did not change at that boundary.
    monkeypatch.setattr(keep, "ARCHIVE_DAYS", 1)
    keep.prune_archive(root, later)
    keep.archive_round(root, out, later + timedelta(minutes=15), {}, later)
    assert rows(root, "rounds"), "the review must retain a round using this input"
    assert any(v["sha256"] == sha for v in rows(root, "versions")), (
        "retained round has no input payload"
    )


def test_archive_budget_is_bounded_even_when_only_today_remains(tmp_path, monkeypatch):
    out, root = tmp_path / "out", tmp_path / "eval"
    published(out, {"stations": []})
    keep.archive_round(root, out, NOW, {}, NOW)
    monkeypatch.setattr(keep, "ARCHIVE_MAX_BYTES", 128)
    keep.prune_archive(root, NOW)
    daily_bytes = sum(p.stat().st_size for p in root.glob("*/*.jsonl.gz"))
    assert daily_bytes <= 128, "current-day archive bypasses the documented maximum"


def test_daily_backup_still_runs_when_remote_publication_fails(tmp_path, monkeypatch):
    db, out = tmp_path / "state/fontokmai.db", tmp_path / "out"
    state(db, 1, "latest-collected")
    published(out, {"stations": []})
    monkeypatch.setattr(cli, "LiveFetcher", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(
        cli,
        "run_cap_snapshot",
        lambda **kwargs: SimpleNamespace(
            manifest=SimpleNamespace(generation_id="review-1")
        ),
    )
    monkeypatch.setattr(cli, "_summary", lambda _: {"generation_id": "review-1"})

    def unavailable(*args, **kwargs):
        raise OSError("synthetic publication outage")

    monkeypatch.setattr(cli, "publish_snapshot", unavailable)
    args = cli._parse_args(
        [
            "schedule",
            "--db",
            str(db),
            "--out",
            str(out),
            "--publish-remote",
            "https://example.invalid/review.git",
            "--publish-work",
            str(tmp_path / "publish"),
        ]
    )
    try:
        cli._scheduled_job(args)(NOW)
    except OSError as exc:
        assert "synthetic publication outage" in str(exc)
    assert (db.parent / "backups/fontokmai-20260929.db.gz").exists()


def test_archived_values_retain_null_and_observation_time(tmp_path):
    out, root = tmp_path / "out", tmp_path / "eval"
    data = {
        "fetched_at": NOW.isoformat(),
        "stations": [
            {"observed_at": (NOW - timedelta(hours=1)).isoformat(), "level_m": None},
            {"observed_at": NOW.isoformat(), "level_m": 0},
        ],
    }
    sha = published(out, data)
    keep.archive_round(
        root, out, NOW, {"published": "commit-id"}, NOW + timedelta(minutes=2)
    )
    version = rows(root, "versions")[0]
    round_ = rows(root, "rounds")[0]
    assert version["data"] == data
    assert version["sha256"] == round_["files"]["bkk/water.json"][0] == sha
    assert round_["published"] == "commit-id"
