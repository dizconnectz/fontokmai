"""RID's daily report (D35): the Chao Phraya's gates and stations read from its text, the flooded districts of its
flood section, and the refresh that keeps the last good file."""

import io
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from fontokmai.contracts.flows import RidFlows
from fontokmai.sources import rid_chart, rid_report

FIXTURES = Path(__file__).parent / "fixtures" / "rid"
TEXT = (FIXTURES / "report-2026-10-03.txt").read_text(encoding="utf-8")
NOW = datetime(2026, 10, 3, 4, 0, tzinfo=UTC)  # 11:00 in Thailand


def test_the_report_reads_as_the_figures_of_rids_chart():
    """The text of the PDF drops Thai marks and uses private glyphs; the figures still read exactly."""
    assert rid_report.report_day(TEXT) == date(2026, 10, 3)
    found = rid_report.parse_report(TEXT)
    flows = {point_id: (figure.flow, figure.yesterday) for point_id, figure in found.items()}
    assert flows == {
        "c2": (2245, 2416), "c13": (2500, 2500), "east_intake": (246, 257), "manorom": (191, None),
        "maharaj": (55, None), "rama6": (612, 546), "phranarai": (0, 0), "phrasrisin": (18, None),
        "phrasrisaowaphak": (16, None), "west_intake": (351, 348), "makhamthao_uthong": (26, None),
        "makhamthao_krasiao": (11, None), "phonlathep": (90, None), "boromthat": (181, None),
        "small_west": (43, None), "c29b": (2382, 2113)}
    assert (found["c2"].level_m, found["c2"].below_bank_m) == (23.33, 2.37)


def test_the_flood_section_names_districts_by_their_codes():
    codes = rid_report.flooded_districts(TEXT, rid_report.district_index())
    # Pathum Thani: ธัญบุรี คลองหลวง หนองเสือ สามโคก เมืองปทุมธานี ลำลูกกา
    assert {"1301", "1302", "1303", "1304", "1306", "1307"} <= set(codes)


def chart(states: dict[str, str | None], size=(1000, 1414)) -> bytes:
    """A stand-in for RID's chart: its frame, and a dot of the given colour at each station's place."""
    colours = {"normal": (0, 200, 0), "critical": (255, 230, 0), "flood": (230, 0, 0)}
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = 89, 70, 944, size[1] - 196
    draw.rectangle([left, top, right, bottom], outline="black", width=2)
    figures = {item["id"]: item for item in rid_report.registry()["figures"]}
    for point_id, state in states.items():
        u, v = figures[point_id]["dot"]
        x, y = left + u * (right - left), top + v * (bottom - top)
        if state:
            draw.ellipse([x - 6, y - 6, x + 6, y + 6], fill=colours[state])
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=90)
    return out.getvalue()


def test_the_chart_gives_each_station_rids_own_state_on_both_canvas_sizes():
    for size in ((1000, 1414), (1000, 1294)):
        dots = {item["id"]: tuple(item["dot"]) for item in rid_report.registry()["figures"] if item.get("dot")}
        states = rid_chart.chart_states(chart({"c29b": "normal", "c35": "flood", "c2": "critical"}, size), dots)
        assert (states["c29b"], states["c35"], states["c2"], states["c7a"]) == ("normal", "flood", "critical", None)
    with pytest.raises(rid_chart.ChartError):
        rid_chart.chart_states(b"not a picture", dots)
    blank = io.BytesIO()
    Image.new("RGB", (1000, 1414), "white").save(blank, format="PNG")
    with pytest.raises(rid_chart.ChartError):  # no frame: not RID's chart
        rid_chart.chart_states(blank.getvalue(), dots)


def getter(report: int = 200, picture: bytes | None = None):
    calls = []

    def get(url, validators):
        calls.append((url, dict(validators)))
        if url == rid_report.REPORT_URL:
            if report == 304 and validators.get("etag"):  # the server answers 304 only to what it knows
                return 304, b"", validators
            return 200, b"%PDF report", {"etag": "e1"}
        if picture is None:
            raise OSError("404")
        return 200, picture, {}
    return get, calls


@pytest.fixture
def text(monkeypatch):
    """The PDF is not kept in the repository: its text stands in for it."""
    holder = {"text": TEXT}
    monkeypatch.setattr(rid_report, "report_text", lambda pdf: holder["text"])
    return holder


def test_the_refresh_writes_the_flows_and_reads_the_report_again_only_once_it_changed(tmp_path, text):
    out, db = tmp_path / "out", tmp_path / "state.db"
    get, calls = getter(picture=chart({"c29b": "normal", "c35": "flood"}))
    note = rid_report.refresh(out, db, NOW, get=get)
    assert note == "built 16 figures of 2026-10-03 (2 of 7 station states, 7 flooded districts)"
    flows = RidFlows.model_validate_json((out / rid_report.FLOWS_PATH).read_bytes())
    points = {point.id: point for point in flows.points}
    assert (points["phranarai"].flow_cms, points["phranarai"].capacity_cms) == (0, 210)
    assert (points["c29b"].flow_cms, points["c29b"].state, points["c35"].state) == (2382, "normal", "flood")
    assert points["c3"].flow_cms is None  # the report gives no flow for it: null, never guessed
    assert flows.observed_at == datetime(2026, 10, 3, 6, 0, tzinfo=rid_report.ICT)
    assert flows.chart_url.endswith("Chao_low03102026.jpg")
    assert {"1301", "1307"} <= set(flows.flooded_districts)
    # two hours on, the report is asked for with what the server said about it, and an unchanged one is not read;
    # its chart, which gave two of the seven states, is read again on its own
    get, calls = getter(report=304, picture=chart({"c29b": "normal", "c35": "flood"}))
    assert rid_report.refresh(out, db, NOW + timedelta(minutes=90), get=get) is None
    note = rid_report.refresh(out, db, NOW + timedelta(hours=2), get=get)
    assert note == "report not changed; chart gave no more states (2 of 7)"
    assert calls[0] == (rid_report.REPORT_URL, {"etag": "e1"}) and len(calls) == 2


def test_a_chart_not_up_or_not_readable_yet_is_read_again_on_its_own(tmp_path, text):
    """Codex M51: the chart's states are followed apart from the report, which is not downloaded again for them."""
    out, db = tmp_path / "out", tmp_path / "state.db"
    get, calls = getter(picture=None)  # the chart of the day is not up yet
    assert rid_report.refresh(out, db, NOW, get=get).startswith("built 16 figures")
    assert RidFlows.model_validate_json((out / rid_report.FLOWS_PATH).read_bytes()).chart_url is None
    # up, but its dots not readable yet (a frame and no colour): nothing changes, and it is tried again later
    get, calls = getter(report=304, picture=chart({}))
    note = rid_report.refresh(out, db, NOW + timedelta(hours=2), get=get)
    assert note == "report not changed; chart gave no more states (0 of 7)"
    assert calls[0] == (rid_report.REPORT_URL, {"etag": "e1"})  # the report was read once: 304
    get, calls = getter(report=304, picture=chart({"c29b": "critical", "c35": "flood"}))
    note = rid_report.refresh(out, db, NOW + timedelta(hours=4), get=get)
    assert note == "report not changed; chart read again (2 of 7 station states)"
    flows = RidFlows.model_validate_json((out / rid_report.FLOWS_PATH).read_bytes())
    states = {p.id: p.state for p in flows.points}
    assert (states["c29b"], states["c35"], states["c2"]) == ("critical", "flood", None)
    assert flows.chart_url.endswith("Chao_low03102026.jpg")
    # the whole chart read: the report is no longer followed by its chart
    every = {item["id"]: "normal" for item in rid_report.registry()["figures"] if item.get("dot")}
    get, calls = getter(report=304, picture=chart(every))
    rid_report.refresh(out, db, NOW + timedelta(hours=6), get=get)
    get, calls = getter(report=304, picture=chart(every))
    assert rid_report.refresh(out, db, NOW + timedelta(hours=8), get=get) == "report not changed"
    assert len(calls) == 1


def test_a_lost_file_is_read_in_full_whatever_the_server_said_before(tmp_path, text):
    out, db = tmp_path / "out", tmp_path / "state.db"
    get, _ = getter(picture=chart({"c29b": "normal"}))
    rid_report.refresh(out, db, NOW, get=get)
    (out / rid_report.FLOWS_PATH).unlink()
    get, calls = getter(report=304, picture=chart({"c29b": "normal"}))
    assert rid_report.refresh(out, db, NOW + timedelta(hours=2), get=get).startswith("built 16 figures")
    assert calls[0] == (rid_report.REPORT_URL, {})


def test_a_report_whose_wording_changed_or_an_older_day_never_replaces_the_file(tmp_path, text):
    out, db = tmp_path / "out", tmp_path / "state.db"
    get, _ = getter(picture=chart({}))
    rid_report.refresh(out, db, NOW, get=get)
    before = (out / rid_report.FLOWS_PATH).read_bytes()
    text["text"] = TEXT.split("C.2")[0]  # the date, but none of the figures
    note = rid_report.refresh(out, db, NOW + timedelta(hours=2), get=get)
    assert note.startswith("error: the report read as 0 figures")
    assert (out / rid_report.FLOWS_PATH).read_bytes() == before
    text["text"] = TEXT.replace("3 ตุลาคม พ.ศ. 2569", "2 ตุลาคม พ.ศ. 2569")
    assert rid_report.refresh(out, db, NOW + timedelta(hours=4), get=get) == "kept the report of 2026-10-03"
    assert json.loads((out / rid_report.FLOWS_PATH).read_bytes())["report_date"] == "2026-10-03"
