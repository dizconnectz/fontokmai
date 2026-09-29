import gzip
import hashlib
import json
import sqlite3
from collections import namedtuple
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest

from fontokmai import housekeeping
from fontokmai.housekeeping import (
    archive_round,
    backup_db,
    prune_archive,
    prune_cap,
    read_lines,
    restore_db,
)
from fontokmai.state import StateStore

NOW = datetime(2026, 9, 29, 5, 3, tzinfo=UTC)  # 12:03 ICT
Usage = namedtuple("Usage", "total used free")


@pytest.fixture(autouse=True)
def roomy_disk(monkeypatch):
    """Plenty of free space, whatever the machine running the tests has; a test can make it less."""
    monkeypatch.setattr(housekeeping.shutil, "disk_usage", lambda _: Usage(100 * 1024**3, 0, 100 * 1024**3))


class _Fixtures:
    """The CAP fixtures in place of the live fetcher of the scheduled job."""

    def __call__(self, url):
        from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
        from helpers import FIXTURES

        return fixture_fetcher(FIXTURES)(url)

    def close(self):
        pass


@contextmanager
def _offline(url):
    from fontokmai.sources.open_data.http import OpenDataError

    raise OpenDataError("offline")
    yield  # pragma: no cover


def _store(db, *sent_days_ago):
    with StateStore(db) as store:
        for index, days in enumerate(sent_days_ago):
            sent = NOW - timedelta(days=days)
            store.add_cap_document(identifier=f"id-{index}", sender="tmd", sent=sent, raw=f"<cap {index}/>".encode(),
                                   source_url=f"https://example.test/{index}.xml", seen_at=sent)
        store.set_meta("k", "v")


def _identifiers(db):
    conn = sqlite3.connect(db)
    try:
        return sorted(row[0] for row in conn.execute("SELECT identifier FROM cap_documents"))
    finally:
        conn.close()


def test_backup_once_a_day_restores_to_the_same_rows(tmp_path):
    db, backups = tmp_path / "state" / "fontokmai.db", tmp_path / "state" / "backups"
    _store(db, 1, 2)
    note = backup_db(db, backups, NOW)
    assert note.startswith("backup fontokmai-20260929.db.gz")
    assert backup_db(db, backups, NOW + timedelta(hours=1)) is None  # the same Thai day
    _store(db, 3)  # a change after the backup is not in it
    restored = tmp_path / "restored.db"
    restore_db(backups / "fontokmai-20260929.db.gz", restored)
    assert _identifiers(restored) == ["id-0", "id-1"]


def test_the_thai_date_names_the_backup_and_seven_are_kept(tmp_path):
    db, backups = tmp_path / "fontokmai.db", tmp_path / "backups"
    _store(db, 1)
    # 17:30 UTC is already the next day in Thailand
    assert "fontokmai-20260930.db.gz" in backup_db(db, backups, datetime(2026, 9, 29, 17, 30, tzinfo=UTC))
    for day in range(1, 10):
        backup_db(db, backups, datetime(2026, 10, day, 5, tzinfo=UTC))
    kept = sorted(p.name for p in backups.glob("*.db.gz"))
    assert kept == [f"fontokmai-202610{day:02d}.db.gz" for day in range(3, 10)]
    assert not list(backups.glob("tmp*"))  # the work folder is gone


def test_a_broken_backup_is_refused_and_the_database_stays(tmp_path):
    db = tmp_path / "fontokmai.db"
    _store(db, 1)
    broken = tmp_path / "broken.db.gz"
    broken.write_bytes(gzip.compress(b"not a database" * 100))
    with pytest.raises(ValueError, match="broken.db.gz: integrity"):
        restore_db(broken, db)
    assert _identifiers(db) == ["id-0"]
    assert not (tmp_path / "fontokmai.db.restoring").exists()


def test_cap_documents_older_than_half_a_year_are_deleted(tmp_path):
    db = tmp_path / "fontokmai.db"
    _store(db, 1, 179, 181, 400)
    assert prune_cap(db, NOW) == "2 CAP document(s) older than 180 days deleted"
    assert _identifiers(db) == ["id-0", "id-1"]
    assert prune_cap(db, NOW) is None
    with StateStore(db) as store:  # the store still opens and keeps its other tables
        assert store.get_meta("k") == "v"


def _publish(out, files, *, floods=None, generation="g1"):
    """A snapshot folder as a round leaves it: the files and a manifest naming their hashes."""
    entries = []
    for path, value in files.items():
        raw = json.dumps(value).encode()
        (out / path).parent.mkdir(parents=True, exist_ok=True)
        (out / path).write_bytes(raw)
        entries.append({"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw), "revision": 1})
    if floods is not None:
        (out / "live").mkdir(parents=True, exist_ok=True)
        (out / "live" / "floods.json").write_text(json.dumps(
            {"fetched_at": NOW.isoformat(), "reports": floods}), encoding="utf-8")
    (out / "manifest.json").write_text(json.dumps({
        "schema_version": "1", "generation_id": generation, "generated_at": NOW.isoformat(),
        "completeness": "complete", "files": entries,
        "source_status": [{"source_id": "tmd_cap", "status": "ok"}]}), encoding="utf-8")


def _report(id_, title="น้ำท่วม ถนนรัชดาภิเษก"):
    return {"id": id_, "title_th": title, "road_th": None, "location": [100.5, 13.7], "start": NOW.isoformat(),
            "stop": None, "reporter": "public", "url": f"https://traffic.longdo.com/event/{id_}"}


def test_a_round_line_every_round_and_a_version_only_when_the_file_changes(tmp_path):
    out, root = tmp_path / "out", tmp_path / "eval"
    overview = {"rules": "v0", "now": [], "next": []}
    _publish(out, {"summary/overview.json": overview, "forecast/rain.json": {"run": 1}, "radar.json": {"f": 1}})
    archive_round(root, out, NOW, {"published": "abc123"}, NOW)
    _publish(out, {"summary/overview.json": overview, "forecast/rain.json": {"run": 1}, "radar.json": {"f": 2}},
             generation="g2")
    note = archive_round(root, out, NOW + timedelta(minutes=15), {}, NOW + timedelta(minutes=15))
    assert note == "archive +1 version(s) +0 flood line(s)"
    rounds = read_lines(root / "rounds" / "2026-09-29.jsonl.gz")
    assert [r["generation_id"] for r in rounds] == ["g1", "g2"]
    assert rounds[0]["published"] == "abc123" and rounds[0]["overview"] == overview
    assert set(rounds[0]["files"]) == {"summary/overview.json", "forecast/rain.json", "radar.json"}
    versions = read_lines(root / "versions" / "2026-09-29.jsonl.gz")
    assert [(v["path"], v["data"]) for v in versions] == [
        ("forecast/rain.json", {"run": 1}), ("radar.json", {"f": 1}), ("radar.json", {"f": 2})]
    assert versions[0]["first_seen"] == NOW.isoformat()


def test_a_file_replaced_after_the_round_is_kept_under_its_own_hash_next_round(tmp_path):
    out, root = tmp_path / "out", tmp_path / "eval"
    _publish(out, {"bkk/water.json": {"v": 1}})
    (out / "bkk" / "water.json").write_text('{"v": 2}', encoding="utf-8")  # update-bkk.sh, between the two
    archive_round(root, out, NOW, {}, NOW)
    assert not (root / "versions" / "2026-09-29.jsonl.gz").exists()
    _publish(out, {"bkk/water.json": {"v": 2}})
    archive_round(root, out, NOW, {}, NOW)
    assert [v["data"] for v in read_lines(root / "versions" / "2026-09-29.jsonl.gz")] == [{"v": 2}]


def test_flood_reports_first_seen_changed_and_gone_from_the_feed(tmp_path):
    out, root = tmp_path / "out", tmp_path / "eval"
    _publish(out, {}, floods=[_report("longdo:1"), _report("longdo:2")])
    archive_round(root, out, NOW, {}, NOW)
    archive_round(root, out, NOW, {}, NOW)  # nothing new
    _publish(out, {}, floods=[_report("longdo:1", "น้ำท่วมสูง ถนนรัชดาภิเษก")])
    archive_round(root, out, NOW, {}, NOW)
    lines = read_lines(root / "floods" / "2026-09-29.jsonl.gz")
    assert [(line["event"], line["id"]) for line in lines] == [
        ("first_seen", "longdo:1"), ("first_seen", "longdo:2"), ("changed", "longdo:1"),
        ("gone_from_feed", "longdo:2")]
    assert lines[2]["title_th"] == "น้ำท่วมสูง ถนนรัชดาภิเษก" and lines[0]["reporter"] == "public"
    (out / "live" / "floods.json").unlink()  # a round without the file says nothing about the reports
    archive_round(root, out, NOW, {}, NOW)
    assert len(read_lines(root / "floods" / "2026-09-29.jsonl.gz")) == 4


def test_the_archive_keeps_ninety_days_and_its_size_cap_but_never_today(tmp_path, monkeypatch):
    root = tmp_path / "eval"
    for days_ago in (0, 1, 2, 91, 120):
        day = (NOW - timedelta(days=days_ago)).astimezone(housekeeping.ICT).strftime("%Y-%m-%d")
        for kind in ("rounds", "versions"):
            (root / kind).mkdir(parents=True, exist_ok=True)
            (root / kind / f"{day}.jsonl.gz").write_bytes(b"x" * 1000)
    assert prune_archive(root, NOW) == "archive: 4 old file(s) deleted"
    monkeypatch.setattr(housekeeping, "ARCHIVE_MAX_BYTES", 3000)
    prune_archive(root, NOW)
    assert sorted(p.name for p in root.glob("*/*.gz")) == [
        "2026-09-28.jsonl.gz", "2026-09-29.jsonl.gz", "2026-09-29.jsonl.gz"]
    monkeypatch.setattr(housekeeping, "ARCHIVE_MAX_BYTES", 10)
    prune_archive(root, NOW)
    assert sorted(p.name for p in root.glob("*/*.gz")) == ["2026-09-29.jsonl.gz", "2026-09-29.jsonl.gz"]


def test_the_archive_stops_at_the_reserve_of_the_shared_disk(tmp_path, monkeypatch):
    db, out = tmp_path / "state" / "fontokmai.db", tmp_path / "out"
    _store(db, 1)
    _publish(out, {"radar.json": {"f": 1}})
    gib = 1024**3
    monkeypatch.setattr(housekeeping.shutil, "disk_usage", lambda _: Usage(100 * gib, 86 * gib, 14 * gib))
    report = housekeeping.housekeeping(db, out, NOW, {})
    # 14% free is below the 15% reserve of design 4.9: no archive; the daily backup replaces the oldest, so it stays
    assert report["skipped"] == "archive not written: less than 15% of the shared disk is free"
    assert report["warning"] == "the shared disk is 86% full" and report["disk_free_gb"] == 14.0
    assert (tmp_path / "state" / "backups" / "fontokmai-20260929.db.gz").is_file()
    assert not (tmp_path / "state" / "archive" / "eval" / "rounds").exists()
    monkeypatch.setattr(housekeeping.shutil, "disk_usage", lambda _: Usage(100 * gib, 70 * gib, 30 * gib))
    report = housekeeping.housekeeping(db, out, NOW, {})
    assert "skipped" not in report and "warning" not in report
    assert (tmp_path / "state" / "archive" / "eval" / "rounds" / "2026-09-29.jsonl.gz").is_file()


def test_housekeeping_backs_up_once_a_day_and_archives_every_round(tmp_path):
    db, out = tmp_path / "state" / "fontokmai.db", tmp_path / "out"
    _store(db, 1, 200)
    _publish(out, {"radar.json": {"f": 1}})
    first = housekeeping.housekeeping(db, out, NOW, {}, NOW)
    assert "1 CAP document(s) older than 180 days deleted" in first["done"]
    assert "backup fontokmai-20260929.db.gz" in first["done"] and "archive_mb" in first
    second = housekeeping.housekeeping(db, out, NOW + timedelta(minutes=15), {}, NOW + timedelta(minutes=15))
    assert second["done"] == "archive +0 version(s) +0 flood line(s)" and "archive_mb" not in second
    assert len(read_lines(tmp_path / "state" / "archive" / "eval" / "rounds" / "2026-09-29.jsonl.gz")) == 2


def test_the_scheduled_job_ends_with_housekeeping(tmp_path, monkeypatch):
    from fontokmai import cli

    monkeypatch.setattr(cli, "LiveFetcher", _Fixtures)
    monkeypatch.setattr(cli, "open_url", _offline)
    monkeypatch.setenv("FONTOKMAI_CODE", "e2d0897")
    db, out = tmp_path / "state" / "fontokmai.db", tmp_path / "out" / "data" / "v1"
    args = cli._parse_args(["schedule", "--db", str(db), "--out", str(out)])
    summary = cli._scheduled_job(args)(datetime(2026, 9, 25, 11, 20, tzinfo=UTC))
    assert "backup fontokmai-20260925.db.gz" in summary["keep"]["done"]
    rounds = read_lines(tmp_path / "state" / "archive" / "eval" / "rounds" / "2026-09-25.jsonl.gz")
    assert rounds[0]["code"] == "e2d0897" and rounds[0]["generation_id"] == summary["generation_id"]


def test_a_failing_housekeeping_never_fails_the_round(tmp_path, monkeypatch):
    from fontokmai import cli

    def broken(*args, **kwargs):
        raise OSError("disk gone")

    monkeypatch.setattr(cli, "LiveFetcher", _Fixtures)
    monkeypatch.setattr(cli, "open_url", _offline)
    monkeypatch.setattr(cli, "housekeeping", broken)
    args = cli._parse_args(["schedule", "--db", str(tmp_path / "s.db"), "--out", str(tmp_path / "v1")])
    summary = cli._scheduled_job(args)(datetime(2026, 9, 25, 11, 20, tzinfo=UTC))
    assert summary["keep"] == {"error": "OSError: disk gone"} and summary["alerts"] == 3


def test_restore_db_command(tmp_path, capsys):
    from fontokmai.cli import main

    db = tmp_path / "state" / "fontokmai.db"
    _store(db, 1, 2)
    backup_db(db, tmp_path / "backups", NOW)
    target = tmp_path / "drill" / "fontokmai.db"
    target.parent.mkdir()
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"recovery_epoch": 3}), encoding="utf-8")
    assert main(["restore-db", "--backup", str(tmp_path / "backups" / "fontokmai-20260929.db.gz"),
                 "--db", str(target), "--manifest", str(manifest)]) == 0
    result = json.loads(capsys.readouterr().out)
    # the web has seen epoch 3: the restored state publishes under 4, so the web reads the feed again
    assert (result["cap_documents"], result["recovery_epoch"]) == (2, 4)
    with StateStore(target) as store:
        assert store.get_meta("recovery_epoch") == "4"
