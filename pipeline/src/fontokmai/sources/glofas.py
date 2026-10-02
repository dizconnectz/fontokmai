"""GloFAS river discharge through the Open-Meteo Flood API (free for non-commercial use, data CC BY 4.0).

Daily discharge of the Global Flood Awareness System (Copernicus Emergency Management Service) at a few points on
the main rivers of Thailand (ref_data/river_points.json), 7 days back, the day of the fetch and 29 ahead. It is a
global model on a 0.05° grid: its values can be far from the discharge measured on the river, so the site shows
whether the water is forecast to rise or fall, not the number. One request asks for every point; the forecast
changes once a day.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from importlib import resources
from typing import Any
from urllib.parse import urlencode

from fontokmai.contracts.forecast import RiverForecast, RiverPoint
from fontokmai.sources.open_data.http import OpenDataError, Opener, open_url, read_json

API_URL = "https://flood-api.open-meteo.com/v1/flood"
PAGE_URL = "https://open-meteo.com/en/docs/flood-api"
PAST_DAYS = 7
FORECAST_DAYS = 30  # counts the day of the fetch: the last day is 29 days after it
FIELDS = ("river_discharge", "river_discharge_median", "river_discharge_p25", "river_discharge_p75")
MAX_FLOW = 200_000.0  # m³/s, far above any river of the region: a larger value is not a discharge
ICT = timezone(timedelta(hours=7))
NAME_TH = "แนวโน้มน้ำในแม่น้ำจากแบบจำลอง GloFAS"
CREDIT_TH = "GloFAS · Copernicus Emergency Management Service ผ่าน Open-Meteo.com (CC BY 4.0)"
NOTES_TH = [
    "เป็นค่าจากแบบจำลองน้ำท่าระดับโลก ไม่ใช่ปริมาณหรือระดับน้ำที่วัดได้จริง และไม่ใช่ประกาศของหน่วยงาน",
    "ค่าของแบบจำลองอาจต่างจากค่าที่วัดได้มาก จึงใช้ดูแนวโน้มว่าน้ำจะเพิ่มหรือลดเท่านั้น",
    "ปรับปรุงวันละครั้ง",
]


def load_points() -> list[dict[str, Any]]:
    """The river stations shipped with the package: id, name_th, river_th and location [lon, lat]."""
    data = json.loads(resources.files("fontokmai.ref_data").joinpath("river_points.json").read_bytes())
    return data["points"]


def load_reaches() -> list[dict[str, Any]]:
    """The reach points between the stations (ref_data/river_reaches.json, build_river_lines.py), kind "reach"."""
    data = json.loads(resources.files("fontokmai.ref_data").joinpath("river_reaches.json").read_bytes())
    return data["points"]


def all_points() -> list[dict[str, Any]]:
    """What the daily fetch asks for: the stations, then the reach points that colour the river stretches."""
    return load_points() + load_reaches()


def calls(points: int) -> int:
    """API calls one request costs: Open-Meteo counts a location asking for more than two weeks as several."""
    return points * math.ceil((PAST_DAYS + FORECAST_DAYS) / 14)


def request_url(points: list[dict[str, Any]]) -> str:
    return API_URL + "?" + urlencode({
        "latitude": ",".join(f"{p['location'][1]:g}" for p in points),
        "longitude": ",".join(f"{p['location'][0]:g}" for p in points),
        "daily": ",".join(FIELDS),
        "past_days": PAST_DAYS,
        "forecast_days": FORECAST_DAYS,
        "timezone": "Asia/Bangkok",
    })


def _flow(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= MAX_FLOW:
        return None
    return round(float(value), 1)


def build_forecast(answers: list[dict[str, Any]], points: list[dict[str, Any]], now: datetime) -> RiverForecast:
    """The days of the answer (Thai calendar), which must include the day of the fetch."""
    try:
        days = answers[0]["daily"]["time"]
        if any(a["daily"]["time"] != days for a in answers):
            raise OpenDataError("Open-Meteo flood points disagree on the days")
        if now.astimezone(ICT).date().isoformat() not in days:
            raise OpenDataError("Open-Meteo flood answer does not reach the day of the fetch")
        forecast = RiverForecast(
            name_th=NAME_TH, credit_th=CREDIT_TH, source_url=PAGE_URL, fetched_at=now,
            days=[date.fromisoformat(d) for d in days],
            points=[RiverPoint(
                id=point["id"], kind=point.get("kind", "station"), name_th=point["name_th"],
                river_th=point["river_th"], location=point["location"],
                discharge=[_flow(v) for v in answer["daily"]["river_discharge"]],
                median=[_flow(v) for v in answer["daily"]["river_discharge_median"]],
                p25=[_flow(v) for v in answer["daily"]["river_discharge_p25"]],
                p75=[_flow(v) for v in answer["daily"]["river_discharge_p75"]],
            ) for point, answer in zip(points, answers, strict=True)],
            notes_th=NOTES_TH,
        )
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise OpenDataError(f"Open-Meteo flood answer not understood: {type(exc).__name__}: {exc}") from exc
    return forecast


def collect(now: datetime, *, opener: Opener = open_url, points: list[dict[str, Any]] | None = None,
            spend: Callable[[int], None] | None = None) -> RiverForecast:
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    points = points if points is not None else load_points()
    if spend:
        spend(calls(len(points)))  # counted before asking: a failed request may count too
    data = read_json(opener, request_url(points))
    answers = [data] if isinstance(data, dict) else data
    if not isinstance(answers, list) or len(answers) != len(points) or not all(isinstance(a, dict) for a in answers):
        raise OpenDataError(f"Open-Meteo flood API answered {type(data).__name__} for {len(points)} points")
    return build_forecast(answers, points, now)
