"""Large dams from the Royal Irrigation Department's reservoir system, fetched by the server itself (user 2026-10-02:
"ข้อมูลการระบายน้ำ อัปเดตอัตโนมัติไม่ได้หรอ").

RID publishes the API of its large dams (app.rid.go.th/reservoir/api/dam/public, and the report of any day under
/public/YYYY-MM-DD) on data.go.th as open data: อ่างเก็บน้ำขนาดใหญ่ (big_dams_public), Creative Commons Attribution,
updated daily. They are the figures the Bangkok DXS relays (35 of 35 equal on 2026-10-02), but RID's server answers
the server abroad, so the dams no longer wait for the Bangkok update run by hand (D31). Every REFRESH the server asks
for today's report; the release is compared with the latest earlier day that has figures for most dams (at most
PREVIOUS_MAX_DAYS back), and a dam today's report leaves blank keeps its latest figures within LAST_KNOWN_DAYS, dated.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from fontokmai.contracts.bkk import Dam, DamFigures, DamReport
from fontokmai.downstream import dam_downstream_th
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources.bma_dxs import (
    DAMS_LOCATION_CREDIT_TH,
    DAMS_NOTES_TH,
    DAMS_PATH,
    ICT,
    LAST_KNOWN_DAYS,
    PREVIOUS_MAX_DAYS,
    dam_locations,
    has_figures,
    with_previous,
)
from fontokmai.sources.open_data.http import OpenDataError, Opener, open_url, read_json
from fontokmai.state import StateStore

API_URL = "https://app.rid.go.th/reservoir/api/dam/public"
PAGE_URL = "https://app.rid.go.th/reservoir"
CREDIT_TH = "กรมชลประทาน (ข้อมูลเปิด data.go.th, CC BY)"
REFRESH = timedelta(hours=2)  # the report is daily and fills in during the morning
ATTEMPT_KEY = "rid_dams.last_attempt"


def _number(value: Any, low: float, high: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value != value:
        return None
    return float(value) if low <= value <= high else None


def parse(data: dict[str, Any], now: datetime) -> DamReport:
    """One answer of the API: the report of its day, the dams placed from OpenStreetMap as the DXS ones are."""
    try:
        day = date.fromisoformat(str(data["date"]))
        regions = data["data"]
    except (KeyError, TypeError, ValueError) as exc:
        raise OpenDataError(f"RID dams: no report date or data ({type(exc).__name__})") from exc
    places = dam_locations()
    dams = []
    for region in regions if isinstance(regions, list) else []:
        if not isinstance(region, dict):
            continue
        for item in region.get("dam") or []:
            if not isinstance(item, dict):
                continue
            dam_id, name = str(item.get("id") or ""), item.get("name")
            if not dam_id or not isinstance(name, str) or not name:
                continue
            place = places.get(dam_id)
            dams.append(Dam(
                id=dam_id, name_th=name, region_th=region.get("region"), owner_th=item.get("owner"),
                location=place["location"] if place else None, location_kind=place["kind"] if place else None,
                storage_mcm=_number(item.get("storage"), 0, 100_000),
                volume_mcm=_number(item.get("volume"), 0, 100_000),
                percent=_number(item.get("percent_storage"), 0, 200),
                inflow_mcm=_number(item.get("inflow"), 0, 10_000),
                outflow_mcm=_number(item.get("outflow"), 0, 10_000),
                downstream_th=dam_downstream_th(dam_id),
            ))
    if not dams:
        raise OpenDataError("RID dams: no dam in the answer")
    return DamReport(fetched_at=now.astimezone(ICT), report_date=day, source_url=PAGE_URL, credit_th=CREDIT_TH,
                     location_credit_th=DAMS_LOCATION_CREDIT_TH, dams=dams, notes_th=DAMS_NOTES_TH, automatic=True)


def collect(now: datetime, *, opener: Opener = open_url) -> DamReport:
    """Today's report, compared with an earlier day and with its blank dams filled from the days before."""
    report = parse(read_json(opener, API_URL), now)
    days: dict[date, DamReport | None] = {}

    def day_report(day: date) -> DamReport | None:
        if day not in days:
            try:
                older = parse(read_json(opener, f"{API_URL}/{day.isoformat()}"), now)
                days[day] = older if older.report_date == day else None
            except OpenDataError:
                days[day] = None
        return days[day]

    # the release of the latest earlier day that has figures for most dams (a blank morning is not "the day before")
    for back in range(1, PREVIOUS_MAX_DAYS + 1):
        older = day_report(report.report_date - timedelta(days=back))
        if older and 2 * sum(d.outflow_mcm is not None for d in older.dams) >= len(older.dams):
            report = with_previous(report, older)
            break
    # a dam the report leaves blank keeps its latest figures, dated with their own day (user 2026-10-01)
    filled: dict[str, DamFigures] = {}
    for back in range(1, LAST_KNOWN_DAYS + 1):
        need = [dam.id for dam in report.dams if not has_figures(dam) and dam.id not in filled]
        if not need:
            break
        older = day_report(report.report_date - timedelta(days=back))
        if older is None:
            continue
        before = {dam.id: dam for dam in older.dams}
        for dam_id in need:
            old = before.get(dam_id)
            if old is not None and has_figures(old):
                filled[dam_id] = DamFigures(report_date=older.report_date, fetched_at=now.astimezone(ICT),
                                            percent=old.percent, volume_mcm=old.volume_mcm,
                                            inflow_mcm=old.inflow_mcm, outflow_mcm=old.outflow_mcm)
    if filled:
        report = report.model_copy(update={"dams": [
            dam.model_copy(update={"last_known": filled[dam.id]}) if dam.id in filled else dam
            for dam in report.dams]})
    return report


def refresh(out_dir: Path, db: Path, now: datetime, *, opener: Opener = open_url) -> str | None:
    """Every REFRESH: today's report into water/dams.json (the next round publishes it), unless the file already
    holds a later day. A line for the round log, or None when it is not time yet."""
    with StateStore(db) as store:
        last = store.get_meta(ATTEMPT_KEY)
        if last and now - datetime.fromisoformat(last) < REFRESH:
            return None
        store.set_meta(ATTEMPT_KEY, now.isoformat())
    try:
        report = collect(now, opener=opener)
    except Exception as exc:  # noqa: BLE001 - reported in the round log; the last good file stays
        return f"error: {type(exc).__name__}: {exc}"[:300]
    path = out_dir / DAMS_PATH
    try:
        current = DamReport.model_validate_json(path.read_bytes())
    except (OSError, ValueError):
        current = None
    if current is not None and current.report_date > report.report_date:
        return f"kept the report of {current.report_date.isoformat()}"
    atomic_write(path, report.model_dump_json().encode("utf-8"))
    figures = sum(has_figures(dam) for dam in report.dams)
    return f"built {len(report.dams)} dams of {report.report_date.isoformat()} ({figures} with figures)"
