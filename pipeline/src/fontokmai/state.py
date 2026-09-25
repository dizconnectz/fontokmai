"""SQLite state: raw source documents, content revisions and metadata (design 4.5)."""

from __future__ import annotations

import hashlib
import sqlite3
import zlib
from datetime import datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS cap_documents (
    identifier TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    sent TEXT NOT NULL,
    source_url TEXT NOT NULL,
    raw_sha256 TEXT NOT NULL,
    raw_zlib BLOB NOT NULL,
    first_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
    key TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class StateStore:
    """Checkpoint of one writer. Every public method commits its own transaction."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> StateStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def has_cap_document(self, identifier: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM cap_documents WHERE identifier = ?", (identifier,)).fetchone()
        return row is not None

    def add_cap_document(self, *, identifier: str, sender: str, sent: datetime, raw: bytes, source_url: str,
                         seen_at: datetime) -> bool:
        """Store a raw CAP document once; False when it was already stored."""
        with self._conn:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO cap_documents VALUES (?, ?, ?, ?, ?, ?, ?)",
                (identifier, sender, sent.isoformat(), source_url, hashlib.sha256(raw).hexdigest(),
                 zlib.compress(raw, 6), seen_at.isoformat()),
            )
        return cur.rowcount == 1

    def cap_documents(self) -> list[tuple[bytes, str]]:
        rows = self._conn.execute(
            "SELECT raw_zlib, source_url FROM cap_documents ORDER BY sent, identifier").fetchall()
        return [(zlib.decompress(raw), url) for raw, url in rows]

    def revision_for(self, key: str, content_hash: str, now: datetime) -> int:
        """Revision of `key`; it increases only when the content hash changes."""
        with self._conn:
            row = self._conn.execute(
                "SELECT revision, content_hash FROM revisions WHERE key = ?", (key,)).fetchone()
            if row is not None and row[1] == content_hash:
                return row[0]
            revision = 1 if row is None else row[0] + 1
            self._conn.execute("INSERT OR REPLACE INTO revisions VALUES (?, ?, ?, ?)",
                               (key, revision, content_hash, now.isoformat()))
        return revision

    def feed_sequence_for(self, feed_hash: str, now: datetime) -> int:
        return self.revision_for("feed:alerts", feed_hash, now)

    def file_revision(self, path: str, sha256: str, now: datetime) -> int:
        return self.revision_for(f"file:{path}", sha256, now)

    def get_meta(self, key: str) -> str | None:
        row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._conn:
            self._conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, value))
