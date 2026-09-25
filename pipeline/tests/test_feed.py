from datetime import datetime

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.common import SourceStatus
from fontokmai.feeds.alerts import assemble_alerts_feed
from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from fontokmai.state import StateStore
from helpers import real_messages

T = datetime.fromisoformat


def _feed(store, now):
    now = T(now)
    pairs = real_messages()
    urls = {m.key: url for m, url in pairs}
    status = SourceStatus(source_id="tmd_cap", status="ok", last_attempt_at=now, last_success_at=now,
                          items_seen=13, items_rejected=0)
    candidates = alert_candidates(group_events(m for m, _ in pairs), urls, now)
    return assemble_alerts_feed(candidates, store, now=now, generation_id="g", recovery_epoch=1,
                                source_status=[status])


def test_feed_at_1820_has_three_alerts_and_six_tombstones(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        feed = _feed(store, "2026-09-25T18:20:00+07:00")
    assert [a.event_id for a in feed.alerts] == [
        "tmd:TMD20260925071012_2", "tmd:TMD20260925071317_2", "tmd:TMD20260925163420_2"]
    assert len(feed.tombstones) == 6 and {t.lifecycle_status for t in feed.tombstones} == {"expired"}
    assert (feed.feed_sequence, feed.generation_id, feed.recovery_epoch) == (1, "g", 1)
    assert AlertsFeed.model_validate_json(feed.model_dump_json()) == feed


def test_rerun_without_changes_keeps_sequence_and_revisions(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        first = _feed(store, "2026-09-25T18:20:00+07:00")
        second = _feed(store, "2026-09-25T18:35:00+07:00")
    assert second.feed_sequence == first.feed_sequence == 1
    assert [a.revision for a in second.alerts] == [1, 1, 1]


def test_lifecycle_change_bumps_revision_and_sequence(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        before = _feed(store, "2026-09-25T17:30:00+07:00")
        after = _feed(store, "2026-09-25T18:20:00+07:00")
    pending = {a.event_id: a for a in before.alerts}["tmd:TMD20260925163420_2"]
    active = {a.event_id: a for a in after.alerts}["tmd:TMD20260925163420_2"]
    assert (pending.lifecycle_status, pending.revision) == ("pending", 1)
    assert (active.lifecycle_status, active.revision) == ("active", 2)
    assert after.feed_sequence == 2


def test_old_tombstones_leave_the_feed(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        feed = _feed(store, "2026-10-05T12:00:00+07:00")
    assert feed.alerts == [] and feed.tombstones == []
