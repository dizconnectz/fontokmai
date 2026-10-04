"""Point the cameras of the Department of Water Resources in ref_data/cctv.json at each camera's own live view.

Run by hand when the department adds or moves cameras:
    uv run python -m fontokmai.ref_data.build_cctv_dwr

The department's public camera page (telemetry.dwr.go.th/reportCctv) lists every station with a camera through its
public API, and shows each one through its own HTTPS relay at /cctv/mjpeg/<station code> (no login). A pin used to
open the list and ask the reader to look for the camera's name (user 2026-10-04: "กดแล้วมันไปหน้ารวม แล้วไม่รู้ว่า
กล้องไหน"). This script reads the station codes, names and coordinates, then:
- a camera of the registry within MATCH_KM of a station (or NAME_KM when one name holds the other) opens that
  station's relay; a pin placed by hand takes the department's coordinates
- a station that is online and matches no camera is added as a new pin
- a camera that matches no station is dropped: the department no longer shows it (its video, where ThaiWater still
  names it, does not play; user 2026-10-04)
Only the code, the name, the place words and the point of a station are read. The list also carries the cameras'
own addresses with a password in them: they are never read into the registry, never written and never linked.
"""

from __future__ import annotations

import json
import math
import re
import time
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

API = "https://telemetry.dwr.go.th/api/public"
LIST_URL = f"{API}/reportCctv/listPaginate"
STATION_URL = API + "/station/getByCode/{code}"
STREAM_URL = "https://telemetry.dwr.go.th/cctv/mjpeg/{code}"
PAGE_URL = "https://telemetry.dwr.go.th/reportCctv"
OWNER_TH = "กรมทรัพยากรน้ำ"
USER_AGENT = "fontokmai-build/1.0 (+https://dizconnectz.github.io/fontokmai/)"
MATCH_KM = 0.5  # the same place: the registry's points came from a list of the same cameras
NAME_KM = 1.5  # a little further when the names agree as well
PAUSE_S = 0.3  # between station requests, to be gentle with the department's server
CODE = re.compile(r"^[A-Z]{2}[0-9]{6}$")  # the codes the department's relay accepts
OUT = Path(__file__).with_name("cctv.json")


def _read(request: urllib.request.Request, tries: int = 4) -> Any:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except OSError:  # the server drops a connection now and then
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def _post(url: str, body: dict) -> Any:
    return _read(urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}))


def _get(url: str) -> Any:
    return _read(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}))


def fetch_stations() -> list[dict[str, Any]]:
    """Every station of the camera list: code, name_th, place_th, online and location [lon, lat]."""
    listing = _post(LIST_URL, {"paginate": {"page": 1, "pageSize": 1000, "orders": [{"key": "STN_INDEX",
                                                                                      "desc": False}]},
                               "search": {}})["value"]
    if len(listing["results"]) != listing["totalCount"]:
        raise RuntimeError(f"the list gave {len(listing['results'])} of {listing['totalCount']} stations")
    stations = []
    for row in listing["results"]:
        code = row["entity"]["stationCode"]
        if not CODE.match(code):
            continue
        detail = _get(STATION_URL.format(code=code))["value"]["fullCon"]["entity"]
        point = detail.get("point") or {}
        stations.append({
            "code": code, "name_th": detail["stnNameTh"].strip(), "place_th": (detail.get("locationTh") or "").strip(),
            "online": bool(row["entity"].get("cctvOnline")),
            "location": [round(point["lon"], 5), round(point["lat"], 5)] if point.get("lon") else None,
        })
        time.sleep(PAUSE_S)
    return stations


def _km(a: list[float], b: list[float]) -> float:
    x = (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return 111.32 * math.hypot(x, b[1] - a[1])


def _bare(name: str) -> str:
    return re.sub(r"[\s().\-]|^(สะพาน|สถานี|แม่น้ำ\S*ที่)", "", name)


def _names_agree(a: str, b: str) -> bool:
    a, b = _bare(a), _bare(b)
    return len(min(a, b, key=len)) >= 3 and (a in b or b in a)


def _is_dwr(camera: dict[str, Any]) -> bool:
    return camera["owner_th"] == OWNER_TH and camera["page_url"].startswith("https://telemetry.dwr.go.th/")


def merge(registry: dict[str, Any], stations: list[dict[str, Any]], today: date) -> dict[str, Any]:
    """The registry with the department's cameras linked to their stations and the new stations added."""
    cameras = [dict(camera) for camera in registry["cameras"]]
    located = [s for s in stations if s["location"]]
    # each station goes to the nearest camera that qualifies, so two pins never share one stream
    pairs = sorted((_km(camera["location"], station["location"]), i, station["code"])
                   for i, camera in enumerate(cameras) if _is_dwr(camera) and camera["location"]
                   for station in located)
    by_code = {s["code"]: s for s in located}
    taken_camera: dict[int, str] = {}
    taken_station: set[str] = set()
    for km, i, code in pairs:
        if i in taken_camera or code in taken_station:
            continue
        if km <= MATCH_KM or (km <= NAME_KM and _names_agree(cameras[i]["name_th"], by_code[code]["name_th"])):
            taken_camera[i] = code
            taken_station.add(code)
    for i, code in taken_camera.items():
        station, camera = by_code[code], cameras[i]
        camera["page_url"] = STREAM_URL.format(code=code)
        camera["note_th"] = f"สถานี {code} {station['place_th']}".strip()
        if camera["position"] == "approximate":
            camera["location"], camera["position"] = station["location"], "source"
    # a camera the department no longer lists has nothing to open: ThaiWater still names some (สามเสน) but their
    # video does not play (user 2026-10-04), so the pin is dropped; a camera that comes back is added as a station
    cameras = [camera for i, camera in enumerate(cameras)
               if not (_is_dwr(camera) and i not in taken_camera and camera["page_url"] == PAGE_URL)]
    ids = {camera["id"] for camera in cameras}
    for station in located:
        new_id = f"dwr-{station['code'].lower()}"
        if station["code"] in taken_station or not station["online"] or new_id in ids:
            continue
        cameras.append({
            "id": new_id, "name_th": station["name_th"], "owner_th": OWNER_TH,
            "kind": "canal" if station["name_th"].startswith("คลอง") else "river",
            "location": station["location"], "position": "source", "page_url": STREAM_URL.format(code=station["code"]),
            "note_th": f"สถานี {station['code']} {station['place_th']}".strip(),
        })
    cameras.sort(key=lambda camera: camera["id"])
    return {**registry, "updated": today.isoformat(), "cameras": cameras}


def main() -> None:
    registry = json.loads(OUT.read_text(encoding="utf-8"))
    merged = merge(registry, fetch_stations(), date.today())
    linked = sum(1 for c in merged["cameras"] if c["page_url"].startswith(STREAM_URL.format(code="")))
    OUT.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(merged['cameras'])} cameras, {linked} open their own live view")


if __name__ == "__main__":
    main()
