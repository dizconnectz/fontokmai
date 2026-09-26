"""BMA DXS, the data exchange of the Drainage and Sewerage Department (สำนักการระบายน้ำ กทม.).

SOAP 1.1 calls to the services approved for the user's account (request RQX256909000023, purpose "นำไปให้บริการ
เผยแพร่ข้อมูลต่อ"). Every call carries the account in an AuthHeader. The account is read from a file outside the
repository (two lines: user name, then password); it is never logged, printed or written anywhere else.
Terms (docs/requests/2026-09-26-bma-dxs.md): use only for the approved purpose, no other access path, text credit
without the department's logo, no links into DXS pages.
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from importlib import resources
from pathlib import Path
from typing import Any

from fontokmai.contracts.bkk import (
    CanalLevels,
    CanalStation,
    Dam,
    DamReport,
    RainGauge,
    RainGauges,
    RoadFloodingDaily,
    RoadFloodingReport,
    SituationReport,
    WeatherStation,
    WeatherToday,
)
from fontokmai.sources.tmd_cap.fetch import USER_AGENT, make_ssl_context

ENDPOINT = "https://dxg-api.dds.bangkok.go.th/WSS_DDSDXS.asmx"
NAMESPACE = "http://tempuri.org/"
SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
TIMEOUT_S = 60
LIMIT = 20_000_000

# (url, body, headers) -> response body
Poster = Callable[[str, bytes, dict[str, str]], bytes]


class DxsError(RuntimeError):
    """A DXS call failed; the message never contains the account."""


@dataclass(frozen=True)
class Account:
    username: str = field(repr=False)
    password: str = field(repr=False)


def load_account(path: Path) -> Account:
    try:
        lines = [line.strip() for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    except OSError as exc:
        raise DxsError(f"cannot read the DXS account file: {type(exc).__name__}") from None
    if len(lines) < 2:
        raise DxsError("the DXS account file needs two lines: the user name, then the password")
    return Account(lines[0], lines[1])


def envelope(operation: str, account: Account, params: dict[str, str] | None = None) -> bytes:
    ET.register_namespace("soap", SOAP)
    root = ET.Element(f"{{{SOAP}}}Envelope")
    header = ET.SubElement(ET.SubElement(root, f"{{{SOAP}}}Header"), f"{{{NAMESPACE}}}AuthHeader")
    ET.SubElement(header, f"{{{NAMESPACE}}}Username").text = account.username
    ET.SubElement(header, f"{{{NAMESPACE}}}Password").text = account.password
    call = ET.SubElement(ET.SubElement(root, f"{{{SOAP}}}Body"), f"{{{NAMESPACE}}}{operation}")
    for name, value in (params or {}).items():
        ET.SubElement(call, f"{{{NAMESPACE}}}{name}").text = value
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def https_post(url: str, body: bytes, headers: dict[str, str]) -> bytes:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=make_ssl_context()) as response:
            data = response.read(LIMIT + 1)
    except urllib.error.HTTPError as exc:
        # a SOAP fault comes back as HTTP 500 with an XML body worth reading
        data = exc.read(LIMIT + 1)
        if b"Fault" not in data:
            raise DxsError(f"HTTP {exc.code}") from None
    except OSError as exc:
        raise DxsError(f"{type(exc).__name__}: {exc}") from None
    if len(data) > LIMIT:
        raise DxsError(f"answer larger than {LIMIT} bytes")
    return data


def fixture_poster(directory: Path) -> Poster:
    """Answers from recorded or synthetic files named after the service, e.g. GetWaterInfo.xml (tests)."""

    def post(url: str, body: bytes, headers: dict[str, str]) -> bytes:
        operation = headers["SOAPAction"].strip('"').rsplit("/", 1)[-1]
        try:
            return (directory / f"{operation}.xml").read_bytes()
        except OSError:
            raise DxsError(f"HTTP 500 (no fixture for {operation})") from None

    return post


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def call(operation: str, account: Account, params: dict[str, str] | None = None, *,
         post: Poster = https_post) -> ET.Element:
    """The element the operation returns (its …Result or named result), namespaces kept."""
    headers = {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": f'"{NAMESPACE}{operation}"',
               "User-Agent": USER_AGENT}
    raw = post(ENDPOINT, envelope(operation, account, params), headers)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise DxsError(f"{operation}: answer is not XML ({exc})") from None
    fault = root.find(f".//{{{SOAP}}}Fault")
    if fault is not None:
        reason = next((c.text for c in fault.iter() if local(c.tag) == "faultstring"), None) or "SOAP fault"
        raise DxsError(f"{operation}: {reason.strip()[:200]}")
    body = root.find(f"{{{SOAP}}}Body")
    response = body[0] if body is not None and len(body) else None
    if response is None or local(response.tag) != f"{operation}Response" or not len(response):
        raise DxsError(f"{operation}: no result in the answer")
    return response[0]


def child(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    return next((c for c in element if local(c.tag) == name), None)


def children(element: ET.Element | None, name: str) -> list[ET.Element]:
    return [] if element is None else [c for c in element if local(c.tag) == name]


def text(element: ET.Element | None, name: str) -> str | None:
    found = child(element, name)
    value = (found.text or "").strip() if found is not None else ""
    return value or None


def outline(element: ET.Element, depth: int = 0, limit: int = 6) -> list[str]:
    """A short picture of an answer for development: tags, how often they repeat, and the first values."""
    lines: list[str] = []
    seen: dict[str, int] = {}
    for item in element:
        seen[local(item.tag)] = seen.get(local(item.tag), 0) + 1
    shown: set[str] = set()
    for item in element:
        name = local(item.tag)
        if name in shown:
            continue
        shown.add(name)
        count = f" ×{seen[name]}" if seen[name] > 1 else ""
        if len(item):
            lines.append(f"{'  ' * depth}{name}{count}")
            if depth < limit:
                lines += outline(item, depth + 1, limit)
        else:
            lines.append(f"{'  ' * depth}{name}{count} = {(item.text or '').strip()[:80]!r}")
    return lines


# ---------- canal water levels and rain gauges, every round ----------

SOURCE_ID = "bma_dxs"
WATER_PATH = "bkk/water.json"
RAIN_PATH = "bkk/rain.json"
WATER_PAGE = "https://weather.bangkok.go.th/water/summary"
RAIN_PAGE = "https://weather.bangkok.go.th/"
CREDIT_TH = "สำนักการระบายน้ำ กรุงเทพมหานคร (ผ่านระบบ DXS)"
WATER_NOTES_TH = [
    "ระดับน้ำเป็นเมตรเทียบระดับทะเลปานกลาง (ม.รทก.) ไม่ใช่ความลึกของน้ำท่วมบนถนน",
    "ด้านใน/ด้านนอกคือสองฝั่งของสถานีสูบน้ำหรือประตูระบายน้ำ ตามที่สำนักการระบายน้ำรายงาน",
]
RAIN_NOTES_TH = ["ฝนที่วัดได้จริงที่สถานีของสำนักการระบายน้ำ (มม.) ไม่ใช่ค่าประมาณจากเรดาร์"]
ICT = timezone(timedelta(hours=7))
# generous box around Bangkok and its edges, to drop a swapped or empty coordinate
AREA = (100.2, 13.4, 101.0, 14.2)


def _number(value: str | None, low: float, high: float) -> float | None:
    try:
        number = float(value) if value is not None else None
    except ValueError:
        return None
    return number if number is not None and low <= number <= high and number == number else None


def _position(item: ET.Element) -> list[float] | None:
    lon = _number(text(item, "longitude"), AREA[0], AREA[2])
    lat = _number(text(item, "latitude"), AREA[1], AREA[3])
    return [round(lon, 6), round(lat, 6)] if lon is not None and lat is not None else None


def _when(value: str | None) -> datetime | None:
    """A DXS time; one without an offset is Thai time, and a Buddhist-era year is turned into the common era."""
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.year > 2400:
        moment = moment.replace(year=moment.year - 543)
    return (moment if moment.tzinfo else moment.replace(tzinfo=ICT)).astimezone(ICT)


def _items(result: ET.Element) -> list[ET.Element]:
    error = text(result, "error")
    if error:
        raise DxsError(f"{local(result.tag)}: {error[:200]}")
    return children(child(result, "Items"), "item")


def parse_water(info: ET.Element, last: ET.Element, now: datetime) -> CanalLevels:
    readings = {text(item, "code"): item for item in _items(last)}
    stations = []
    for item in _items(info):
        code = text(item, "code")
        name = text(item, "name")
        if not code or not name:
            continue
        reading = readings.get(code)
        pumps = _number(text(reading, "pump_count"), 0, 100) if reading is not None else None
        stations.append(CanalStation(
            code=code, name_th=name, canal_th=text(item, "river"), district_th=text(item, "district"),
            location=_position(item),
            observed_at=_when(text(reading, "site_time")) if reading is not None else None,
            level_in_m=_number(text(reading, "wl_in"), -10, 10) if reading is not None else None,
            level_out_m=_number(text(reading, "wl_out01"), -10, 10) if reading is not None else None,
            pumps=int(pumps) if pumps else None,
        ))
    stations.sort(key=lambda station: station.code)
    return CanalLevels(fetched_at=now.astimezone(ICT), source_url=WATER_PAGE, credit_th=CREDIT_TH,
                       stations=stations, notes_th=WATER_NOTES_TH)


def parse_rain(info: ET.Element, last: ET.Element, now: datetime) -> RainGauges:
    readings = {text(item, "code"): item for item in _items(last)}
    gauges = []
    for item in _items(info):
        code = text(item, "code")
        name = text(item, "name")
        if not code or not name:
            continue
        reading = readings.get(code)

        def rain(tag: str, reading: ET.Element | None = reading) -> float | None:
            return _number(text(reading, tag), 0, 1000) if reading is not None else None

        gauges.append(RainGauge(
            code=code, name_th=name, district_th=text(item, "district"), location=_position(item),
            observed_at=_when(text(reading, "site_time")) if reading is not None else None,
            rain_15min_mm=rain("rf15min"), rain_1h_mm=rain("rf1hr"), rain_3h_mm=rain("rf3hr"),
            rain_24h_mm=rain("rf24rh"),
        ))
    gauges.sort(key=lambda gauge: gauge.code)
    return RainGauges(fetched_at=now.astimezone(ICT), source_url=RAIN_PAGE, credit_th=CREDIT_TH, gauges=gauges,
                      notes_th=RAIN_NOTES_TH)


@dataclass(frozen=True)
class DxsRound:
    water: CanalLevels | None
    rain: RainGauges | None
    flooding: RoadFloodingDaily | None
    ok: bool
    seen: int
    message: str | None


def _previous(out: Path, rel: str, model: type[CanalLevels] | type[RainGauges] | type[RoadFloodingDaily]) -> Any:
    try:
        return model.model_validate_json((out / rel).read_bytes())
    except (OSError, ValueError):
        return None


# DXS answers only addresses in Thailand, so the VPS may get these files from a manual run on a computer in
# Thailand (`bkk-fetch`) instead of calling DXS itself. A delivered file is listed for 30 days after its fetch
# time; the web says how old it is (not real time after a day).
RELAY_MAX_AGE = timedelta(days=30)
RELAY_MODELS: dict[str, Any] = {}  # filled below, once the paths exist


def relay_files(out: Path, now: datetime) -> dict[str, bytes]:
    """Bangkok files delivered by a manual run: those that pass their contract and are less than a day old."""
    files = {}
    for rel, model in RELAY_MODELS.items():
        try:
            content = (out / rel).read_bytes()
            fetched = model.model_validate_json(content).fetched_at
        except (OSError, ValueError):
            continue
        if now - fetched <= RELAY_MAX_AGE:
            files[rel] = content
    return files


def collect_bkk(account: Account, out: Path, now: datetime, *, post: Poster = https_post) -> DxsRound:
    """Water levels and rain of this round; a part that fails keeps its last good file (fetched_at shows its age)."""
    water = rain = None
    problems = []
    try:
        water = parse_water(call("GetWaterInfo", account, post=post), call("GetWaterLastData", account, post=post),
                            now)
    except (DxsError, ValueError) as exc:
        problems.append(f"water: {exc}"[:200])
    try:
        rain = parse_rain(call("GetRainInfo", account, post=post), call("GetRainLastData", account, post=post), now)
    except (DxsError, ValueError) as exc:
        problems.append(f"rain: {exc}"[:200])
    flooding = None
    today = now.astimezone(ICT).date()
    try:
        answer = call("getFloodingDailyReport", account, {"DailyReport": report_param(today)}, post=post)
        flooding = parse_flooding(answer, today, now)
    except (DxsError, ValueError) as exc:
        problems.append(f"flooding: {exc}"[:200])
    seen = sum(len(items) for items in (water.stations if water else [], rain.gauges if rain else [],
                                        flooding.reports if flooding else []))
    return DxsRound(water=water or _previous(out, WATER_PATH, CanalLevels),
                    rain=rain or _previous(out, RAIN_PATH, RainGauges),
                    flooding=flooding or _previous(out, FLOODING_PATH, RoadFloodingDaily),
                    ok=not problems, seen=seen, message="; ".join(problems) or None)


# ---------- daily report of flooded main roads ----------

FLOODING_PATH = "bkk/flooding.json"
FLOODING_PAGE = "https://dds.bangkok.go.th/flood_report.php"
FLOODING_NOTES_TH = [
    "รายงานของเจ้าหน้าที่สำนักการระบายน้ำ เฉพาะถนนสายหลักที่ดูแล ไม่ครบทุกถนนและซอย",
    "ความสูงเป็นเซนติเมตรบนผิวถนน · ถนนที่ไม่มีในรายงานไม่ได้แปลว่าไม่ท่วม",
]
DAY_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%Y%m%d", "%d-%m-%Y")
# the report writes 00:00 (the public page) or ":" (DXS) as the dry time of a road that is still flooded
NOT_DRY = {"", ":", "00:00", "0:00", "00:00:00", "-"}


def _day(value: str | None) -> date | None:
    if not value:
        return None
    head = value.strip().split(" ")[0].split("T")[0]
    for pattern in DAY_FORMATS:
        try:
            parsed = datetime.strptime(head, pattern).date()
        except ValueError:
            continue
        return parsed.replace(year=parsed.year - 543) if parsed.year > 2400 else parsed
    return None


def _at(day: date | None, clock: str | None) -> datetime | None:
    if day is None or not clock:
        return None
    parts = clock.strip().replace(".", ":").split(":")
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except (IndexError, ValueError):
        return None
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return None
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ICT)


def _utc(value: str | None) -> datetime | None:
    """LastUpdate of the road report is UTC without an offset: on 2026-09-26 it read 11:35:17 while the same
    report already held a road that dried at 18:25 Thai time."""
    try:
        moment = datetime.fromisoformat(value) if value else None
    except ValueError:
        return None
    if moment is None:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=UTC)).astimezone(ICT)


def report_param(day: date) -> str:
    """The date as the service takes it (checked against the real service)."""
    return day.isoformat()


def parse_flooding(result: ET.Element, day: date, now: datetime) -> RoadFloodingDaily:
    control = child(result, "Control")
    reported = _day(text(control, "DailyReport"))
    if reported is not None and reported != day:
        raise DxsError(f"getFloodingDailyReport answered for {reported} instead of {day}")
    reports = []
    for item in children(child(result, "Detail"), "FloodingDailyReportDetail"):
        road = text(item, "RoadName")
        if not road:
            continue
        start_day = _day(text(item, "FloodStartDate")) or day
        finish = text(item, "FloodFinishTime")
        still = finish is None or finish.strip() in NOT_DRY and not text(item, "Durationtime_flood")
        depths = [d for d in (_number(text(item, "FloodHighFrommm"), 0, 300),
                              _number(text(item, "FloddHightomm"), 0, 300)) if d is not None]
        reports.append(RoadFloodingReport(
            district_th=text(item, "DistricName"), road_th=road,
            area_th=text(item, "AreaDetail") or text(item, "MonitorPointName"),
            depth_cm=max(depths) if depths else None,
            length_m=_number(text(item, "FloodLength"), 0, 50_000),
            lanes_th=text(item, "ImpactTrafficSurface"),
            flood_start=_at(start_day, text(item, "FloodStartTime")),
            dry_at=None if still else _at(_day(text(item, "FloodFinishDate")) or start_day, finish),
            rain_mm=_number(text(item, "TotolRainmm"), 0, 1000),
        ))
    reports.sort(key=lambda r: (r.dry_at is not None, -(r.flood_start.timestamp() if r.flood_start else 0)))
    return RoadFloodingDaily(fetched_at=now.astimezone(ICT), report_date=day,
                             updated_at=_utc(text(control, "LastUpdate")), source_url=FLOODING_PAGE,
                             credit_th=CREDIT_TH, reports=reports, notes_th=FLOODING_NOTES_TH)


RELAY_MODELS.update({WATER_PATH: CanalLevels, RAIN_PATH: RainGauges, FLOODING_PATH: RoadFloodingDaily})


# ---------- the department's situation text, large dams (RID/EGAT) and TMD's weather today ----------

NEWS_PATH = "bkk/news.json"
DAMS_PATH = "water/dams.json"
WEATHER_PATH = "weather/today.json"
NEWS_PAGE = "https://dds.bangkok.go.th/"
DAMS_PAGE = "https://water.rid.go.th/"
WEATHER_PAGE = "https://www.tmd.go.th/"
DAMS_CREDIT_TH = "กรมชลประทานและ กฟผ. (ผ่านระบบ DXS ของสำนักการระบายน้ำ กรุงเทพมหานคร)"
WEATHER_CREDIT_TH = "กรมอุตุนิยมวิทยา (ผ่านระบบ DXS ของสำนักการระบายน้ำ กรุงเทพมหานคร)"
DAMS_NOTES_TH = [
    "ปริมาณน้ำเป็นล้าน ลบ.ม. และร้อยละของความจุที่ระดับเก็บกัก · น้ำไหลเข้าและระบายเป็นของวันที่รายงาน",
    "น้ำเกินร้อยละ 80 แปลว่าเหลือที่รับน้ำน้อย ไม่ได้แปลว่าท้ายเขื่อนจะท่วม",
]
WEATHER_NOTES_TH = ["ข้อมูลตรวจอากาศรอบเช้าของสถานีกรมอุตุฯ ทั่วประเทศ · ฝนเป็นปริมาณที่รายงานพร้อมรอบตรวจนั้น"]
TAG = re.compile(r"<[^>]+>")
BREAK = re.compile(r"<\s*(br\s*/?|/p|/div|/li)\s*>", re.IGNORECASE)


def _plain(value: str | None) -> str:
    """HTML of the department's message as plain text; nothing of the markup is kept."""
    text_ = BREAK.sub("\n", value or "")
    text_ = html.unescape(TAG.sub("", text_))
    lines = [" ".join(line.split()) for line in text_.splitlines()]
    return "\n".join(line for line in lines if line)


def parse_news(result: ET.Element, now: datetime) -> SituationReport:
    subject = text(result, "Subject")
    body = _plain(text(result, "Message"))
    if not subject or not body:
        raise DxsError("getNews: no subject or message")
    return SituationReport(fetched_at=now.astimezone(ICT), subject_th=subject, text_th=body,
                           created_at=_when(text(result, "CreateDate")), updated_at=_when(text(result, "LastUpdate")),
                           source_url=NEWS_PAGE, credit_th=CREDIT_TH,
                           notes_th=["ข้อความของสำนักการระบายน้ำ ไม่ได้แก้ไขเนื้อหา"])


def dam_locations() -> dict[str, dict[str, Any]]:
    raw = resources.files("fontokmai.ref_data").joinpath("dam_locations.json").read_text(encoding="utf-8")
    return json.loads(raw)["dams"]


def parse_dams(result: ET.Element, now: datetime) -> DamReport:
    day = _day(text(result, "date"))
    if day is None:
        raise DxsError("GetDam: no report date")
    places = dam_locations()
    dams = []
    for datum in children(child(result, "data"), "Datum"):
        region = text(datum, "region")
        for item in children(child(datum, "dam"), "item"):
            dam_id = text(item, "id")
            name = text(item, "name")
            if not dam_id or not name:
                continue
            place = places.get(dam_id)
            dams.append(Dam(
                id=dam_id, name_th=name, region_th=region, owner_th=text(item, "owner"),
                location=place["location"] if place else None, location_kind=place["kind"] if place else None,
                storage_mcm=_number(text(item, "storage"), 0, 100_000),
                volume_mcm=_number(text(item, "volume"), 0, 100_000),
                percent=_number(text(item, "percent_storage"), 0, 200),
                inflow_mcm=_number(text(item, "inflow"), 0, 10_000),
                outflow_mcm=_number(text(item, "outflow"), 0, 10_000),
            ))
    if not dams:
        raise DxsError("GetDam: no dam in the answer")
    return DamReport(fetched_at=now.astimezone(ICT), report_date=day, source_url=DAMS_PAGE, credit_th=DAMS_CREDIT_TH,
                     location_credit_th="ตำแหน่งจาก OpenStreetMap (ODbL)", dams=dams, notes_th=DAMS_NOTES_TH)


def parse_weather(result: ET.Element, now: datetime) -> WeatherToday:
    stations = []
    for item in children(child(result, "Stations"), "Station"):
        wmo = text(item, "WmoStationNumber")
        name = text(item, "StationNameThai")
        if not wmo or not name:
            continue
        observation = child(item, "Observation")
        lon = _number(text(item, "Longitude"), 97, 106)
        lat = _number(text(item, "Latitude"), 5, 21)
        stations.append(WeatherStation(
            wmo=wmo, name_th=name, province_th=text(item, "Province"),
            location=[round(lon, 5), round(lat, 5)] if lon is not None and lat is not None else None,
            observed_at=_when(text(observation, "DateTime")),
            temperature_c=_number(text(observation, "Temperature"), -10, 50),
            max_c=_number(text(observation, "MaxTemperature"), -10, 50),
            min_c=_number(text(observation, "MinTemperature"), -10, 50),
            humidity_pct=_number(text(observation, "RelativeHumidity"), 0, 100),
            rain_mm=_number(text(observation, "Rainfall"), 0, 1000),
        ))
    if not stations:
        raise DxsError("GetWeatherToday: no station in the answer")
    return WeatherToday(fetched_at=now.astimezone(ICT), source_url=WEATHER_PAGE, credit_th=WEATHER_CREDIT_TH,
                        stations=stations, notes_th=WEATHER_NOTES_TH)


def collect_extras(account: Account, now: datetime, *, post: Poster = https_post) -> tuple[dict[str, Any], list[str]]:
    """The situation text, the large dams and TMD's weather today: {path: model} of the parts that worked."""
    parts: dict[str, Any] = {}
    problems = []
    for rel, operation, parse in ((NEWS_PATH, "getNews", parse_news), (DAMS_PATH, "GetDam", parse_dams),
                                  (WEATHER_PATH, "GetWeatherToday", parse_weather)):
        try:
            parts[rel] = parse(call(operation, account, post=post), now)
        except (DxsError, ValueError) as exc:
            problems.append(f"{operation}: {exc}"[:200])
    return parts, problems


RELAY_MODELS.update({NEWS_PATH: SituationReport, DAMS_PATH: DamReport, WEATHER_PATH: WeatherToday})
