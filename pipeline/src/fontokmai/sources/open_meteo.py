"""Open-Meteo forecast API (free for non-commercial use, data CC BY 4.0): rain on a lattice over Thailand.

Every location in a request counts as one API call. The free service allows 600 calls a minute, 5,000 an hour
and 10,000 a day, so the lattice is 0.25° (about 900 points on and around Thai land), batches are paced to
400 calls a minute (a run takes about 2.5 minutes) and the forecast is refreshed every 6 hours (about 3,700 calls
a day). Nothing is kept from earlier runs: each run replaces forecast/rain.json.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from fontokmai.contracts.forecast import ForecastLattice, RainForecast
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.sources.open_data.http import OpenDataError, Opener, open_url, read_json

API_URL = "https://api.open-meteo.com/v1/forecast"
PAGE_URL = "https://open-meteo.com/"
STEP = 0.25
REACH = 0.25  # keep lattice points this close (on both axes) to a subdistrict point
BATCH = 100
CALLS_PER_MINUTE = 400  # below the 600 a minute of the free service
PAUSE_S = BATCH * 60 / CALLS_PER_MINUTE
HOURS = 72
DAYS = 7
ICT = timezone(timedelta(hours=7))
NAME_TH = "พยากรณ์ฝนจากแบบจำลอง"
CREDIT_TH = "Open-Meteo.com (CC BY 4.0) จากแบบจำลองของ ECMWF, NOAA, DWD และอื่นๆ"
NOTES_TH = [
    "เป็นพยากรณ์จากแบบจำลองคอมพิวเตอร์ ไม่ใช่ประกาศของกรมอุตุนิยมวิทยา",
    "ค่าเป็นฝนเฉลี่ยของพื้นที่ราว 25 กม. ฝนที่ตกจริงตรงจุดหนึ่งอาจมากหรือน้อยกว่านี้มาก",
    "ปรับปรุงราวทุก 6 ชั่วโมง",
]


def thailand_lattice(gazetteer: PlaceGazetteer) -> tuple[ForecastLattice, list[list[int]]]:
    """Lattice points within REACH of a subdistrict point, as [col, row] from the south-west corner."""
    keys: set[tuple[int, int]] = set()
    for place in gazetteer.places:
        if place.kind != "subdistrict":
            continue
        lon, lat = place.location
        for col in range(math.floor((lon - REACH) / STEP), math.ceil((lon + REACH) / STEP) + 1):
            for row in range(math.floor((lat - REACH) / STEP), math.ceil((lat + REACH) / STEP) + 1):
                if abs(col * STEP - lon) <= REACH and abs(row * STEP - lat) <= REACH:
                    keys.add((col, row))
    west, south = min(c for c, _ in keys), min(r for _, r in keys)
    lattice = ForecastLattice(west=west * STEP, south=south * STEP, step=STEP)
    return lattice, [[c - west, r - south] for c, r in sorted(keys, key=lambda k: (k[1], k[0]))]


def lonlat(lattice: ForecastLattice, point: list[int]) -> tuple[float, float]:
    return round(lattice.west + point[0] * lattice.step, 4), round(lattice.south + point[1] * lattice.step, 4)


def batch_url(coordinates: list[tuple[float, float]]) -> str:
    return API_URL + "?" + urlencode({
        "latitude": ",".join(f"{lat:g}" for _, lat in coordinates),
        "longitude": ",".join(f"{lon:g}" for lon, _ in coordinates),
        "hourly": "precipitation",
        "daily": "precipitation_sum,precipitation_probability_max,weather_code",
        "timezone": "Asia/Bangkok",
        "forecast_days": DAYS,
    })


def _fetch(opener: Opener, coordinates: list[tuple[float, float]], pause: float,
           spend: Callable[[int], None] | None = None) -> list[dict[str, Any]]:
    answers: list[dict[str, Any]] = []
    batches = -(-len(coordinates) // BATCH)
    for start in range(0, len(coordinates), BATCH):
        chunk = coordinates[start:start + BATCH]
        if spend:
            spend(len(chunk))  # every location is one call, counted before asking (a failed request may count)
        url = batch_url(chunk)
        try:
            data = read_json(opener, url)
        except OpenDataError as exc:  # the URL lists 100 points: keep the reason, not the URL
            reason = str(exc).replace(url, "").lstrip(": ")
            raise OpenDataError(f"Open-Meteo batch {start // BATCH + 1}/{batches}: {reason}") from exc
        data = [data] if isinstance(data, dict) else data
        if not isinstance(data, list) or len(data) != len(chunk) or not all(isinstance(d, dict) for d in data):
            raise OpenDataError(f"Open-Meteo answered {type(data).__name__} for {len(chunk)} points")
        answers.extend(data)
        if pause and start + BATCH < len(coordinates):
            time.sleep(pause)  # stay under the per-minute limit of the free service
    return answers


def _tenths(value: Any, upper: float) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= upper:
        return None
    return round(value * 10)


def _whole(value: Any, upper: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= upper:
        return None
    return round(value)


def build_forecast(answers: list[dict[str, Any]], lattice: ForecastLattice, points: list[list[int]],
                   now: datetime) -> RainForecast:
    """Hours ending after the start of the current hour, for HOURS hours, and DAYS days from today."""
    try:
        times = answers[0]["hourly"]["time"]
        days = answers[0]["daily"]["time"]
        if any(a["hourly"]["time"] != times or a["daily"]["time"] != days for a in answers):
            raise OpenDataError("Open-Meteo points disagree on the time axis")
        ends = [datetime.fromisoformat(t).replace(tzinfo=ICT) for t in times]
        hour = now.astimezone(ICT).replace(minute=0, second=0, microsecond=0)
        keep = [i for i, end in enumerate(ends) if hour < end <= hour + timedelta(hours=HOURS)]
        hourly = [a["hourly"]["precipitation"] for a in answers]
        daily = [a["daily"] for a in answers]
        forecast = RainForecast(
            name_th=NAME_TH, credit_th=CREDIT_TH, source_url=PAGE_URL, fetched_at=now, lattice=lattice,
            points=points, hours=[ends[i] for i in keep],
            rain=[[_tenths(values[i], 500) for values in hourly] for i in keep],
            days=[date.fromisoformat(d) for d in days],
            day_rain=[[_tenths(d["precipitation_sum"][k], 2000) for d in daily] for k in range(len(days))],
            day_probability=[[_whole(d["precipitation_probability_max"][k], 100) for d in daily]
                             for k in range(len(days))],
            day_code=[[_whole(d["weather_code"][k], 99) for d in daily] for k in range(len(days))],
            notes_th=NOTES_TH,
        )
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise OpenDataError(f"Open-Meteo answer not understood: {type(exc).__name__}: {exc}") from exc
    if not forecast.hours:
        raise OpenDataError("Open-Meteo answer has no hour after now")
    return forecast


def collect(now: datetime, lattice: ForecastLattice, points: list[list[int]], *, opener: Opener = open_url,
            pause: float = PAUSE_S, spend: Callable[[int], None] | None = None) -> RainForecast:
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    answers = _fetch(opener, [lonlat(lattice, p) for p in points], pause, spend)
    return build_forecast(answers, lattice, points, now)
