from datetime import UTC, datetime
from pathlib import Path

from fontokmai.contracts.live_floods import LiveFloods
from fontokmai.contracts.manifest import Manifest
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.open_data.http import OpenDataError, fixture_opener
from fontokmai.sources.open_data.longdo_live import FEED_URL, FILE_PATH, collect_floods, parse_feed
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES

FEED = Path(__file__).parent / "fixtures" / "longdo_live" / "feed.xml"
AT_1530 = datetime.fromisoformat("2026-09-26T15:30:00+07:00")


def test_keeps_current_floods_only_and_publishes_no_names():
    reports, seen, rejected = parse_feed(FEED.read_bytes(), AT_1530)
    assert (seen, rejected) == (5, 1)  # five flood items, one with an impossible position
    assert [r.id for r in reports] == ["longdo:900001", "longdo:900003", "longdo:900002"]  # newest first
    assert [r.reporter for r in reports] == ["public", "itic_staff", "highway_department"]
    assert reports[0].start == datetime.fromisoformat("2026-09-26T15:20:00+07:00")
    assert reports[0].road_th == "ซอยทดสอบ 1" and reports[2].road_th is None
    # a link outside Longdo is replaced by the event page
    assert reports[1].url == "https://traffic.longdo.com/e/A00900003"
    text = LiveFloods(fetched_at=AT_1530, source_url="x", credit_th="x", reports=reports,
                      notes_th=[]).model_dump_json()
    assert "itic.staff1" not in text and "DOH Admin" not in text and "someone" not in text and "image" not in text


def test_a_report_that_ended_long_ago_or_starts_later_is_left_out():
    late = datetime.fromisoformat("2026-09-26T18:30:00+07:00")  # public reports ended at 16:20 and 15:40
    assert [r.id for r in parse_feed(FEED.read_bytes(), late)[0]] == ["longdo:900002"]
    early = datetime.fromisoformat("2026-09-26T15:00:00+07:00")  # 900001 starts at 15:20
    assert "longdo:900001" not in [r.id for r in parse_feed(FEED.read_bytes(), early)[0]]


def test_a_failed_read_keeps_the_last_good_file(tmp_path):
    first = collect_floods(fixture_opener({FEED_URL: FEED}), tmp_path, AT_1530)
    (tmp_path / FILE_PATH).parent.mkdir(parents=True)
    (tmp_path / FILE_PATH).write_bytes(first.feed.model_dump_json().encode())

    def offline(url):
        raise OpenDataError(f"{url}: offline")

    again = collect_floods(offline, tmp_path, AT_1530)
    assert not again.ok and again.feed == first.feed and "offline" in again.message


def test_the_round_publishes_live_floods_with_their_status(tmp_path):
    out = tmp_path / "v1"
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                     now=datetime(2026, 9, 26, 8, 30, tzinfo=UTC), writer="t", owner_epoch=1,
                     floods_opener=fixture_opener({FEED_URL: FEED}))
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert FILE_PATH in [f.path for f in manifest.files]
    status = next(s for s in manifest.source_status if s.source_id == "longdo_floods")
    assert (status.status, status.items_seen, status.items_rejected) == ("ok", 5, 1)
    assert len(LiveFloods.model_validate_json((out / FILE_PATH).read_bytes()).reports) == 3
