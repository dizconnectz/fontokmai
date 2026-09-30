"""The archive's total budget must also hold immediately after a new day is written."""

import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest

from fontokmai import housekeeping as keep
from fontokmai.state import StateStore


@pytest.mark.xfail(strict=True, reason="M36: admission counts the new day but not total bytes after the write")
def test_new_day_does_not_exceed_the_total_budget_after_housekeeping(tmp_path, monkeypatch):
    monkeypatch.setattr(keep, "ARCHIVE_DAYS", 1)
    monkeypatch.setattr(keep, "ARCHIVE_MAX_BYTES", 1400)
    db, out = tmp_path / "state/fontokmai.db", tmp_path / "out"
    with StateStore(db):
        pass
    root = db.parent / "archive/eval"
    (out / "bkk").mkdir(parents=True)
    raw = b'{"stations": []}'
    (out / "bkk/water.json").write_bytes(raw)
    (out / "manifest.json").write_text(
        json.dumps(
            {
                "files": [
                    {
                        "path": "bkk/water.json",
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "size": len(raw),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    yesterday = datetime(2026, 9, 29, 5, tzinfo=UTC)
    # Four rounds leave yesterday below the total cap, including last.json.
    for n in range(4):
        stamp = yesterday + timedelta(minutes=15 * n)
        note = keep.archive_round(root, out, stamp, {}, stamp)
        if "not in it" in note:
            break
    # A valid, nearly full total budget, including bookkeeping; today's own share is still free.
    monkeypatch.setattr(keep, "ARCHIVE_MAX_BYTES", keep.archive_bytes(root) + 64)
    today = yesterday + timedelta(days=1)
    keep.housekeeping(db, out, today, {}, archived_at=today)
    assert keep.archive_bytes(root) <= keep.ARCHIVE_MAX_BYTES, (
        "the end-of-round archive exceeds its total budget after admitting the new day's first round"
    )
