"""As the shared disk fills, what fontokmai keeps shrinks by itself, oldest first (user 2026-10-01)."""

import hashlib
import json
from collections import namedtuple
from datetime import UTC, datetime, timedelta

import pytest

from fontokmai import housekeeping
from fontokmai.state import StateStore

NOW = datetime(2026, 10, 1, 4, 3, tzinfo=UTC)  # 11:03 ICT
Usage = namedtuple("Usage", "total used free")
GIB = 1024**3


def _state(tmp_path):
    """A state folder with the database, 7 old backups, archive days of 1-60 days ago and Bangkok upload copies."""
    db = tmp_path / "state" / "fontokmai.db"
    with StateStore(db) as store:
        store.set_meta("k", "v")
    backups = db.parent / "backups"
    backups.mkdir()
    for day in range(20, 27):
        (backups / f"fontokmai-202609{day}.db.gz").write_bytes(b"old backup")
    out = tmp_path / "out"
    for days_ago in (60, 40, 20, 5, 1):
        when = NOW - timedelta(days=days_ago)
        raw = json.dumps({"radar": days_ago}).encode()
        (out).mkdir(exist_ok=True)
        (out / "radar.json").write_bytes(raw)
        (out / "manifest.json").write_text(json.dumps({"files": [
            {"path": "radar.json", "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}]}), encoding="utf-8")
        housekeeping.archive_round(db.parent / "archive" / "eval", out, when, {}, when)
    uploads = db.parent / "archive" / "dxs"
    uploads.mkdir(parents=True)
    for days_ago in (400, 100, 40, 10, 2):
        stamp = (NOW - timedelta(days=days_ago)).astimezone(housekeeping.ICT).strftime("%Y%m%dT%H%M%S")
        (uploads / f"{stamp}.tgz").write_bytes(b"upload")
    return db, out


def _kept(db):
    state = db.parent
    archive_days = sorted({p.name[:10] for p in (state / "archive" / "eval").glob("rounds/*.jsonl.gz")})
    backups = len(list((state / "backups").glob("*.db.gz")))
    uploads = len(list((state / "archive" / "dxs").glob("*.tgz")))
    return archive_days, backups, uploads


def _run(db, out, monkeypatch, used_share):
    monkeypatch.setattr(housekeeping.shutil, "disk_usage",
                        lambda _: Usage(100 * GIB, used_share * 100 * GIB, (1 - used_share) * 100 * GIB))
    return housekeeping.housekeeping(db, out, NOW, {}, NOW)


def test_a_roomy_disk_keeps_the_usual_amounts(tmp_path, monkeypatch):
    db, out = _state(tmp_path)
    report = _run(db, out, monkeypatch, 0.70)
    assert "pressure" not in report
    days, backups, uploads = _kept(db)
    assert len(days) == 6  # 60, 40, 20, 5 and 1 days ago, and today's round
    assert backups == 7  # the newest seven: today's and six of the old ones
    assert uploads == 4  # only the copy older than 365 days goes


@pytest.mark.parametrize(("used", "archive_days", "backups", "uploads"), [
    (0.81, ["2026-09-11", "2026-09-26", "2026-09-30", "2026-10-01"], 3, 3),  # 30 days, 3 backups, 90 days
    (0.86, ["2026-09-26", "2026-09-30"], 2, 2),  # 7 days, 2 backups, 30 days; the round is not archived
    (0.91, ["2026-09-30"], 1, 1),  # 1 day, 1 backup, 7 days
])
def test_a_filling_disk_keeps_less_oldest_first(tmp_path, monkeypatch, used, archive_days, backups, uploads):
    db, out = _state(tmp_path)
    report = _run(db, out, monkeypatch, used)
    assert report["pressure"].startswith(f"disk {used:.0%} used")
    assert _kept(db) == (archive_days, backups, uploads)
    # the database itself always stays, and the newest backup is today's
    with StateStore(db) as store:
        assert store.get_meta("k") == "v"
    assert (db.parent / "backups" / "fontokmai-20261001.db.gz").is_file()


def test_fontokmai_over_its_own_budget_keeps_less_even_on_a_roomy_disk(tmp_path, monkeypatch):
    db, out = _state(tmp_path)
    monkeypatch.setattr(housekeeping, "DATA_BUDGET", 1000)
    report = _run(db, out, monkeypatch, 0.50)
    assert "keeping 30 archive day(s), 3 backup(s), 90 days of Bangkok uploads" in report["pressure"]
    assert _kept(db)[1:] == (3, 3)


def test_the_own_files_are_counted_once_a_day(tmp_path, monkeypatch):
    """Walking every file of the state folder is for the daily round (the one that makes the backup) only."""
    db, out = _state(tmp_path)
    walks = []
    real = housekeeping.tree_bytes
    monkeypatch.setattr(housekeeping, "tree_bytes", lambda folder: walks.append(folder) or real(folder))
    _run(db, out, monkeypatch, 0.50)
    assert len(walks) == 1  # today's backup made, and the files counted with it
    report = _run(db, out, monkeypatch, 0.81)
    assert len(walks) == 1  # a later round of the day: no walk, the disk's own figures still apply
    assert report["pressure"].startswith("disk 81% used: keeping 30 archive day(s)")
