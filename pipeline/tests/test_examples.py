import json

from fontokmai.examples import SCENARIOS, write_examples
from helpers import FIXTURES, SYNTHETIC


def _expected(out, name):
    return json.loads((out / name / "expected.json").read_text(encoding="utf-8"))


def test_examples_cover_every_scenario(tmp_path):
    write_examples(tmp_path, real=FIXTURES, synthetic=SYNTHETIC)
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(SCENARIOS)
    assert [a["lifecycle_status"] for a in _expected(tmp_path, "active")["visible_alerts"]] == ["active"] * 3
    assert "pending" in [a["lifecycle_status"] for a in _expected(tmp_path, "pending")["visible_alerts"]]
    expired = _expected(tmp_path, "expired")
    assert expired["visible_alerts"] == [] and len(expired["ended_events"]) == 9
    failed = _expected(tmp_path, "source-failed")
    assert (failed["completeness"], failed["source_status"][0]["status"]) == ("partial", "failed")
    assert failed["source_status"][0]["last_success_at"] == "2026-09-25T18:05:00+07:00"
    for name in ("cancelled", "out-of-order"):
        e = _expected(tmp_path, name)
        assert e["visible_alerts"] == []
        assert e["ended_events"] == [{"event_id": "tmd:SYN20260925100000_1", "lifecycle_status": "cancelled",
                                      "ended_at": "2026-09-25T12:00:00+07:00"}]
    assert _expected(tmp_path, "mixed-generation")["generation_match"] is False
    assert _expected(tmp_path, "active")["generation_match"] is True


def test_examples_are_reproducible(tmp_path):
    write_examples(tmp_path / "a", real=FIXTURES, synthetic=SYNTHETIC)
    write_examples(tmp_path / "b", real=FIXTURES, synthetic=SYNTHETIC)
    for path in sorted((tmp_path / "a").rglob("*.json")):
        assert path.read_bytes() == (tmp_path / "b" / path.relative_to(tmp_path / "a")).read_bytes()
