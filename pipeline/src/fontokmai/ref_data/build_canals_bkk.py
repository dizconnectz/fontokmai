"""Add Bangkok's canals to ref_data/canals.json: the canals that carry two or more of BMA's gauges (bkk/water.json),
drawn from OpenStreetMap (user 2026-10-04: "ทำคลองที่ กทม ด้วย").

Run by hand when the gauges or the map change:
    uv run --with osmium --with shapely python -m fontokmai.ref_data.build_canals_bkk \
        WATER_JSON BANGKOK.osm.pbf [EXTRA.osm ...]

WATER_JSON is a published bkk/water.json; BANGKOK.osm.pbf an OpenStreetMap extract (BBBike's Bangkok extract,
ODbL) and EXTRA.osm any OSM XML for what the extract leaves out (BBBike's box ends at 100.80°E, so the eastern
districts come from the OSM API's map call). Overpass refused this computer's connections (2026-10-04).

A canal of the gauges is drawn with the waterways of the same name within NEAR_KM of one of its gauges, so a canal
elsewhere that shares the name is not drawn; a canal the map has no line for is left out. The canal scores rain over
the districts its line crosses and its gauges rising, like the Rangsit canals; its gauges' pumps are its own factor.
Canals already in the file (by their DXS name) are kept as they are.
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

OUT = Path(__file__).with_name("canals.json")
BOUNDARIES = Path(__file__).with_name("boundaries.json")
WATERWAYS = {"canal", "drain", "river", "ditch", "stream"}
MIN_GAUGES = 2
NEAR_KM = 3.0
TOLERANCE = 0.0003  # degrees (about 33 m): a line to draw, not the canal's edge
# names that are a number or "soi": many canals carry them, a line could not be told for the gauge's own
GENERIC = re.compile(r"^คลอง(ซอย|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ\S*|\d+)$")


def _km(a: list[float], b: list[float]) -> float:
    x = (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return 111.32 * math.hypot(x, b[1] - a[1])


def read_pbf(path: Path) -> dict[str, list[list[list[float]]]]:
    """Named waterways of an OSM extract: name → lines of [lon, lat]."""
    import osmium  # only for this script: `uv run --with osmium --with shapely`

    ways: dict[str, list[list[list[float]]]] = defaultdict(list)

    class Handler(osmium.SimpleHandler):
        def way(self, way: Any) -> None:
            if way.tags.get("waterway") not in WATERWAYS:
                return
            name = (way.tags.get("name:th") or way.tags.get("name") or "").strip()
            if not name:
                return
            try:
                line = [[node.lon, node.lat] for node in way.nodes]
            except osmium.InvalidLocationError:
                return
            if len(line) >= 2:
                ways[name].append(line)

    Handler().apply_file(str(path), locations=True)
    return ways


def read_xml(paths: list[Path]) -> dict[str, list[list[list[float]]]]:
    """Named waterways of OSM XML files (the OSM API's map call)."""
    ways: dict[str, list[list[list[float]]]] = defaultdict(list)
    seen: set[str] = set()
    for path in paths:
        root = ET.parse(path).getroot()
        nodes = {n.get("id"): [float(n.get("lon")), float(n.get("lat"))] for n in root.iter("node")}
        for way in root.iter("way"):
            tags = {t.get("k"): t.get("v") for t in way.iter("tag")}
            name = (tags.get("name:th") or tags.get("name") or "").strip()
            if tags.get("waterway") not in WATERWAYS or not name or way.get("id") in seen:
                continue
            line = [nodes[ref] for nd in way.iter("nd") if (ref := nd.get("ref")) in nodes]
            if len(line) >= 2:
                seen.add(way.get("id"))
                ways[name].append(line)
    return ways


def _simplify(lines: list[list[list[float]]]) -> list[list[list[float]]]:
    from shapely.geometry import MultiLineString
    from shapely.ops import linemerge

    merged = linemerge(MultiLineString(lines)).simplify(TOLERANCE)
    parts = list(getattr(merged, "geoms", [merged]))
    return [[[round(x, 5), round(y, 5)] for x, y in part.coords] for part in parts if len(part.coords) >= 2]


def _districts(lines: list[list[list[float]]], areas: list[dict[str, Any]]) -> list[str]:
    from shapely.geometry import MultiLineString, shape

    line = MultiLineString(lines)
    return sorted(area["code"] for area in areas if len(area["code"]) == 4 and shape(area["outline"]).intersects(line))


def build(stations: list[dict[str, Any]], ways: dict[str, list[list[list[float]]]], registry: dict[str, Any],
          areas: list[dict[str, Any]], today: date) -> dict[str, Any]:
    known = {name for canal in registry["canals"] for name in canal["dxs_canals"]}
    gauges: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for station in stations:
        if station.get("location") and station.get("canal_th"):
            gauges[station["canal_th"].strip()].append(station)
    canals = [canal for canal in registry["canals"] if not canal["id"].startswith("bkk-")]
    ids: set[str] = {canal["id"] for canal in canals}
    for name, on in sorted(gauges.items()):
        if len(on) < MIN_GAUGES or name in known or GENERIC.match(name):
            continue
        near = [line for line in ways.get(name, [])
                if any(_km(point, s["location"]) <= NEAR_KM for s in on for point in line[:: max(1, len(line) // 20)]
                       + [line[-1]])]
        if not near:
            continue
        lines = _simplify(near)
        prefix = Counter(s["code"].split(".")[1] for s in on if s["code"].count(".") >= 2).most_common(1)
        canal_id = f"bkk-{prefix[0][0].lower()}" if prefix else f"bkk-{len(ids)}"
        while canal_id in ids:
            canal_id += "x"
        ids.add(canal_id)
        canals.append({"id": canal_id, "name_th": name, "line": {"type": "MultiLineString", "coordinates": lines},
                       "districts": _districts(lines, areas), "fed_by": [], "drains_to": None,
                       "dxs_canals": [name]})
    notes = [note for note in registry["notes_th"] if "กรุงเทพ" not in note]
    notes.append("คลองในกรุงเทพฯ คือคลองที่มีสถานีวัดระดับน้ำของสำนักการระบายน้ำ ตั้งแต่ 2 สถานี (เส้นจาก OpenStreetMap)")
    return {**registry, "updated": today.isoformat(), "canals": canals, "notes_th": notes}


def main() -> None:
    water, pbf, *extra = (Path(arg) for arg in sys.argv[1:])
    ways = read_pbf(pbf)
    for name, lines in read_xml(extra).items():
        ways[name].extend(lines)
    registry = json.loads(OUT.read_text(encoding="utf-8"))
    areas = json.loads(BOUNDARIES.read_text(encoding="utf-8"))["areas"]
    stations = json.loads(water.read_text(encoding="utf-8"))["stations"]
    built = build(stations, ways, registry, areas, date.today())
    OUT.write_text(json.dumps(built, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    added = [c for c in built["canals"] if c["id"].startswith("bkk-")]
    print(f"{len(built['canals'])} canals ({len(added)} in Bangkok), {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
