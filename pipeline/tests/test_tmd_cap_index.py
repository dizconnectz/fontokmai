from fontokmai.sources.tmd_cap.index import parse_index
from helpers import read_fixture


def test_parse_real_index():
    items = parse_index(read_fixture("index.xml"))
    assert len(items) == 13
    first = items[0]
    assert first.guid == "TMD20260925163420_2"
    assert first.link == "https://www.tmd.go.th/uploads/CAP/CAPTMD20260925163420_2.xml"
    assert first.pub_date_raw == "Fri, 25 Sep 2026 09:34:00 +0700"
    assert first.pub_date is not None and first.pub_date.utcoffset().total_seconds() == 7 * 3600


def test_parse_index_accepts_bom_and_skips_items_without_link():
    raw = (b"\xef\xbb\xbf<?xml version='1.0' encoding='utf-8'?><rss><channel>"
           b"<item><title>a</title></item>"
           b"<item><title>b</title><link>https://www.tmd.go.th/uploads/CAP/x.xml</link><guid>X</guid></item>"
           b"</channel></rss>")
    items = parse_index(raw)
    assert [i.guid for i in items] == ["X"]
    assert items[0].pub_date is None
