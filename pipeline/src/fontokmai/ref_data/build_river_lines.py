"""Build ref_data/river_lines.json and ref_data/river_reaches.json: the main rivers of Thailand as lines, cut into
stretches each nearest to one GloFAS point, so the map can colour a stretch by the model's 7-day trend (user
2026-10-02: rivers orange or red where the water is forecast to rise).

Lines: OpenStreetMap ways tagged waterway=river of the rivers below, through the Overpass API (© OpenStreetMap
contributors; the two files are a derived database under ODbL 1.0, credited on /sources and in NOTICE), kept where
they run in or along Thailand. Points: the stations of river_points.json, and a reach point about every 50 km
between them, each moved to the GloFAS cell (0.05°) of the main stream: of the 3 x 3 cells around it, the one with
the most water over the last two weeks (Open-Meteo Flood API, CC BY 4.0); a place where even that cell carries
little water is left without a point. Run by hand, for a new river or a new OpenStreetMap extract:
    uv run --with shapely python -m fontokmai.ref_data.build_river_lines [overpass.json]
Without a file the ways are asked of Overpass. shapely (BSD) runs at build time only.
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from importlib import resources
from pathlib import Path

from fontokmai.contracts.boundaries import Boundaries
from fontokmai.contracts.common import GeoMultiLineString
from fontokmai.contracts.river_lines import RiverLines, RiverStretch
from fontokmai.overview_build import Gazetteer

USER_AGENT = "fontokmai-build/1.0 (+https://dizconnectz.github.io/fontokmai/)"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"
# river (OpenStreetMap name) → short id of its reach points
RIVERS = {
    "แม่น้ำเจ้าพระยา": "cp", "แม่น้ำปิง": "ping", "แม่น้ำวัง": "wang", "แม่น้ำยม": "yom", "แม่น้ำน่าน": "nan",
    "แม่น้ำป่าสัก": "pasak", "แม่น้ำท่าจีน": "thachin", "แม่น้ำแม่กลอง": "maeklong", "แม่น้ำบางปะกง": "bangpakong",
    "แม่น้ำปราจีนบุรี": "prachinburi", "แม่น้ำนครนายก": "nakhonnayok", "แม่น้ำมูล": "mun", "แม่น้ำชี": "chi",
    "แม่น้ำโขง": "mekong",
}
BBOX = (5.5, 97.3, 20.6, 105.7)  # south, west, north, east
STEP_KM = 50.0  # a reach point about this far along the river from the last one
NEAR_KM = 25.0  # never this close to another point of the same river
CELL = 0.05  # the GloFAS grid of the Open-Meteo Flood API
MIN_FLOW = 5.0  # m³/s over two weeks: less is not the main stream (or not a river GloFAS sees)
ALONG_KM = 8.0  # Thailand's outline widened this much keeps a river along the border (the Mekong)
TOLERANCE = 0.0008  # degrees (about 90 m): close to the basemap's own river line
DIGITS = 4
BATCH = 90  # locations a request
LINES_OUT = Path(__file__).with_name("river_lines.json")
REACHES_OUT = Path(__file__).with_name("river_reaches.json")
NOTES_TH = [
    "เส้นแม่น้ำจาก OpenStreetMap ปรับให้เรียบลงเพื่อวาดบนแผนที่ แต่ละช่วงใช้แนวโน้มของจุดคำนวณ GloFAS ที่ใกล้ที่สุดบนแม่น้ำสายนั้น",
    "สีของช่วงแม่น้ำเป็นค่าจากแบบจำลอง ไม่ใช่ระดับน้ำที่วัดได้ และไม่ใช่พื้นที่น้ำท่วม",
]


def km(a: list[float], b: list[float]) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(lat), (a[1] - b[1]) * 110.57)


def overpass() -> dict:
    names = "|".join(name.removeprefix("แม่น้ำ") for name in RIVERS)
    box = ",".join(str(v) for v in BBOX)
    query = (f'[out:json][timeout:300];(way["waterway"="river"]["name"~"^แม่น้ำ({names})$"]({box});'
             f'way["waterway"="river"]["name:th"~"^แม่น้ำ({names})$"]({box}););out geom;')
    request = urllib.request.Request(OVERPASS_URL, data=urllib.parse.urlencode({"data": query}).encode(),
                                     headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=400) as response:
        return json.loads(response.read())


def river_shapes(osm: dict) -> dict:
    """river name → its lines where they run in or along Thailand, merged and simplified."""
    from shapely import unary_union
    from shapely.geometry import LineString, MultiLineString, shape
    from shapely.ops import linemerge

    boundaries = Boundaries.model_validate_json(
        resources.files("fontokmai.ref_data").joinpath("boundaries.json").read_bytes())
    thailand = unary_union([shape(area.outline.model_dump()) for area in boundaries.areas if len(area.code) == 2])
    along = thailand.buffer(ALONG_KM / 111.0)
    ways: dict[str, list] = {name: [] for name in RIVERS}
    for element in osm["elements"]:
        tags = element.get("tags", {})
        name = next((n for n in (tags.get("name:th"), tags.get("name")) if n in RIVERS), None)
        points = [(node["lon"], node["lat"]) for node in element.get("geometry", [])]
        if name and len(points) >= 2:
            ways[name].append(LineString(points))
    shapes = {}
    for name, lines in ways.items():
        merged = linemerge(MultiLineString(lines)).intersection(along)
        simple = merged.simplify(TOLERANCE, preserve_topology=False)
        parts = [part for part in getattr(simple, "geoms", [simple]) if isinstance(part, LineString)
                 and part.length > 0]
        shapes[name] = [[[round(x, DIGITS), round(y, DIGITS)] for x, y in part.coords] for part in parts]
    return shapes


def candidates(lines: list[list[list[float]]], taken: list[list[float]]) -> list[list[float]]:
    """A place about every STEP_KM along the lines, none within NEAR_KM of a point already there."""
    found: list[list[float]] = []
    for line in lines:
        walked = STEP_KM / 2
        for a, b in zip(line, line[1:], strict=False):
            step = km(a, b)
            while step > 0 and walked <= step:
                share = walked / step
                spot = [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share]
                if all(km(spot, other) >= NEAR_KM for other in taken + found):
                    found.append(spot)
                walked += STEP_KM
            walked -= step
    return found


def main_stream(spots: list[list[float]]) -> list[tuple[list[float], float] | None]:
    """For each place, the GloFAS cell of the 3 x 3 around it with the most water over two weeks, and that mean."""
    asks = [[spot[0] + dx * CELL, spot[1] + dy * CELL] for spot in spots for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    answers: list[dict] = []
    for start in range(0, len(asks), BATCH):
        batch = asks[start:start + BATCH]
        url = FLOOD_URL + "?" + urllib.parse.urlencode({
            "latitude": ",".join(f"{p[1]:.4f}" for p in batch), "longitude": ",".join(f"{p[0]:.4f}" for p in batch),
            "daily": "river_discharge", "past_days": 13, "forecast_days": 1})
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = json.loads(response.read())
        answers.extend(data if isinstance(data, list) else [data])
        time.sleep(2)
    chosen: list[tuple[list[float], float] | None] = []
    for index in range(len(spots)):
        best = None
        for answer in answers[index * 9:(index + 1) * 9]:
            flows = [v for v in answer["daily"]["river_discharge"] if isinstance(v, int | float)]
            mean = sum(flows) / len(flows) if flows else 0.0
            cell = [round(answer["longitude"], 3), round(answer["latitude"], 3)]
            if best is None or mean > best[1]:
                best = (cell, mean)
        chosen.append(best if best and best[1] >= MIN_FLOW else None)
    return chosen


def stretches(lines: list[list[list[float]]], points: list[dict]) -> dict[str, list[list[list[float]]]]:
    """The lines cut where the nearest point changes: point id → its stretches (a cut vertex goes with both)."""
    cut: dict[str, list[list[list[float]]]] = {}
    for line in lines:
        nearest = [min(points, key=lambda p: km(vertex, p["location"]))["id"] for vertex in line]
        start = 0
        for i in range(1, len(line) + 1):
            if i == len(line) or nearest[i] != nearest[start]:
                piece = line[start:i + 1] if i < len(line) else line[start:i]
                if len(piece) >= 2:
                    cut.setdefault(nearest[start], []).append(piece)
                start = i
    return cut


def build(osm: dict) -> tuple[RiverLines, list[dict]]:
    stations = json.loads(resources.files("fontokmai.ref_data").joinpath("river_points.json").read_bytes())["points"]
    shapes = river_shapes(osm)
    g = Gazetteer.load()
    reaches: list[dict] = []
    for name, lines in shapes.items():
        taken = [p["location"] for p in stations if p["river_th"] == name]
        spots = candidates(lines, taken)
        cells = main_stream(spots) if spots else []
        n = 0
        for cell in cells:
            if cell is None or any(km(cell[0], other["location"]) < NEAR_KM / 2
                                   for other in reaches if other["river_th"] == name):
                continue
            sub = g.nearest(cell[0])
            district = g.places.get(sub.code[:4]) if sub else None
            n += 1
            reaches.append({"id": f"{RIVERS[name]}-r{n:02d}",
                            "name_th": f"{name.removeprefix('แม่น้ำ')} ช่วง {district.label}" if district
                            else f"{name.removeprefix('แม่น้ำ')} ช่วงชายแดน",
                            "river_th": name, "location": cell[0], "kind": "reach"})
    pieces: list[RiverStretch] = []
    for name, lines in shapes.items():
        points = [p for p in stations + reaches if p["river_th"] == name]
        if not points:
            continue
        for point_id, parts in sorted(stretches(lines, points).items()):
            pieces.append(RiverStretch(point_id=point_id, river_th=name,
                                       line=GeoMultiLineString(coordinates=parts)))
    lines = RiverLines(geometry_version=f"OpenStreetMap {date.today().isoformat()} · {TOLERANCE}°",
                       updated=date.today(), credit_th="© ผู้ร่วมสร้าง OpenStreetMap (ODbL)", license="ODbL 1.0",
                       source_url="https://www.openstreetmap.org/copyright", stretches=pieces, notes_th=NOTES_TH)
    return lines, reaches


def main(argv: list[str]) -> int:
    osm = json.loads(Path(argv[0]).read_text(encoding="utf-8")) if argv else overpass()
    lines, reaches = build(osm)
    LINES_OUT.write_text(lines.model_dump_json() + "\n", encoding="utf-8", newline="\n")
    REACHES_OUT.write_text(json.dumps({
        "source": ("ทุกราว 50 กม. ตามเส้นแม่น้ำ OpenStreetMap ระหว่างจุดใน river_points.json ย้ายไปช่องตาข่าย GloFAS (0.05°)"
                   " ที่น้ำไหลมากที่สุดใน 3 × 3 ช่องรอบจุด (Open-Meteo Flood API ย้อน 2 สัปดาห์) สร้าง "
                   f"{date.today().isoformat()} ด้วย build_river_lines.py"),
        "points": reaches}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"{LINES_OUT.name}: {len(lines.stretches)} stretches, {LINES_OUT.stat().st_size} bytes; "
          f"{REACHES_OUT.name}: {len(reaches)} reach points")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
