"""Backup figures of RID's Chao Phraya stations from the page of RID's hydrology centre (user 2026-10-04).

RID's daily report (rid_report.py) is the main source of every station, the same way for all of them. It prints no
figure for C.35 (Ayutthaya), while the hydrology centre's page (hyd-app-db.rid.go.th/SVG/flow_water.html) shows the
flow and level of C.2, C.13, C.3, C.7A and C.35 hour by hour. That server answers computers in Thailand only
(timeouts from the VPS, resets from abroad, 2026-10-04), so it is read by the manual Bangkok run (bkk-fetch, D31)
into bkk/rid_hydro.json, copied to the server with the Bangkok files, and used only where the report gives a station
no figure: shown as a backup with its own time, and counted by the canal outlook like a report figure.

The page is an empty diagram that its script fills: for each station it POSTs {"hydro": {"stationcode": "C.35"}} to
the centre's own web service and gets the station's hours, newest first (seen from the user's computer 2026-10-04:
Q 1489, QMax 1159, waterlevelvalue 5.42 at /Date(1791111600000+0700)/ = 18:00). The service answers 401 to a request
that did not open the page first, so this does what a browser does: opens the page once, keeps its session cookie,
then asks the same service the page asks. `fontokmai rid-hydro-probe` prints what the service gives, to check it.
"""

from __future__ import annotations

import http.cookiejar
import json
import math
import re
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fontokmai.contracts.flows import HydroStation, RidFlows, RidHydro

PAGE_URL = "https://hyd-app-db.rid.go.th/SVG/flow_water.html?svg=hydro5_637977164104194493"
SERVICE_URL = "https://hyd-app-db.rid.go.th/webservice/SWOCService.svc/getHourlyWaterLevelFromStationCode"
STATIONS = ("C.2", "C.13", "C.3", "C.7A", "C.35")  # the stations the page shows
PATH = "bkk/rid_hydro.json"
CREDIT_TH = "ศูนย์อุทกวิทยาชลประทานภาคกลาง กรมชลประทาน (ตัวเลขสำรอง)"
NOTES_TH = ["ตัวเลขสำรองจากหน้าสถานการณ์น้ำของศูนย์อุทกวิทยาฯ ใช้เฉพาะสถานีที่รายงานประจำวันของกรมชลฯ ไม่มีตัวเลข"]
MAX_AGE = timedelta(hours=36)  # a backup older than this says nothing of today's river
SKEW = timedelta(minutes=10)
TIMEOUT_S = 60
LIMIT = 5_000_000
_DATE = re.compile(r"/Date\((-?\d+)")

# the hours of one station, as the service answers them (JSON bytes)
Fetch = Callable[[str], bytes]


def _read(response) -> bytes:
    data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise OSError(f"larger than {LIMIT} bytes")
    return data


def session_fetch() -> Fetch:
    """Open the page once (its session cookie), then ask the page's service for one station at a time."""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    agent = {"User-Agent": "fontokmai/1.0 (+https://dizconnectz.github.io/fontokmai/)"}
    with opener.open(urllib.request.Request(PAGE_URL, headers=agent), timeout=TIMEOUT_S) as response:
        _read(response)

    def fetch(code: str) -> bytes:
        body = json.dumps({"hydro": {"stationcode": code}}).encode("utf-8")
        request = urllib.request.Request(SERVICE_URL, data=body, method="POST", headers={
            **agent, "Content-Type": "application/json; charset=utf-8", "X-Requested-With": "XMLHttpRequest",
            "Referer": PAGE_URL, "Origin": "https://hyd-app-db.rid.go.th"})
        with opener.open(request, timeout=TIMEOUT_S) as response:
            return _read(response)

    return fetch


def _number(value) -> float | None:
    """A figure, or None for the service's marks ('*', '-', null)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def parse_station(code: str, answer: bytes) -> HydroStation | None:
    """The newest hour of a station that has a level or a flow, or None when the answer has none."""
    rows = json.loads(answer)
    if isinstance(rows, dict):  # WCF may wrap the list as {"d": [...]}
        rows = rows.get("d")
    best = None
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or str(row.get("stationcode", code)).strip() != code:
            continue
        stamp = _DATE.search(str(row.get("hourlydate") or ""))
        if not stamp:
            continue
        at = datetime.fromtimestamp(int(stamp.group(1)) / 1000, tz=UTC)
        # a flow is a figure only when the hour has no notation (the page shows the notation instead)
        flow = _number(row.get("Q")) if row.get("notationid") in (0, None) else None
        if flow is not None and flow < 0:
            flow = None
        level = _number(row.get("waterlevelvalue"))
        if (flow is None and level is None) or (best is not None and at <= best.observed_at):
            continue
        best = HydroStation(code=code, flow_cms=flow,
                            level_m=round(level, 2) if level is not None else None, observed_at=at)
    return best


def collect(now: datetime, fetch: Fetch | None = None) -> RidHydro | None:
    """Each station's newest hour; None when the service gave no station a figure."""
    fetch = fetch or session_fetch()
    stations = [station for code in STATIONS if (station := parse_station(code, fetch(code))) is not None]
    if not stations:
        return None
    return RidHydro(fetched_at=now, observed_at=max(s.observed_at for s in stations if s.observed_at),
                    source_url=PAGE_URL, credit_th=CREDIT_TH, stations=stations, notes_th=NOTES_TH)


def probe(out: Path, fetch: Fetch | None = None) -> list[str]:
    """Save what the service answers for each station into `out`, and say what the reader takes from it."""
    out.mkdir(parents=True, exist_ok=True)
    fetch = fetch or session_fetch()
    lines = []
    for code in STATIONS:
        try:
            answer = fetch(code)
        except OSError as exc:
            lines.append(f"{code}: could not read: {exc}")
            continue
        (out / f"hourly-{code}.json").write_bytes(answer)
        try:
            station = parse_station(code, answer)
        except ValueError as exc:
            lines.append(f"{code}: {len(answer)} bytes, not JSON: {exc}")
            continue
        lines.append(f"{code}: {len(answer)} bytes; reader: " + (
            f"flow {station.flow_cms} level {station.level_m} at {station.observed_at}" if station else "nothing"))
    return lines


def _without_backup(flows: RidFlows) -> RidFlows:
    """The report's own points: a figure an earlier round filled from the backup is taken out again.

    A round writes the file it publishes into the directory the next round reads (write_snapshot), so a backup put
    in once was kept as if the report had given it: it never expired and a newer backup never replaced it, until the
    next daily report rewrote the file (found 2026-10-09: figures of 7 Oct 16:00 still shown after 42 hours, past the
    36 hours MAX_AGE allows). A station the report gives no figure has no level either (a Figure needs its flow), so
    nothing else of such a point is the report's to keep.
    """
    if not any(point.flow_backup_at is not None for point in flows.points):
        return flows
    points = [point.model_copy(update={"flow_cms": None, "level_m": None, "flow_backup_at": None})
              if point.flow_backup_at is not None else point for point in flows.points]
    return flows.model_copy(update={"points": points, "backup_url": None})


def with_backup(flows: RidFlows, backup: RidHydro | None, now: datetime) -> RidFlows:
    """The report's figures, with the backup's where the report has none for a station, while that hour is recent."""
    flows = _without_backup(flows)
    if backup is None:
        return flows
    by_code = {station.code: station for station in backup.stations}
    points, used = [], False
    for point in flows.points:
        spare = by_code.get(point.code or "")
        at = (spare.observed_at or backup.observed_at) if spare is not None else None
        if (point.flow_cms is None and spare is not None and spare.flow_cms is not None and at is not None
                and now - MAX_AGE <= at <= now + SKEW):
            point = point.model_copy(update={"flow_cms": spare.flow_cms, "flow_backup_at": at,
                                             "level_m": point.level_m if point.level_m is not None else spare.level_m})
            used = True
        points.append(point)
    return flows.model_copy(update={"points": points, "backup_url": backup.source_url}) if used else flows
