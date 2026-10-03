"""Flows through the Chao Phraya's barrages and gates from RID's daily water report (D35, user 2026-10-03:
"เอาเลขประตูน้ำมา integrate ใส่ด้วยใน map เรา").

RID's Smart Water Operation Center writes a report every morning (water.rid.go.th/flood/flood/daily.pdf, one file
replaced each day) with the 06:00 flow at the Chao Phraya's stations and through the gates that take water into the
canals: the Chao Phraya dam and its intakes east and west, the Rama VI barrage on the Pasak and the gates of the
Raphiphat canal, which carries the Pasak into the Rangsit field. The report is text in a PDF, so the figures read
exactly; the stations' state (normal, critical, flood) is only on the chart, as coloured dots (rid_chart.py).

The report states no licence and data.go.th has no such set. The user decided (D35) that the site reads its figures as
facts, shows them with the credit, the time and a link to RID's own pages, and uses them in the canal outlook; the
Thai Copyright Act section 7 keeps official reports and facts out of copyright. The PDF and the chart are not copied.

The text that pypdf takes out of this PDF drops many Thai marks (น้ำ comes out as น้ํา or นา, ผ่าน as ผาน), so both the
text and the patterns are reduced the same way before matching (`_bare`). A figure that is not found is left out,
never guessed; the file says which.
"""

from __future__ import annotations

import io
import json
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from importlib import resources
from pathlib import Path
from typing import Any

from fontokmai.contracts.flows import FlowPoint, FlowSite, RidFlows
from fontokmai.publish.snapshot import atomic_write
from fontokmai.sources import rid_chart
from fontokmai.state import StateStore

REPORT_URL = "https://water.rid.go.th/flood/flood/daily.pdf"
CHART_PAGE_URL = "https://water.rid.go.th/flood/plan_new/planlow.html"
ICT = timezone(timedelta(hours=7))
MONTHS_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน",
             "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]

# Thai marks above and below the line, the nikhahit of sara am, and the private-use code points (U+F700-U+F71F) that
# the report's legacy Thai font uses for shifted marks: what pypdf loses, splits or keeps as private glyphs
_MARKS = re.compile("[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\uf700-\uf71f]")


def _bare(text: str) -> str:
    """Text without the Thai marks pypdf drops, sara am as sara aa, every run of space as one space."""
    return re.sub(r"\s+", " ", _MARKS.sub("", text.replace("ำ", "า")))


_FLOW = r"([\d,]+)\s*ลบ\.ม\./วินาที"
_YESTERDAY = r"\s*\(เมื่อวาน\s*([\d,]+)"
_LEVEL = r"([+-]?\d+\.\d+)\s*ม\.รทก\."
# what each figure is called in the report (proper Thai here, reduced like the text by _bare)
PATTERNS: dict[str, str] = {
    "c2": r"C\.2\b[^()]{0,60}?" + _FLOW + _YESTERDAY,
    "c13": r"C\.13\b[^()]{0,60}?" + _FLOW + _YESTERDAY,
    "east_intake": r"ตะวันออก\s*รวม\s*" + _FLOW + _YESTERDAY,
    "manorom": r"\(ปตร\.มโนรมย์\)\s*" + _FLOW,
    "maharaj": r"\(ปตร\.มหาราช\)\s*" + _FLOW,
    "rama6": r"เขื่อนพระรามหก\s*" + _FLOW + _YESTERDAY,
    "phranarai": r"รับน้ำเข้าคลองระพีพัฒน์\s*" + _FLOW + _YESTERDAY,
    "phrasrisin": r"\(ปตร\.พระศรีศิลป์\)\s*" + _FLOW,
    "phrasrisaowaphak": r"\(ปตร\.พระศรีเสาวภาค\)\s*" + _FLOW,
    "west_intake": r"ตะวันตก\s*รวม\s*" + _FLOW + _YESTERDAY,
    "makhamthao_uthong": r"\(ปตร\.มะขามเฒ่า-อู่ทอง\)\s*" + _FLOW,
    "makhamthao_krasiao": r"\(ปตร\.มะขามเฒ่า-กระเสียว\)?\s*" + _FLOW,
    "phonlathep": r"\(ปตร\.พลเทพ\)\s*" + _FLOW,
    "boromthat": r"\(ปตร\.บรมธาตุ\)\s*" + _FLOW,
    "small_west": r"คลองเล็กอื่น\s*ๆ\s*" + _FLOW,
    "c29b": r"C\.29B\b[^()]{0,60}?" + _FLOW + _YESTERDAY,
}
# the water level and how far it is below (or above) the bank, said for some stations
LEVEL_PATTERNS: dict[str, str] = {
    "c2": r"C\.2\b.{0,140}?ระดับน้ำ\s*" + _LEVEL + r"\s*(ต่ำ|สูง)กว่าตลิ่ง\s*(\d+\.\d+)\s*เมตร",
}
DAY_PATTERN = r"(\d{1,2})\s+(" + "|".join(MONTHS_TH) + r")\s+พ\.ศ\.\s*(\d{4})"


@dataclass
class Figure:
    flow: float
    yesterday: float | None = None
    level_m: float | None = None
    # metres between the water and the bank: below it when more than 0
    below_bank_m: float | None = None


def _number(text: str) -> float:
    return float(text.replace(",", ""))


def report_day(text: str) -> date | None:
    """The report's own date, "วันเสาร์ที่ 3 ตุลาคม พ.ศ. 2569" (Buddhist era)."""
    match = re.search(_bare(DAY_PATTERN), _bare(text))
    if not match:
        return None
    months = [_bare(name) for name in MONTHS_TH]
    try:
        return date(int(match.group(3)) - 543, months.index(match.group(2)) + 1, int(match.group(1)))
    except ValueError:
        return None


def parse_report(text: str) -> dict[str, Figure]:
    """The figures found in the report's text, by id; an id whose sentence is not there is left out."""
    bare = _bare(text)
    found: dict[str, Figure] = {}
    for point_id, pattern in PATTERNS.items():
        match = re.search(_bare(pattern), bare)
        if not match:
            continue
        groups = match.groups()
        found[point_id] = Figure(flow=_number(groups[0]),
                                 yesterday=_number(groups[1]) if len(groups) > 1 and groups[1] else None)
    for point_id, pattern in LEVEL_PATTERNS.items():
        match = re.search(_bare(pattern), bare)
        if match and point_id in found:
            gap = float(match.group(3))
            found[point_id].level_m = float(match.group(1))
            found[point_id].below_bank_m = gap if match.group(2) == _bare("ต่ำ") else -gap
    return found


def report_text(pdf: bytes) -> str:
    """The text of the report's pages (pypdf, BSD)."""
    from pypdf import PdfReader

    try:
        return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
    except Exception as exc:  # noqa: BLE001 - pypdf raises many kinds for a broken file
        raise ValueError(f"not a readable PDF: {type(exc).__name__}: {exc}") from exc


def registry() -> dict[str, Any]:
    """ref_data/rid_flows.json: what each figure is, where its site is on the map, and its capacity."""
    return json.loads(resources.files("fontokmai.ref_data").joinpath("rid_flows.json").read_text(encoding="utf-8"))


def data_time(day: date) -> datetime:
    """The report gives the flow at 06:00 of its day."""
    return datetime.combine(day, time(6, 0), tzinfo=ICT)


# "6.8 จังหวัดปทุมธานี พื้นที่ประสบอุทกภัย 6 อำเภอ ได้แก่ อ.ธัญบุรี อ.คลองหลวง ... และ อ.ลำลูกกา รวมพื้นที่..."
FLOODED_PATTERN = r"6\.\d+\s*จังหวัด(\S+)\s+พื้นที่ประสบอุทกภัย(.*?)(?=6\.\d+\s*จังหวัด|7\.\s|$)"
FLOODED_ENDS = ("มีน้ำท่วม", "รวมพื้นที่", "รายละเอียด")


def flooded_districts(text: str, districts: dict[str, str]) -> list[str]:
    """The DOPA codes of the districts the report's flood section names (section 6, by province). `districts` maps
    "province|district" (as _bare reduces them) to a code; a name that matches none is left out."""
    found: list[str] = []
    for match in re.finditer(_bare(FLOODED_PATTERN), _bare(text)):
        province, rest = match.group(1), match.group(2)
        for end in FLOODED_ENDS:
            rest = rest.split(_bare(end))[0]
        for name in re.findall(r"(?:อ\.|เขต)\s*([^\s,]+)", rest):
            code = districts.get(f"{province}|{name}")
            if code and code not in found:
                found.append(code)
    return found


def district_index() -> dict[str, str]:
    """"province|district" (both reduced by _bare) → DOPA code, from ref_data/places.json."""
    data = json.loads(resources.files("fontokmai.ref_data").joinpath("places.json").read_text(encoding="utf-8"))
    index = {}
    for place in data["places"]:
        if place.get("kind") != "district":
            continue
        label = place["label"]  # "อ.ธัญบุรี จ.ปทุมธานี" or "เขตดอนเมือง กรุงเทพมหานคร"
        district, _, province = label.partition(" ")
        district = district.removeprefix("อ.").removeprefix("เขต")
        province = province.removeprefix("จ.")
        index[f"{_bare(province)}|{_bare(district)}"] = place["code"]
    return index


Getter = Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]]
REPORT_LIMIT = 12_000_000  # the report is about 3.6 MB
TIMEOUT_S = 90


def conditional_get(url: str, validators: dict[str, str], limit: int = REPORT_LIMIT) -> tuple[int, bytes,
                                                                                               dict[str, str]]:
    """GET that sends what the server said about the last copy (ETag, Last-Modified): 304 and no body when the file
    has not changed, so the 3.6 MB report is downloaded once a day."""
    from fontokmai.sources.tmd_cap.fetch import USER_AGENT, make_ssl_context

    headers = {"User-Agent": USER_AGENT}
    if validators.get("etag"):
        headers["If-None-Match"] = validators["etag"]
    if validators.get("last_modified"):
        headers["If-Modified-Since"] = validators["last_modified"]
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=make_ssl_context()) as response:
            body = response.read(limit + 1)
            if len(body) > limit:
                raise OSError(f"{url}: larger than {limit} bytes")
            return 200, body, {"etag": response.headers.get("ETag") or "",
                               "last_modified": response.headers.get("Last-Modified") or ""}
    except urllib.error.HTTPError as exc:
        if exc.code == 304:
            return 304, b"", validators
        raise


FLOWS_PATH = "water/flows.json"
REFRESH = timedelta(hours=2)
ATTEMPT_KEY = "rid_report.last_attempt"
VALIDATORS_KEY = "rid_report.validators"
MIN_FIGURES = 8  # fewer than this found: the report's wording changed, and nothing is replaced


def build(figures: dict[str, Figure], states: dict[str, str | None], day: date, now: datetime,
          chart_url: str | None, flooded: list[str], registry_data: dict[str, Any] | None = None) -> RidFlows:
    """water/flows.json from what was read; every figure of the registry is listed, null where unread."""
    data = registry_data or registry()
    points = []
    for item in data["figures"]:
        figure = figures.get(item["id"])
        points.append(FlowPoint(
            id=item["id"], name_th=item["name_th"], kind=item["kind"], code=item.get("code"),
            flow_cms=figure.flow if figure else None, yesterday_cms=figure.yesterday if figure else None,
            capacity_cms=item.get("capacity_cms"),
            capacity_kind=item.get("capacity_kind", "channel") if item.get("capacity_cms") else None,
            into_th=item.get("into_th"), level_m=figure.level_m if figure else None,
            below_bank_m=figure.below_bank_m if figure else None, state=states.get(item["id"])))
    sites = [FlowSite(**site) for site in data["sites"]]
    return RidFlows(fetched_at=now.astimezone(ICT), report_date=day, observed_at=data_time(day),
                    source_url=REPORT_URL, chart_url=chart_url, page_url=CHART_PAGE_URL,
                    credit_th=data["credit_th"], location_credit_th=data["location_credit_th"], points=points,
                    sites=sites, flooded_districts=flooded, notes_th=data["notes_th"])


def refresh(out: Path, db: Path, now: datetime, *, get: Getter = conditional_get) -> str | None:
    """Every REFRESH: the day's report into water/flows.json (the next round publishes it), unless the file already
    holds a later day. A line for the round log, or None when it is not time yet."""
    with StateStore(db) as store:
        last = store.get_meta(ATTEMPT_KEY)
        if last and now - datetime.fromisoformat(last) < REFRESH:
            return None
        store.set_meta(ATTEMPT_KEY, now.isoformat())
        validators = json.loads(store.get_meta(VALIDATORS_KEY) or "{}")
    try:
        status, body, fresh = get(REPORT_URL, validators)
        if status == 304:
            return "report not changed"
        text = report_text(body)
        day = report_day(text)
        figures = parse_report(text)
        if day is None or len(figures) < MIN_FIGURES:
            return f"error: the report read as {len(figures)} figures, day {day}"
        data = registry()
        dots = {item["id"]: tuple(item["dot"]) for item in data["figures"] if item.get("dot")}
        states: dict[str, str | None] = {}
        chart_url = rid_chart.CHART_URL.format(day=day)
        try:
            _, picture, _ = get(chart_url, {})
            states = rid_chart.chart_states(picture, dots)
        except (OSError, rid_chart.ChartError):
            chart_url = None  # the chart is not up yet: the states wait for the next attempt
            fresh = {}
        flows = build(figures, states, day, now, chart_url, flooded_districts(text, district_index()), data)
    except Exception as exc:  # noqa: BLE001 - reported in the round log; the last good file stays
        return f"error: {type(exc).__name__}: {exc}"[:300]
    path = out / FLOWS_PATH
    try:
        current = RidFlows.model_validate_json(path.read_bytes())
    except (OSError, ValueError):
        current = None
    if current is not None and current.report_date > flows.report_date:
        return f"kept the report of {current.report_date.isoformat()}"
    atomic_write(path, flows.model_dump_json().encode("utf-8"))
    with StateStore(db) as store:
        # the report is read again only once both it and its chart were read
        store.set_meta(VALIDATORS_KEY, json.dumps(fresh))
    read_states = sum(1 for state in states.values() if state)
    return (f"built {len(figures)} figures of {day.isoformat()} ({read_states} station states, "
            f"{len(flows.flooded_districts)} flooded districts)")

