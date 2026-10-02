import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fontokmai.contracts.bkk import DamReport
from fontokmai.sources import rid_dams
from fontokmai.sources.bma_dxs import DAMS_PATH
from fontokmai.sources.open_data.http import fixture_opener

FIXTURES = Path(__file__).parent / "fixtures" / "rid"
NOW = datetime(2026, 10, 2, 3, 0, tzinfo=UTC)  # 10:00 in Thailand
DAYS = ("2026-09-29", "2026-09-30", "2026-10-01")


def _opener(today: Path = FIXTURES / "dam_2026-10-02.json"):
    answers = {rid_dams.API_URL: today}
    answers.update({f"{rid_dams.API_URL}/{day}": FIXTURES / f"dam_{day}.json" for day in DAYS})
    return fixture_opener(answers)


def test_the_answer_reads_as_the_dams_of_the_bangkok_update():
    """User 2026-10-02: the dams update by themselves from RID's open data, the figures the DXS relays."""
    data = json.loads((FIXTURES / "dam_2026-10-02.json").read_text(encoding="utf-8"))
    report = rid_dams.parse(data, NOW)
    assert report.report_date == date(2026, 10, 2) and report.automatic and len(report.dams) == 35
    assert report.credit_th == "กรมชลประทาน (ข้อมูลเปิด data.go.th, CC BY)"
    kwang = next(d for d in report.dams if d.id == "100104")
    assert kwang.name_th == "เขื่อนแม่กวงอุดมธารา" and kwang.region_th == "ภาคเหนือ"
    assert (kwang.percent, kwang.volume_mcm, kwang.inflow_mcm, kwang.outflow_mcm) == (70.6, 185.67, 0.63, 0.83)
    assert kwang.location is not None and kwang.storage_mcm == 263
    assert sum(1 for d in report.dams if d.location) >= 30


def test_the_release_is_compared_with_the_latest_day_that_has_figures():
    report = rid_dams.collect(NOW, opener=_opener())
    # 1 Oct had figures for 10 of 35 dams: not "the day before"; 30 Sep had them
    assert report.previous_report_date == date(2026, 9, 30)
    before = json.loads((FIXTURES / "dam_2026-09-30.json").read_text(encoding="utf-8"))
    outflow = {d["id"]: d["outflow"] for r in before["data"] for d in r["dam"]}
    assert all(d.previous_outflow_mcm == outflow[d.id] for d in report.dams)


def test_a_blank_dam_keeps_its_latest_figures_with_their_day(tmp_path):
    data = json.loads((FIXTURES / "dam_2026-10-02.json").read_text(encoding="utf-8"))
    blank = data["data"][0]["dam"][0]
    for key in ("volume", "percent_storage", "inflow", "outflow"):
        blank[key] = None
    today = tmp_path / "today.json"
    today.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    report = rid_dams.collect(NOW, opener=_opener(today))
    dam = next(d for d in report.dams if d.id == blank["id"])
    assert dam.percent is None and dam.last_known is not None
    older = {day: json.loads((FIXTURES / f"dam_{day}.json").read_text(encoding="utf-8")) for day in DAYS}
    latest = next(day for day in reversed(DAYS) if any(
        d["id"] == blank["id"] and d["percent_storage"] is not None for r in older[day]["data"] for d in r["dam"]))
    assert dam.last_known.report_date == date.fromisoformat(latest)
    assert all(d.last_known is None for d in report.dams if d.id != blank["id"] and d.percent is not None)


def test_the_refresh_runs_every_two_hours_and_never_replaces_a_later_day(tmp_path):
    out, db = tmp_path / "out", tmp_path / "state.db"
    assert rid_dams.refresh(out, db, NOW, opener=_opener()) == "built 35 dams of 2026-10-02 (35 with figures)"
    written = DamReport.model_validate_json((out / DAMS_PATH).read_bytes())
    assert written.automatic and written.previous_report_date == date(2026, 9, 30)
    assert rid_dams.refresh(out, db, NOW + timedelta(minutes=90), opener=_opener()) is None
    # a later day already there (the Bangkok update ran later) stays
    later = written.model_copy(update={"report_date": date(2026, 10, 3), "automatic": False})
    (out / DAMS_PATH).write_text(later.model_dump_json(), encoding="utf-8")
    assert rid_dams.refresh(out, db, NOW + timedelta(hours=2), opener=_opener()) == "kept the report of 2026-10-03"
    # RID down: a line for the log, the file stays
    assert rid_dams.refresh(out, db, NOW + timedelta(hours=4), opener=fixture_opener({})).startswith("error:")
    assert DamReport.model_validate_json((out / DAMS_PATH).read_bytes()).report_date == date(2026, 10, 3)


def test_a_history_that_does_not_answer_is_asked_once():
    """Each request runs to the open-data timeout: once an earlier day fails, the others are not asked."""
    asked = []
    today = fixture_opener({rid_dams.API_URL: FIXTURES / "dam_2026-10-02.json"})

    def opener(url):
        asked.append(url)
        return today(url)  # the history URLs have no fixture: they fail like a server that does not answer

    report = rid_dams.collect(NOW, opener=opener)
    assert len(asked) == 2  # today's report and one earlier day
    assert report.previous_report_date is None
    assert all(dam.last_known is None for dam in report.dams)
