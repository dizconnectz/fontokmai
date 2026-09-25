from datetime import datetime

from fontokmai.state import StateStore

NOW = datetime.fromisoformat("2026-09-25T18:20:00+07:00")


def test_documents_are_stored_once_and_round_trip(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        doc = {"identifier": "T1", "sender": "TMD", "sent": NOW, "raw": b"<xml/>", "source_url": "u", "seen_at": NOW}
        assert store.add_cap_document(**doc) is True
        assert store.add_cap_document(**doc) is False
        assert store.has_cap_document("T1") and not store.has_cap_document("T2")
        assert store.cap_documents() == [(b"<xml/>", "u")]


def test_revision_increases_only_when_content_changes(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        assert store.revision_for("alert:x", "h1", NOW) == 1
        assert store.revision_for("alert:x", "h1", NOW) == 1
        assert store.revision_for("alert:x", "h2", NOW) == 2
        assert store.revision_for("alert:y", "h2", NOW) == 1


def test_state_survives_reopen(tmp_path):
    path = tmp_path / "s.db"
    with StateStore(path) as store:
        store.feed_sequence_for("a", NOW)
        store.feed_sequence_for("b", NOW)
        store.set_meta("tmd_cap.last_success_at", NOW.isoformat())
    with StateStore(path) as store:
        assert store.feed_sequence_for("b", NOW) == 2
        assert store.get_meta("tmd_cap.last_success_at") == NOW.isoformat()
        assert store.get_meta("missing") is None
