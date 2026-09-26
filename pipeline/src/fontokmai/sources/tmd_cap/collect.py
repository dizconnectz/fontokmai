"""One collection round of the TMD CAP feed: index → allowed links → new documents (design 9.2)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from fontokmai.sources.tmd_cap.fetch import INDEX_URL, Fetcher, FetchError, is_allowed_cap_url
from fontokmai.sources.tmd_cap.index import parse_index
from fontokmai.sources.tmd_cap.parser import CapMessage, CapParseError, parse_cap
from fontokmai.state import StateStore


@dataclass
class CollectResult:
    index_ok: bool = False
    items_seen: int = 0
    fetched: int = 0
    rejected: int = 0
    # documents that arrived but could not be used (link, parse, contract): worth telling the owner about
    unreadable: list[str] = field(default_factory=list)
    # downloads that failed this round; they are tried again next round
    failed_downloads: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[str]:
        """Unreadable documents first, so a short status message never loses them behind download errors."""
        return self.unreadable + self.failed_downloads

    @property
    def status(self) -> str:
        if not self.index_ok:
            return "failed"
        return "degraded" if self.rejected else "ok"


def collect(store: StateStore, fetch: Fetcher, now: datetime) -> CollectResult:
    """Documents that dropped off the index stay stored; an event never ends just by leaving the index."""
    result = CollectResult()
    try:
        items = parse_index(fetch(INDEX_URL))
    except (FetchError, ValueError) as exc:
        result.failed_downloads.append(f"index: {exc}")
        return result
    result.index_ok = True
    result.items_seen = len(items)
    for item in items:
        if not is_allowed_cap_url(item.link):
            result.rejected += 1
            result.unreadable.append(f"link not allowed: {item.link}")
            continue
        if item.guid and store.has_cap_document(item.guid):
            continue
        try:
            raw = fetch(item.link)
            msg = parse_cap(raw)
        except FetchError as exc:
            result.rejected += 1
            result.failed_downloads.append(str(exc))
            continue
        except CapParseError as exc:  # name the document, so a rejected alert can be found and looked at
            result.rejected += 1
            result.unreadable.append(f"{item.link.rsplit('/', 1)[-1]}: {exc}")
            continue
        if store.add_cap_document(identifier=msg.identifier, sender=msg.sender, sent=msg.sent, raw=raw,
                                  source_url=item.link, seen_at=now):
            result.fetched += 1
    return result


def load_messages(store: StateStore) -> list[tuple[CapMessage, str]]:
    return [(parse_cap(raw), url) for raw, url in store.cap_documents()]
