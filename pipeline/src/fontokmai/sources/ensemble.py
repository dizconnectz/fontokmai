"""Small pilot ensemble requests, independently accounted by location/model, retaining daily members."""
from __future__ import annotations

import math
import re
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from importlib import resources
from urllib.parse import urlencode

from fontokmai.contracts.outlook import (
    EnsembleMember,
    HydrologyPoint,
    OutlookPoint,
    PointEnsemble,
    RainOutlook,
)
from fontokmai.sources.open_data.http import OpenDataError, Opener, open_url, read_json

MODELS = {"ecmwf_ifs025": 51, "gfs05": 31}
ICT = timezone(timedelta(hours=7))
BATCH = 4
# Reserve conservatively for members, 15 days and failed attempts; share the existing 8,000-call budget.
CALLS_PER_POINT_MODEL = 12
PACE = BATCH * CALLS_PER_POINT_MODEL * 60 / 400
API = "https://ensemble-api.open-meteo.com/v1/ensemble"


def load_points() -> list[HydrologyPoint]:
    return [HydrologyPoint.model_validate(p) for p in read_json_registry()["points"]]


def read_json_registry() -> dict:
    import json
    return json.loads(resources.files("fontokmai.ref_data").joinpath("hydrology.json").read_text("utf-8"))


def calls(count: int) -> int:
    return count * len(MODELS) * CALLS_PER_POINT_MODEL


def request_url(points: list[HydrologyPoint], model: str) -> str:
    return API + "?" + urlencode({
        "latitude": ",".join(str(p.location[1]) for p in points),
        "longitude": ",".join(str(p.location[0]) for p in points),
        "models": model, "daily": "precipitation_sum", "forecast_days": 15, "timezone": "Asia/Bangkok",
    })


def parse(data: dict, model: str, days: list, now: datetime) -> PointEnsemble:
    if data.get("utc_offset_seconds") != 25200 or data.get("daily_units", {}).get("precipitation_sum") != "mm":
        raise OpenDataError("ensemble units or timezone not supported")
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    if len(dates) != len(set(dates)) or dates != sorted(dates):
        raise OpenDataError("ensemble dates not unique and ordered")
    members = []
    for key, values in daily.items():
        match = re.fullmatch(r"precipitation_sum(?:_member(\d+))?", key)
        if not match:
            continue
        if not isinstance(values, list) or len(values) != len(dates):
            raise OpenDataError("ensemble member time axis does not match")
        member_id = match.group(1) or "00"
        if int(member_id) >= MODELS[model]:
            raise OpenDataError("unexpected ensemble member")
        rain = []
        for day in days:
            value = values[dates.index(day.isoformat())] if day.isoformat() in dates else None
            rain.append(round(value, 2) if not isinstance(value, bool) and isinstance(value, int | float)
                        and math.isfinite(value) and 0 <= value <= 2000 else None)
        members.append(EnsembleMember(id=f"{int(member_id):02d}", rain_mm=rain))
    if not members:
        raise OpenDataError("no rain members returned")
    return PointEnsemble(model=model, expected_members=MODELS[model], fetched_at=now,
                         grid_location=(data["longitude"], data["latitude"]), members=members)


def collect(now: datetime, *, points: list[HydrologyPoint] | None = None, opener: Opener = open_url,
            spend: Callable[[int], None] | None = None, pause: float = PACE) -> RainOutlook:
    if now.tzinfo is None:
        raise ValueError("now must be timezone aware")
    points = points if points is not None else load_points()
    today = now.astimezone(ICT).date()
    days = [today + timedelta(days=n) for n in range(1, 15)]
    models: dict[str, list[PointEnsemble]] = {p.id: [] for p in points}
    for model in MODELS:
        for start in range(0, len(points), BATCH):
            chunk = points[start:start + BATCH]
            if spend:
                spend(len(chunk) * CALLS_PER_POINT_MODEL)
            try:
                data = read_json(opener, request_url(chunk, model))
                data = [data] if isinstance(data, dict) else data
                if not isinstance(data, list) or len(data) != len(chunk):
                    raise OpenDataError("ensemble location count does not match")
                for point, answer in zip(chunk, data, strict=True):
                    try:
                        models[point.id].append(parse(answer, model, days, now))
                    except (OpenDataError, KeyError, TypeError, ValueError):
                        continue  # one failed location never becomes a zero-rain location
            except (OpenDataError, KeyError, TypeError, ValueError):
                pass  # missing is recorded per point/model; never substitute another model's members
            if pause:
                time.sleep(pause)
    if not any(models.values()):
        raise OpenDataError("all pilot ensemble requests failed")
    return RainOutlook(fetched_at=now, days=days, points=[
        OutlookPoint(point=p, models=models[p.id],
                     missing_models=[m for m in MODELS if m not in {s.model for s in models[p.id]}]) for p in points
    ], notes_th=[
        "ทดลอง: สัดส่วนสถานการณ์จากแบบจำลอง ไม่ใช่โอกาสน้ำท่วมหรือความแม่นที่สอบเทียบแล้ว",
        "ค่าของช่องแบบจำลองราว 25–50 กม. ณ จุดตัวอย่าง ไม่ใช่ค่าเฉลี่ยฝนทั้งลุ่มน้ำหรือฝนตรงบ้าน",
        "วัน 8–14 เป็นแนวโน้ม วันที่และพื้นที่ฝนหนักอาจเปลี่ยนได้",
        "ยังไม่มีตลิ่ง หน้าตัด และการเดินประตู/กำลังสูบครบ จึงไม่คำนวณระดับวิกฤตหรือขอบเขตท่วม",
    ])
