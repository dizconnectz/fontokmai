"""A dam that the day's report leaves blank keeps its last known figures, dated (user 2026-10-01: the report of
1 Oct had figures for 10 of 35 dams at 10:46 and still at 13:15, the four main dams blank)."""

from datetime import date, datetime, timedelta
from pathlib import Path

from fontokmai.contracts.bkk import DamFigures, DamReport
from fontokmai.overview_build import Gazetteer, build_overview
from fontokmai.sources.bma_dxs import has_figures, with_last_known

EXAMPLE = Path(__file__).resolve().parents[2] / "contracts" / "v1" / "examples" / "bkk" / "dams.json"
YESTERDAY = datetime.fromisoformat("2026-09-30T17:14:00+07:00")
TODAY = datetime.fromisoformat("2026-10-01T10:46:00+07:00")
G = Gazetteer.load()


def _report(fetched, figures):
    """The example dams on the day of `fetched`, with these figures (id → percent, None = blank) for every field."""
    example = DamReport.model_validate_json(EXAMPLE.read_bytes())
    dams = []
    for dam in example.dams:
        value = figures.get(dam.id)
        dams.append(dam.model_copy(update={
            "percent": value, "volume_mcm": None if value is None else value * 10,
            "inflow_mcm": None if value is None else 1.5, "outflow_mcm": None if value is None else 2.5}))
    return example.model_copy(update={"fetched_at": fetched, "report_date": fetched.date(), "dams": dams})


def test_a_blank_dam_keeps_yesterdays_figures_with_their_day_and_time():
    published = _report(YESTERDAY, {"200101": 65.37, "100301": 106.8})
    today = with_last_known(_report(TODAY, {"200101": None, "100301": 107.1}), published)
    bhumibol, unplaced, pasak = today.dams
    assert not has_figures(bhumibol) and bhumibol.percent is None  # the day's own fields stay blank
    assert bhumibol.last_known == DamFigures(report_date=date(2026, 9, 30), fetched_at=YESTERDAY, percent=65.37,
                                             volume_mcm=653.7, inflow_mcm=1.5, outflow_mcm=2.5)
    assert pasak.last_known is None  # it has its own figures today
    assert unplaced.last_known is None  # blank yesterday too: nothing to keep
    # a second update while the report is still blank keeps the first day and time, not the blank file's
    later = with_last_known(_report(TODAY + timedelta(hours=3), {}), today)
    assert later.dams[0].last_known.report_date == date(2026, 9, 30)
    assert later.dams[0].last_known.fetched_at == YESTERDAY


def test_figures_older_than_a_week_are_not_kept_and_nothing_is_invented_without_a_published_file():
    old = _report(YESTERDAY - timedelta(days=8), {"200101": 65.0})
    assert with_last_known(_report(TODAY, {}), old).dams[0].last_known is None
    blank = _report(TODAY, {})
    assert with_last_known(blank, None) is blank


def test_the_summary_reads_a_blank_dam_by_its_last_figures_of_yesterday_only():
    published = _report(YESTERDAY, {"100301": 106.8})
    today = with_last_known(_report(TODAY, {}), published).model_copy(update={"fetched_at": TODAY})
    now = TODAY + timedelta(hours=1)
    (item,) = build_overview({"water/dams.json": today.model_dump_json().encode()}, now, G).items
    assert item.place_th == "เขื่อนป่าสักชลสิทธิ์"
    assert item.reasons[0].text_th == "น้ำเกินความจุเก็บกัก 106.8% (รายงาน 30 ก.ย.) ติดตามการระบายน้ำ"
    assert item.reasons[0].at == datetime.fromisoformat("2026-09-30T00:00:00+07:00")
    # two days later the same figures are too old for the summary (M26), though the card still shows them dated
    later = today.model_copy(update={"report_date": date(2026, 10, 2), "fetched_at": TODAY + timedelta(days=1)})
    assert build_overview({"water/dams.json": later.model_dump_json().encode()}, now + timedelta(days=1), G).items == []
