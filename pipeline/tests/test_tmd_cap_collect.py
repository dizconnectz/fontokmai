from datetime import datetime

from fontokmai.sources.tmd_cap.collect import collect, load_messages
from fontokmai.sources.tmd_cap.fetch import INDEX_URL, FetchError, fixture_fetcher
from fontokmai.state import StateStore
from helpers import FIXTURES

NOW = datetime.fromisoformat("2026-09-25T18:20:00+07:00")


def test_collect_stores_every_document_once(tmp_path):
    fetch = fixture_fetcher(FIXTURES)
    with StateStore(tmp_path / "s.db") as store:
        first = collect(store, fetch, NOW)
        assert (first.status, first.items_seen, first.fetched, first.rejected) == ("ok", 13, 13, 0)
        second = collect(store, fetch, NOW)
        assert (second.status, second.fetched) == ("ok", 0)
        assert len(load_messages(store)) == 13


def test_index_failure_is_reported_and_keeps_stored_documents(tmp_path):
    def broken(url):
        raise FetchError(f"{url}: HTTP 503")

    with StateStore(tmp_path / "s.db") as store:
        collect(store, fixture_fetcher(FIXTURES), NOW)
        result = collect(store, broken, NOW)
        assert result.status == "failed"
        assert result.errors == [f"index: {INDEX_URL}: HTTP 503"]
        assert len(load_messages(store)) == 13


def test_missing_document_makes_the_round_degraded(tmp_path):
    base = fixture_fetcher(FIXTURES)

    def flaky(url):
        if url.endswith("CAPTMD20260925163420_2.xml"):
            raise FetchError(f"{url}: HTTP 500")
        return base(url)

    with StateStore(tmp_path / "s.db") as store:
        result = collect(store, flaky, NOW)
        assert (result.status, result.fetched, result.rejected) == ("degraded", 12, 1)


def test_an_unreadable_document_is_listed_before_failed_downloads(tmp_path):
    """M12: the status message keeps three items, and an alert that could not be read must be among them."""
    base = fixture_fetcher(FIXTURES)
    names = ["CAPTMD20260925163420_2.xml"]

    def mixed(url):
        if url != INDEX_URL and not url.endswith(names[0]):
            raise FetchError(f"{url}: HTTP 502")
        return base(url) if url == INDEX_URL else b"<alert>not CAP</alert>"

    with StateStore(tmp_path / "s.db") as store:
        result = collect(store, mixed, NOW)
        assert result.status == "degraded"
        assert len(result.failed_downloads) == 12 and len(result.unreadable) == 1
        assert result.errors[0].startswith(names[0] + ": ")
