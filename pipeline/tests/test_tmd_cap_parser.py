from datetime import datetime

import pytest

from fontokmai.sources.tmd_cap.parser import CapParseError, parse_cap
from helpers import read_fixture

T = datetime.fromisoformat
MINIMAL = ("<identifier>T1</identifier><sender>TMD</sender><sent>2026-09-25T10:00:00+07:00</sent>"
           "<status>Actual</status><msgType>Alert</msgType><scope>Public</scope>")


def _cap(body: str) -> bytes:
    return ("<alert xmlns='urn:oasis:names:tc:emergency:cap:1.2'>" + body + "</alert>").encode()


def test_parse_real_update_message():
    msg = parse_cap(read_fixture("CAPTMD20260925162831_2.xml"))
    assert (msg.identifier, msg.sender) == ("TMD20260925162831_2", "TMD")
    assert msg.sent == T("2026-09-25T16:27:00+07:00")
    assert (msg.status, msg.msg_type, msg.scope) == ("Actual", "Update", "Public")
    assert [(r.identifier, r.sent) for r in msg.references] == [("TMD20260925071317_2", T("2026-09-25T07:10:00+07:00"))]
    info = msg.infos[0]
    assert (info.language, info.event) == ("th-TH", "Very Heavy Rain")
    assert (info.effective, info.expires, info.onset) == (
        T("2026-09-25T08:00:00+07:00"), T("2026-09-26T06:00:00+07:00"), None)
    area = info.areas[0]
    assert len(area.polygons) == 52
    assert ("ISO3166-2", "TH-10") in area.geocodes


def test_real_polygons_are_lon_lat_and_closed():
    msg = parse_cap(read_fixture("CAPTMD20260925162831_2.xml"))
    for ring in msg.infos[0].areas[0].polygons:
        assert ring[0] == ring[-1]
        assert all(97.0 < lon < 106.0 and 5.0 < lat < 21.0 for lon, lat in ring)


def test_lat_lon_pairs_become_lon_lat():
    raw = _cap(MINIMAL + "<info><event>Heavy Rain</event><urgency>Expected</urgency><severity>Moderate</severity>"
               "<certainty>Likely</certainty><area><areaDesc>x</areaDesc>"
               "<polygon>13.0,100.0 13.0,101.0 14.0,101.0</polygon></area></info>")
    ring = parse_cap(raw).infos[0].areas[0].polygons[0]
    assert ring == ((100.0, 13.0), (101.0, 13.0), (101.0, 14.0), (100.0, 13.0))


def test_bom_is_accepted():
    assert parse_cap(b"\xef\xbb\xbf" + _cap(MINIMAL)).identifier == "T1"


def test_missing_language_defaults_to_en_us():
    raw = _cap(MINIMAL + "<info><event>E</event><urgency>U</urgency><severity>S</severity>"
               "<certainty>C</certainty></info>")
    assert parse_cap(raw).infos[0].language == "en-US"


@pytest.mark.parametrize("raw", [
    b"not xml",
    b"<alert><identifier>x</identifier></alert>",
    _cap("<sender>TMD</sender>"),
    _cap(MINIMAL.replace("+07:00", "")),
    _cap(MINIMAL + "<references>TMD,only-two</references>"),
])
def test_invalid_documents_raise(raw):
    with pytest.raises(CapParseError):
        parse_cap(raw)
