"""Contract 18 comparison dates, missing readings and the summary fed to the web."""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from fontokmai.contracts.bkk import DamReport
from fontokmai.overview_build import Gazetteer, build_overview
from fontokmai.sources.bma_dxs import with_previous

EXAMPLE = Path(__file__).resolve().parents[2] / "contracts/v1/examples/bkk/dams.json"
NOW = datetime.fromisoformat("2026-09-30T11:00:00+07:00")


def report(day, values):
    data = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    data.update(report_date=day.isoformat(), fetched_at=NOW.isoformat())
    data["dams"] = [
        {**data["dams"][0], "id": key, "outflow_mcm": value, "percent": 50} for key, value in values.items()
    ]
    return DamReport.model_validate(data)


@pytest.mark.parametrize("gap,compared", [(1, True), (3, True), (4, False), (-1, False), (0, False)])
def test_comparison_date_survives_the_wire_only_with_a_usable_baseline(gap, compared):
    today = report(NOW.date(), {"200101": 3})
    earlier = report(NOW.date() - timedelta(days=gap), {"200101": 2})
    wire = DamReport.model_validate_json(with_previous(today, earlier).model_dump_json())
    assert wire.previous_report_date == (earlier.report_date if compared else None)
    assert wire.dams[0].previous_outflow_mcm == (2 if compared else None)


def test_same_day_revision_preserves_the_prior_day_and_matches_ids_not_list_order():
    yesterday = report(date(2026, 9, 29), {"200101": 0, "100107": None})
    first = with_previous(report(NOW.date(), {"100107": 8, "200101": 1}), yesterday)
    revised = with_previous(report(NOW.date(), {"200101": 2, "new-dam": 9, "100107": 10}), first)
    wire = DamReport.model_validate_json(revised.model_dump_json())
    assert wire.previous_report_date == yesterday.report_date
    assert {d.id: d.previous_outflow_mcm for d in wire.dams} == {
        "200101": 0,
        "new-dam": None,
        "100107": None,
    }


@pytest.mark.parametrize(
    "before,current,listed",
    [(0, 1, True), (2, 3, True), (2, 2.99, False), (20, 26, False), (None, 10, False), (2, None, False)],
)
def test_release_summary_after_contract_roundtrip_is_dated_and_needs_both_thresholds(before, current, listed):
    compared = with_previous(report(NOW.date(), {"200101": current}), report(date(2026, 9, 29), {"200101": before}))
    overview = build_overview({"water/dams.json": compared.model_dump_json().encode()}, NOW, Gazetteer.load())
    releases = [(item, reason) for item in overview.items for reason in item.reasons if reason.kind == "dam_release_up"]
    assert bool(releases) is listed
    if listed:
        item, reason = releases[0]
        assert item.score > 0
        assert "30 ก.ย." in reason.text_th and "29 ก.ย." in reason.text_th
        assert "ล้าน ลบ.ม./วัน" in reason.text_th
        assert reason.at.date() == NOW.date()
        assert item.detail_th and item.detail_th.startswith("ท้ายน้ำ:")


def test_a_refetched_old_report_cannot_create_a_current_release_warning():
    old = with_previous(report(date(2026, 9, 20), {"200101": 20}), report(date(2026, 9, 19), {"200101": 2}))
    overview = build_overview({"water/dams.json": old.model_dump_json().encode()}, NOW, Gazetteer.load())
    assert not any(r.kind == "dam_release_up" for i in overview.items for r in i.reasons)
