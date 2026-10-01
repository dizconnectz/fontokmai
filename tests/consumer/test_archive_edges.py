"""The archive's total budget must also hold immediately after a new day is written."""

import hashlib
import json
import shutil
from datetime import UTC, datetime, timedelta

import pytest

from fontokmai import housekeeping as keep
from fontokmai.state import StateStore


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
    before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    result = keep.housekeeping(db, out, today, {}, archived_at=today)
    assert keep.archive_bytes(root) <= keep.ARCHIVE_MAX_BYTES, (
        "the end-of-round archive exceeds its total budget after admitting the new day's first round"
    )
    assert "total budget" in result["done"] and "this round is not in it" in result["done"]
    assert {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()} == before


def _publish(out, revision, report_ids):
    (out / "bkk").mkdir(parents=True, exist_ok=True)
    (out / "live").mkdir(exist_ok=True)
    raw = json.dumps({"revision": revision, "name_th": "สถานีทดสอบ"}, ensure_ascii=False).encode("utf-8")
    (out / "bkk/water.json").write_bytes(raw)
    (out / "manifest.json").write_text(json.dumps({"files": [{
        "path": "bkk/water.json", "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw),
    }]}), encoding="utf-8")
    (out / "live/floods.json").write_text(json.dumps({"reports": [{"id": item} for item in report_ids]}),
                                         encoding="utf-8")


def _snapshot(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


@pytest.mark.parametrize("remaining", [-1, 0])
def test_budget_counts_utf8_bookkeeping_and_rejects_without_advancing_state(tmp_path, monkeypatch, remaining):
    root, out, reference = tmp_path / "eval", tmp_path / "out", tmp_path / "reference"
    first = datetime(2026, 9, 29, 5, tzinfo=UTC)
    later = first + timedelta(days=1)
    _publish(out, 1, ["เดิม"])
    keep.archive_round(root, out, first, {}, first)
    shutil.copytree(root, reference)
    _publish(out, 2, [f"พื้นที่-{n}" for n in range(30)])
    keep.archive_round(reference, out, later, {}, later)
    expected = keep.archive_bytes(reference)
    # These caps leave room for compressed records; it is the updated last/open state that reaches the edge.
    monkeypatch.setattr(keep, "ARCHIVE_DAYS", 1)
    monkeypatch.setattr(keep, "ARCHIVE_MAX_BYTES", expected + remaining)
    before = _snapshot(root)
    note = keep.archive_round(root, out, later, {}, later)
    if remaining < 0:
        assert "total budget" in note
        assert _snapshot(root) == before
        # When there is room later, every previously rejected change is still kept.
        monkeypatch.setattr(keep, "ARCHIVE_MAX_BYTES", expected)
        note = keep.archive_round(root, out, later, {}, later)
    assert note == "archive +1 version(s) +31 flood line(s)"
    assert keep.archive_bytes(root) == expected
    assert len(keep.read_lines(root / "versions/2026-09-30.jsonl.gz")) == 1
    assert len(json.loads((root / "floods/open.json").read_text(encoding="utf-8"))) == 30


def test_replacing_smaller_bookkeeping_frees_room_instead_of_counting_two_copies(tmp_path, monkeypatch):
    root, out = tmp_path / "eval", tmp_path / "out"
    first = datetime(2026, 9, 29, 5, tzinfo=UTC)
    _publish(out, 1, [f"พื้นที่-{n}" for n in range(100)])
    keep.archive_round(root, out, first, {}, first)
    total = keep.archive_bytes(root)
    monkeypatch.setattr(keep, "ARCHIVE_DAYS", 1)
    monkeypatch.setattr(keep, "ARCHIVE_MAX_BYTES", total)
    _publish(out, 1, [])
    later = first + timedelta(days=1)
    note = keep.archive_round(root, out, later, {}, later)
    assert note == "archive +0 version(s) +100 flood line(s)"
    assert keep.archive_bytes(root) <= total
    assert json.loads((root / "floods/open.json").read_text(encoding="utf-8")) == {}
