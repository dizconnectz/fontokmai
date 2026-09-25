"""Parse the TMD CAP RSS index (https://www.tmd.go.th/api/xml/CAP)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime


@dataclass(frozen=True)
class IndexItem:
    guid: str | None
    title: str
    link: str
    pub_date_raw: str | None
    pub_date: datetime | None


def _text(el: ET.Element, tag: str) -> str | None:
    value = el.findtext(tag)
    if value is None or not value.strip():
        return None
    return value.strip()


def parse_index(raw: bytes) -> list[IndexItem]:
    """Items of the RSS index in document order.

    pubDate is kept as published. TMD labels it +0700 although it matches UTC, so lifecycle
    decisions use the times inside each CAP document instead (design 9.2).
    """
    try:
        root = ET.fromstring(raw.removeprefix(b"\xef\xbb\xbf"))
    except ET.ParseError as exc:
        raise ValueError(f"invalid RSS index: {exc}") from exc
    channel = root.find("channel")
    if channel is None:
        raise ValueError("RSS index has no <channel>")
    items = []
    for item in channel.findall("item"):
        link = _text(item, "link")
        if link is None:
            continue
        pub_raw = _text(item, "pubDate")
        try:
            pub = parsedate_to_datetime(pub_raw) if pub_raw else None
        except (TypeError, ValueError):
            pub = None
        items.append(IndexItem(guid=_text(item, "guid"), title=_text(item, "title") or "", link=link,
                               pub_date_raw=pub_raw, pub_date=pub))
    return items
