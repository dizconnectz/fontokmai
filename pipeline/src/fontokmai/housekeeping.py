"""What fontokmai keeps on the VPS, and no more (P0-B2, design 4.9): run at the end of every round.

- once a Thai day: raw CAP documents sent more than CAP_KEEP ago are deleted, then the state database is backed up
  (SQLite's own online copy, checked, gzip) and the newest BACKUP_KEEP backups are kept; the computer that sends the
  Bangkok files copies the newest one off the machine (~/.fontokmai/update-bkk.sh)
- the archive for checking accuracy later (docs/design/accuracy-evaluation.md §2), one .jsonl.gz a day each:
  rounds/    one line a round: times, code and data commit, file hashes, source status, the whole summary
  versions/  every new version of the files the rules read, once, when it is first seen here (by sha256)
  floods/    every flood report when first seen, when what it says changes, and when it leaves the feed
  kept ARCHIVE_DAYS days and at most ARCHIVE_MAX_BYTES: a day may add ARCHIVE_MAX_BYTES / ARCHIVE_DAYS, and what
  goes first is the oldest day; the computer that sends the Bangkok files copies the finished days, and keeps them
- design 4.9: the disk is shared with other work. Below DISK_RESERVE free, the archive is not written (the daily
  backup is: it takes the place of the oldest one); from DISK_WARN used, the round log says so
- and as that disk fills, what fontokmai keeps shrinks by itself, oldest first (PRESSURE_TIERS, user 2026-10-01): the
  archive, the backups and the copies of the Bangkok uploads; the state database itself always stays. The same
  happens when fontokmai's own files pass DATA_BUDGET, whatever the disk
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ICT = timezone(timedelta(hours=7))
DISK_RESERVE = 0.15  # share of the whole disk that stays free (design 4.9 DISK_RESERVE)
DISK_WARN = 0.80  # share used at which the round log warns (design 4.9; there is no one to page yet)
BACKUP_KEEP = 7
CAP_KEEP = timedelta(days=180)  # the alert feed reads 7 days; the rest is the record of what was announced
ARCHIVE_DAYS = 90
ARCHIVE_MAX_BYTES = 300 * 1024**2
DXS_UPLOADS_DAYS = 365  # copies of each Bangkok upload (update-bkk.sh keeps them as long)
# (share of the shared disk in use, archive days, backups kept, Bangkok upload copies in days): the first that the
# disk has reached applies. fontokmai uses well under 1 GB of it, so this mostly makes room for other work
PRESSURE_TIERS = ((0.90, 1, 1, 7), (0.85, 7, 2, 30), (0.80, 30, 3, 90))
DATA_BUDGET = 1024**3  # fontokmai's files under the state folder; over it, the last tier applies anyway
# the files the rules and the forecasts read; they change when their source does, most of them not every round.
# Not kept: alerts.json (its CAP documents are in the database), radar images, and the reference files.
VERSIONED = ("forecast/rain.json", "forecast/rivers.json", "radar.json", "bkk/water.json", "bkk/rain.json",
             "bkk/flooding.json", "bkk/news.json", "water/dams.json", "weather/today.json")
FLOOD_FACTS = ("id", "title_th", "road_th", "location", "start", "stop", "reporter", "url")


def _day(now: datetime) -> str:
    return now.astimezone(ICT).strftime("%Y-%m-%d")


def _integrity(path: Path) -> str:
    """'ok', or what SQLite finds wrong with the file."""
    conn = sqlite3.connect(path)
    try:
        return conn.execute("PRAGMA integrity_check").fetchone()[0]
    except sqlite3.DatabaseError as exc:
        return str(exc)
    finally:
        conn.close()


def backup_db(db: Path, backups: Path, now: datetime, keep: int | None = None) -> str | None:
    """Today's backup (Thai date), when there is none yet: an online copy, checked before it is kept."""
    target = backups / f"fontokmai-{_day(now).replace('-', '')}.db.gz"
    if target.exists() or not db.exists():
        return None
    backups.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=backups) as work:
        copy = Path(work) / "copy.db"
        source = sqlite3.connect(db)
        destination = sqlite3.connect(copy)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        state = _integrity(copy)
        if state != "ok":
            return f"backup refused: integrity {state[:100]}"
        partial = Path(work) / "backup.gz"
        with copy.open("rb") as raw, gzip.open(partial, "wb", compresslevel=6) as packed:
            shutil.copyfileobj(raw, packed)
        partial.replace(target)
    prune_backups(backups, BACKUP_KEEP if keep is None else keep)
    return f"backup {target.name} {target.stat().st_size // 1024} KB"


def prune_backups(backups: Path, keep: int) -> str | None:
    """Only the newest `keep` daily backups stay (at least one)."""
    old = sorted(backups.glob("fontokmai-*.db.gz"))[:-max(keep, 1)]
    for path in old:
        path.unlink()
    return f"{len(old)} old backup(s) deleted" if old else None


def prune_uploads(uploads: Path, now: datetime, days: int) -> str | None:
    """Copies of the Bangkok uploads (YYYYMMDDTHHMMSS.tgz, written by update-bkk.sh) older than `days` go."""
    cutoff = (now - timedelta(days=days)).astimezone(ICT).strftime("%Y%m%dT%H%M%S")
    old = [path for path in uploads.glob("*.tgz") if path.stem < cutoff] if uploads.is_dir() else []
    for path in old:
        path.unlink()
    return f"{len(old)} Bangkok upload copies older than {days} days deleted" if old else None


def tree_bytes(folder: Path) -> int:
    return sum(path.stat().st_size for path in folder.rglob("*") if path.is_file()) if folder.exists() else 0


def restore_db(backup: Path, db: Path, above_epoch: int = 0) -> int:
    """Put a backup in place of the database (the collector must be stopped). Everything is done on a copy first:
    decompress, check, and a recovery epoch above both the backup's and `above_epoch` (the published manifest's,
    design 4.4 item 14); the live file is replaced only when all of it worked (Codex M30). Returns the new epoch."""
    from fontokmai.run import RECOVERY_EPOCH_KEY  # the round reads the epoch under this key

    partial = db.with_name(db.name + ".restoring")
    try:
        with gzip.open(backup, "rb") as packed, partial.open("wb") as raw:
            shutil.copyfileobj(packed, raw)
        state = _integrity(partial)
        if state != "ok":
            raise ValueError(f"{backup.name}: integrity {state[:100]}")
        conn = sqlite3.connect(partial)
        try:
            with conn:
                conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                row = conn.execute("SELECT value FROM meta WHERE key = ?", (RECOVERY_EPOCH_KEY,)).fetchone()
                epoch = max(int(row[0]) if row else 1, above_epoch) + 1
                conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (RECOVERY_EPOCH_KEY, str(epoch)))
        finally:
            conn.close()
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    for extra in (db.with_name(db.name + "-wal"), db.with_name(db.name + "-shm")):
        extra.unlink(missing_ok=True)
    partial.replace(db)
    return epoch


def published_epoch(manifest: Path) -> int:
    """recovery_epoch of a published manifest.json; ValueError when the file is missing or not a manifest."""
    try:
        epoch = json.loads(manifest.read_text(encoding="utf-8"))["recovery_epoch"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"{manifest}: not a readable manifest ({type(exc).__name__}: {exc})") from exc
    if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 1:
        raise ValueError(f"{manifest}: recovery_epoch {epoch!r} is not a positive whole number")
    return epoch


def prune_cap(db: Path, now: datetime) -> str | None:
    """Delete raw CAP documents sent more than CAP_KEEP ago, then give the space back."""
    if not db.exists():
        return None
    conn = sqlite3.connect(db)
    try:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'cap_documents'").fetchone():
            return None
        cutoff = (now - CAP_KEEP).astimezone(UTC)
        old = [identifier for identifier, sent in conn.execute("SELECT identifier, sent FROM cap_documents")
               if _aware(datetime.fromisoformat(sent)) < cutoff]
        if not old:
            return None
        with conn:
            conn.executemany("DELETE FROM cap_documents WHERE identifier = ?", [(i,) for i in old])
        conn.execute("VACUUM")
    finally:
        conn.close()
    return f"{len(old)} CAP document(s) older than {CAP_KEEP.days} days deleted"


def _aware(when: datetime) -> datetime:
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def _lines(rows: list[dict[str, Any]]) -> bytes:
    """JSON lines as one gzip member (b"" for none). Members appended to a daily .jsonl.gz read as one stream
    (Python's gzip, zcat), and each is added in one write."""
    if not rows:
        return b""
    text = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows)
    return gzip.compress(text.encode("utf-8"), compresslevel=6)


def _append(path: Path, member: bytes) -> None:
    if not member:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab") as out:
        out.write(member)


def read_lines(path: Path) -> list[dict[str, Any]]:
    """The lines of one archive file (for checks and for the evaluation)."""
    with gzip.open(path, "rt", encoding="utf-8") as lines:
        return [json.loads(line) for line in lines if line.strip()]


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _json_bytes(value: Any) -> bytes:
    """The exact bytes of the bookkeeping files, including a platform-independent newline."""
    return (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8")


def _save(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(_json_bytes(value))
    partial.replace(path)


def day_budget() -> float:
    """Bytes a day may add: ARCHIVE_DAYS days of this stay within ARCHIVE_MAX_BYTES, so one day never takes the room
    of the others (Codex M33)."""
    return ARCHIVE_MAX_BYTES / ARCHIVE_DAYS


def _day_files(root: Path) -> list[tuple[str, Path]]:
    return sorted((path.name[:10], path) for path in root.glob("*/*.jsonl.gz"))


def archive_round(root: Path, out: Path, now: datetime, summary: dict[str, Any], archived_at: datetime) -> str:
    """One round into the archive: the round line, new versions of VERSIONED and the flood reports' changes. All of
    it is made first and written only if both the day's share and the whole archive have room for it, including
    replacement bookkeeping files; otherwise nothing of the round is written and its absence is logged."""
    day = _day(now)
    manifest = _load(out / "manifest.json")
    files = {f["path"]: f for f in manifest.get("files", []) if isinstance(f, dict) and "path" in f}
    round_line = {
        "started": now.isoformat(), "archived_at": archived_at.isoformat(),
        "code": os.environ.get("FONTOKMAI_CODE") or None, "published": summary.get("published"),
        "generation_id": manifest.get("generation_id"), "generated_at": manifest.get("generated_at"),
        "schema_version": manifest.get("schema_version"), "completeness": manifest.get("completeness"),
        "source_status": manifest.get("source_status", []),
        "files": {path: [f.get("sha256"), f.get("size")] for path, f in sorted(files.items())},
        "overview": _load(out / "summary" / "overview.json") or None,
    }
    # the files the rules read: a version once, under the time it was first seen here. The bytes must be the ones
    # the manifest names: the Bangkok files can be replaced between the round and this (update-bkk.sh), and then
    # the next round keeps the new version under its own hash
    last_path = root / "versions" / "last.json"
    last = _load(last_path)
    versions = []
    for path in VERSIONED:
        sha = (files.get(path) or {}).get("sha256")
        if not sha or last.get(path) == sha:
            continue
        try:
            raw = (out / path).read_bytes()
        except OSError:
            continue
        if hashlib.sha256(raw).hexdigest() != sha:
            continue
        versions.append({"path": path, "sha256": sha, "first_seen": archived_at.isoformat(),
                         "generation_id": manifest.get("generation_id"), "data": json.loads(raw)})
        last[path] = sha
    # flood reports: first seen, changed, and gone from the feed (gone is not the water gone: the feed keeps a
    # report 2 hours after its stop time, and a report that ends is not a road that is dry)
    open_path = root / "floods" / "open.json"
    before: dict[str, str] = _load(open_path)
    floods = _load(out / "live" / "floods.json")
    rows, now_open = [], {}
    for report in floods.get("reports", []) if isinstance(floods, dict) else []:
        facts = {key: report.get(key) for key in FLOOD_FACTS}
        digest = hashlib.sha256(json.dumps(facts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        now_open[facts["id"]] = digest
        if before.get(facts["id"]) != digest:
            event = "changed" if facts["id"] in before else "first_seen"
            rows.append({"event": event, "at": archived_at.isoformat(), "fetched_at": floods.get("fetched_at"),
                         **facts})
    if floods:  # a round without the file says nothing about the reports
        rows += [{"event": "gone_from_feed", "at": archived_at.isoformat(), "fetched_at": floods.get("fetched_at"),
                  "id": gone} for gone in sorted(set(before) - set(now_open))]
    members = {root / "rounds" / f"{day}.jsonl.gz": _lines([round_line]),
               root / "versions" / f"{day}.jsonl.gz": _lines(versions),
               root / "floods" / f"{day}.jsonl.gz": _lines(rows)}
    used = sum(path.stat().st_size for d, path in _day_files(root) if d == day)
    if used + sum(len(member) for member in members.values()) > day_budget():
        return f"archive: today's share ({day_budget() / 1024**2:.1f} MB) is used up, this round is not in it"
    updates = {last_path: last}
    if floods:
        updates[open_path] = now_open
    # Pruning before this round only bounds the old files. Reserve space for all pending bytes as well (M36),
    # counting replacements as a delta, not a second copy. Do not advance last/open when rejecting a round.
    growth = sum(len(member) for member in members.values()) + sum(
        len(_json_bytes(value)) - (path.stat().st_size if path.exists() else 0)
        for path, value in updates.items()
    )
    projected = archive_bytes(root) + growth
    if projected > ARCHIVE_MAX_BYTES:
        return (f"archive: total budget ({ARCHIVE_MAX_BYTES} bytes) would be exceeded "
                f"({projected} bytes), this round is not in it")
    for path, member in members.items():
        _append(path, member)
    for path, value in updates.items():
        _save(path, value)
    return f"archive +{len(versions)} version(s) +{len(rows)} flood line(s)"


def _carried(doomed: list[tuple[str, Path]]) -> list[dict[str, Any]]:
    """The newest version of each file among the versions about to be deleted: rounds that stay may still name it
    (a file that did not change since), so it moves to the oldest day that stays (Codex M31)."""
    newest: dict[str, dict[str, Any]] = {}
    for day, path in doomed:
        if path.parent.name != "versions":
            continue
        for line in read_lines(path):
            if line.get("path") and line.get("first_seen", "") >= newest.get(line["path"], {}).get("first_seen", ""):
                newest[line["path"]] = {**line, "carried_from": line.get("carried_from", day)}
    return [newest[path] for path in sorted(newest)]


def prune_archive(root: Path, now: datetime, days: int | None = None) -> str | None:
    """Days older than ARCHIVE_DAYS go, then the oldest days while the whole archive (its bookkeeping included) is
    over ARCHIVE_MAX_BYTES, today too if a smaller cap asks for it. The newest version of each file among what goes
    is carried to the oldest day that stays, so no round that stays names a version the archive no longer has; when
    no day stays, versions/last.json forgets them, and the next round keeps the files again."""
    if not root.exists():
        return None
    cutoff = _day(now - timedelta(days=ARCHIVE_DAYS if days is None else days))
    files = _day_files(root)
    doomed = [(day, path) for day, path in files if day < cutoff]
    kept = [(day, path) for day, path in files if day >= cutoff]
    total = sum(path.stat().st_size for path in root.glob("*/*.json")) + sum(p.stat().st_size for _, p in kept)
    while True:
        carry = _lines(_carried(doomed)) if kept else b""
        if total + len(carry) <= ARCHIVE_MAX_BYTES or not kept:
            break
        oldest = kept[0][0]
        for pair in [pair for pair in kept if pair[0] == oldest]:
            kept.remove(pair)
            doomed.append(pair)
            total -= pair[1].stat().st_size
    if not doomed:
        return None
    carried = _carried(doomed) if kept else []
    if carried:
        _append(root / "versions" / f"{kept[0][0]}.jsonl.gz", _lines(carried))
    gone_shas = {line["sha256"] for day, path in doomed if path.parent.name == "versions"
                 for line in read_lines(path)} - {line["sha256"] for line in carried}
    for _, path in doomed:
        path.unlink()
    last_path = root / "versions" / "last.json"
    last = _load(last_path)
    if any(sha in gone_shas for sha in last.values()):
        _save(last_path, {path: sha for path, sha in last.items() if sha not in gone_shas})
    note = f"archive: {len(doomed)} file(s) deleted"
    return note + (f", {len(carried)} version(s) still in use moved to {kept[0][0]}" if carried else "")


def archive_bytes(root: Path) -> int:
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file()) if root.exists() else 0


def housekeeping(db: Path, out: Path, now: datetime, summary: dict[str, Any],
                 archived_at: datetime | None = None) -> dict[str, Any]:
    """Backup, retention and archive after one round; what was done, for the round log."""
    state = db.parent
    disk = shutil.disk_usage(state)
    report: dict[str, Any] = {"disk_free_gb": round(disk.free / 1024**3, 1)}
    if disk.total and 1 - disk.free / disk.total >= DISK_WARN:
        report["warning"] = f"the shared disk is {1 - disk.free / disk.total:.0%} full"
    reserve = disk.free < DISK_RESERVE * disk.total
    backups = state / "backups"
    daily = not (backups / f"fontokmai-{_day(now).replace('-', '')}.db.gz").exists()
    root = state / "archive" / "eval"
    # as the shared disk fills (or fontokmai's own files grow past their budget), keep less, oldest going first
    used = 1 - disk.free / disk.total if disk.total else 0.0
    tier = next((t for t in PRESSURE_TIERS if used >= t[0]), None)
    # fontokmai's own files are counted once a day, with the backup: the walk stats every file of the state folder,
    # and they grow by a few MB a day at most (the rounds in between only ever delete)
    own = tree_bytes(state) if daily else None
    if tier is None and own is not None and own > DATA_BUDGET:
        tier = PRESSURE_TIERS[-1]
    archive_days, backup_keep, upload_days = tier[1:] if tier else (ARCHIVE_DAYS, BACKUP_KEEP, DXS_UPLOADS_DAYS)
    if tier:
        size = f", fontokmai {own / 1024**2:.0f} MB" if own is not None else ""
        report["pressure"] = (f"disk {used:.0%} used{size}: keeping {archive_days} archive "
                              f"day(s), {backup_keep} backup(s), {upload_days} days of Bangkok uploads")
    notes = [
        prune_cap(db, now) if daily else None,
        backup_db(db, backups, now, keep=backup_keep) if daily else prune_backups(backups, backup_keep),
        prune_uploads(state / "archive" / "dxs", now, upload_days),
        prune_archive(root, now, archive_days),  # first, so that the round below is measured against what stays
        None if reserve else archive_round(root, out, now, summary, archived_at or datetime.now(UTC)),
    ]
    if reserve:
        report["skipped"] = f"archive not written: less than {DISK_RESERVE:.0%} of the shared disk is free"
    report["done"] = " · ".join(note for note in notes if note)
    if daily:
        report["archive_mb"] = round(archive_bytes(root) / 1024**2, 1)
    return report
