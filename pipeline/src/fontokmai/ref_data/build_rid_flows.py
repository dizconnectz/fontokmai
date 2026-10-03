"""Build ref_data/rid_flows.json and ref_data/canals.json: what each figure of RID's daily report and chart is, where
its place is on the map, and the canals of the Rangsit pilot as lines (D35, user 2026-10-03).

- Figures (`FIGURES`): the stations, barrages and gates the report names (rid_report.PATTERNS) and the stations whose
  state is only a coloured dot on the chart (rid_chart). Capacities are the ones the chart prints (the channel
  capacity in brackets, Qmax of a gate); the dots' places are relative to the chart's frame, measured on the chart of
  2026-10-02 and checked on the charts of 2025-10-01 to 2026-10-03 (both canvas sizes).
- Places (`SITES`): a station is put on the Chao Phraya (ref_data/river_lines.json) where it passes nearest to its
  district's centre, so it is near, not at, the gauge; the barrages are OpenStreetMap's (as apps/web/src/barrages.ts);
  a gate that takes water into a canal is put at the canal's head on OpenStreetMap.
- Canals (`CANALS`): OpenStreetMap ways tagged waterway=canal of these names, through the Overpass API, merged and
  simplified (© OpenStreetMap contributors; a derived database under ODbL 1.0, credited on /sources and in NOTICE),
  with the districts each one crosses (ref_data/boundaries.json).

Run by hand when a figure, a place or a canal changes:
    uv run --with shapely python -m fontokmai.ref_data.build_rid_flows [overpass.json]
Without a file the canals are asked of Overpass. shapely (BSD) runs at build time only.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import date
from importlib import resources
from pathlib import Path

USER_AGENT = "fontokmai-build/1.0 (+https://dizconnectz.github.io/fontokmai/)"
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter",
                 "https://z.overpass-api.de/api/interpreter"]
BBOX = (13.75, 100.40, 14.65, 101.10)  # south, west, north, east: the Rangsit field and the canals into Bangkok
TOLERANCE = 0.0005  # degrees (about 55 m)
DISTRICT_REACH = 0.003  # degrees (about 330 m) either side of a canal: the districts along it
DIGITS = 4
FLOWS_OUT = Path(__file__).with_name("rid_flows.json")
CANALS_OUT = Path(__file__).with_name("canals.json")
RAMA6 = [100.7614, 14.55862]  # OpenStreetMap way 121342565 (waterway=dam)
CHAO_PHRAYA_DAM = [100.17999, 15.15935]  # OpenStreetMap way 80938821 (waterway=weir)

# id: name, kind, code, capacity (m³/s), what the capacity is, where the water goes, the dot on the chart (frame
# relative) when the station has one
FIGURES: dict[str, dict] = {
    "c2": {"name_th": "แม่น้ำเจ้าพระยา ที่นครสวรรค์", "kind": "station", "code": "C.2", "capacity_cms": 3735,
           "dot": [0.4901, 0.101]},
    "c13": {"name_th": "ท้ายเขื่อนเจ้าพระยา", "kind": "station", "code": "C.13", "capacity_cms": 2720,
            "capacity_kind": "release", "dot": [0.5193, 0.4094]},
    "c3": {"name_th": "แม่น้ำเจ้าพระยา ที่สิงห์บุรี", "kind": "station", "code": "C.3", "capacity_cms": 2997,
           "dot": [0.4865, 0.4704]},
    "c7a": {"name_th": "แม่น้ำเจ้าพระยา ที่อ่างทอง", "kind": "station", "code": "C.7A", "capacity_cms": 2880,
            "dot": [0.4889, 0.5854]},
    "c35": {"name_th": "แม่น้ำเจ้าพระยา ที่อยุธยา", "kind": "station", "code": "C.35", "capacity_cms": 1159,
            "dot": [0.4901, 0.7056]},
    "c29b": {"name_th": "แม่น้ำเจ้าพระยา ที่ อ.สามโคก", "kind": "station", "code": "C.29B", "capacity_cms": 3600,
             "dot": [0.4889, 0.7918]},
    "s26": {"name_th": "แม่น้ำป่าสัก ท้ายเขื่อนพระรามหก", "kind": "station", "code": "S.26", "capacity_cms": 641,
            "dot": [0.724, 0.7282]},
    "rama6": {"name_th": "น้ำผ่านเขื่อนพระรามหก", "kind": "barrage"},
    "phranarai": {"name_th": "ปตร.พระนารายณ์", "kind": "gate", "capacity_cms": 210, "capacity_kind": "release",
                  "into_th": "คลองระพีพัฒน์ → ทุ่งรังสิต"},
    "phrasrisin": {"name_th": "ปตร.พระศรีศิลป์", "kind": "gate", "into_th": "คลองระพีพัฒน์แยกตก"},
    "phrasrisaowaphak": {"name_th": "ปตร.พระศรีเสาวภาค", "kind": "gate", "into_th": "คลองระพีพัฒน์แยกใต้"},
    "east_intake": {"name_th": "รับน้ำเข้าทุ่งฝั่งตะวันออก (รวม)", "kind": "intake"},
    "manorom": {"name_th": "ปตร.มโนรมย์", "kind": "gate", "capacity_cms": 210, "capacity_kind": "release",
                "into_th": "คลองชัยนาท-ป่าสัก"},
    "maharaj": {"name_th": "ปตร.มหาราช", "kind": "gate", "capacity_cms": 65, "capacity_kind": "release",
                "into_th": "คลองชัยนาท-อยุธยา"},
    "west_intake": {"name_th": "รับน้ำเข้าทุ่งฝั่งตะวันตก (รวม)", "kind": "intake"},
    "makhamthao_uthong": {"name_th": "ปตร.มะขามเฒ่า-อู่ทอง", "kind": "gate", "capacity_cms": 35,
                          "capacity_kind": "release", "into_th": "คลองมะขามเฒ่า-อู่ทอง"},
    "makhamthao_krasiao": {"name_th": "ปตร.มะขามเฒ่า-กระเสียว", "kind": "gate", "capacity_cms": 12,
                           "capacity_kind": "release", "into_th": "คลองมะขามเฒ่า-กระเสียว"},
    "phonlathep": {"name_th": "ปตร.พลเทพ", "kind": "gate", "capacity_cms": 318, "capacity_kind": "release",
                   "into_th": "แม่น้ำสุพรรณ (ท่าจีน)"},
    "boromthat": {"name_th": "ปตร.บรมธาตุ", "kind": "gate", "capacity_cms": 230, "capacity_kind": "release",
                  "into_th": "แม่น้ำน้อย"},
    "small_west": {"name_th": "คลองเล็กอื่น ๆ ฝั่งตะวันตก", "kind": "intake"},
}
# a station's place: on the Chao Phraya nearest to this district's centre (DOPA code)
STATION_DISTRICTS = {"c2": "6001", "c3": "1701", "c7a": "1501", "c35": "1401", "c29b": "1307"}
# map pins: id, name, the figures they show (in this order), and how the place is found
SITES: list[dict] = [
    {"id": "nakhonsawan", "name_th": "แม่น้ำเจ้าพระยา ที่นครสวรรค์", "points": ["c2"], "at": "station:c2"},
    {"id": "chao-phraya-dam", "name_th": "เขื่อนเจ้าพระยา จ.ชัยนาท",
     "points": ["c13", "east_intake", "manorom", "maharaj", "west_intake", "makhamthao_uthong",
                "makhamthao_krasiao", "phonlathep", "boromthat", "small_west"], "at": "dam"},
    {"id": "singburi", "name_th": "แม่น้ำเจ้าพระยา ที่สิงห์บุรี", "points": ["c3"], "at": "station:c3"},
    {"id": "angthong", "name_th": "แม่น้ำเจ้าพระยา ที่อ่างทอง", "points": ["c7a"], "at": "station:c7a"},
    {"id": "ayutthaya", "name_th": "แม่น้ำเจ้าพระยา ที่อยุธยา", "points": ["c35"], "at": "station:c35"},
    {"id": "samkhok", "name_th": "แม่น้ำเจ้าพระยา ที่ อ.สามโคก จ.ปทุมธานี", "points": ["c29b"], "at": "station:c29b"},
    {"id": "rama6", "name_th": "เขื่อนพระรามหก จ.พระนครศรีอยุธยา", "points": ["rama6", "s26", "phranarai"],
     "at": "rama6"},
    # both gates stand where the Raphiphat parts into its west and south branches
    {"id": "raphiphat-split", "name_th": "จุดแยกคลองระพีพัฒน์ (แยกตก/แยกใต้)",
     "points": ["phrasrisin", "phrasrisaowaphak"], "at": "head:raphiphat-west"},
]
# the pilot canals: OpenStreetMap name, what feeds them, where they drain, the canal name in Bangkok's DXS files
CANALS: list[dict] = [
    {"id": "raphiphat", "name_th": "คลองระพีพัฒน์", "osm": ["คลองระพีพัฒน์"], "fed_by": ["phranarai"],
     "drains_to": None, "dxs": []},
    {"id": "raphiphat-west", "name_th": "คลองระพีพัฒน์แยกตก", "osm": ["คลองระพีพัฒน์แยกตก"],
     "fed_by": ["phrasrisin", "phranarai"], "drains_to": "c29b", "dxs": []},
    {"id": "raphiphat-south", "name_th": "คลองระพีพัฒน์แยกใต้", "osm": ["คลองระพีพัฒน์แยกใต้"],
     "fed_by": ["phrasrisaowaphak", "phranarai"], "drains_to": None, "dxs": []},
    {"id": "rangsit", "name_th": "คลองรังสิตประยูรศักดิ์", "osm": ["คลองรังสิตประยูรศักดิ์"],
     "fed_by": ["phrasrisin", "phrasrisaowaphak", "phranarai"], "drains_to": "c29b", "dxs": []},
    {"id": "hokwa", "name_th": "คลองหกวา", "osm": ["คลองหกวา"], "fed_by": ["phrasrisaowaphak", "phranarai"],
     "drains_to": None, "dxs": ["คลองหกวา"]},
    {"id": "premprachakon", "name_th": "คลองเปรมประชากร", "osm": ["คลองเปรมประชากร"], "fed_by": [],
     "drains_to": "c29b", "dxs": ["คลองเปรมประชากร"]},
]
NOTES_TH = [
    "ตัวเลขจากรายงานสถานการณ์น้ำประจำวันของกรมชลประทาน (SWOC) และสีสถานะจากผังน้ำเจ้าพระยาตอนล่าง เวลา 06:00 น.",
    "จุดบนแผนที่ของสถานีอยู่บนแม่น้ำใกล้ตัวอำเภอ ไม่ใช่ตำแหน่งเครื่องวัดจริง ประตูที่รับน้ำเข้าคลองอยู่ที่หัวคลองตาม OpenStreetMap",
]


def km(a: list[float], b: list[float]) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(lat), (a[1] - b[1]) * 110.57)


def overpass() -> dict:
    names = "|".join(sorted({name for canal in CANALS for name in canal["osm"]}))
    box = ",".join(str(v) for v in BBOX)
    query = f'[out:json][timeout:200];way["waterway"~"canal|river|drain"]["name"~"^({names})$"]({box});out geom;'
    last: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            request = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(),
                                             headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.loads(response.read())
        except Exception as exc:  # noqa: BLE001 - try the next server
            last = exc
    raise RuntimeError(f"no Overpass server answered: {last}")


def canal_shapes(osm: dict) -> dict[str, list[list[list[float]]]]:
    """canal id → its lines, merged and simplified."""
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge

    by_name: dict[str, list] = {}
    for element in osm.get("elements", []):
        name = element.get("tags", {}).get("name")
        points = [(node["lon"], node["lat"]) for node in element.get("geometry", [])]
        if name and len(points) >= 2:
            by_name.setdefault(name, []).append(LineString(points))
    shapes = {}
    for canal in CANALS:
        lines = [line for name in canal["osm"] for line in by_name.get(name, [])]
        if not lines:
            raise RuntimeError(f"no OpenStreetMap way for {canal['name_th']}")
        merged = linemerge(MultiLineString(lines)).simplify(TOLERANCE, preserve_topology=False)
        parts = [part for part in getattr(merged, "geoms", [merged]) if isinstance(part, LineString)
                 and part.length > 0]
        shapes[canal["id"]] = [[[round(x, DIGITS), round(y, DIGITS)] for x, y in part.coords] for part in parts]
    return shapes


def nearest_on(lines: list[list[list[float]]], spot: list[float]) -> list[float]:
    """The point of the lines nearest to `spot` (on a segment, not only at a vertex)."""
    best, best_d = spot, math.inf
    for line in lines:
        for a, b in zip(line, line[1:], strict=False):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((spot[0] - a[0]) * dx + (spot[1] - a[1]) * dy)
                                                      / (dx * dx + dy * dy)))
            p = [a[0] + t * dx, a[1] + t * dy]
            d = km(p, spot)
            if d < best_d:
                best, best_d = p, d
    return [round(best[0], DIGITS), round(best[1], DIGITS)]


def head(lines: list[list[list[float]]], towards: list[list[list[float]]] | list[float]) -> list[float]:
    """The end of a canal nearest to a point, or to another canal's lines: where its intake gate is."""
    ends = [line[0] for line in lines] + [line[-1] for line in lines]
    if towards and isinstance(towards[0], float | int):
        return min(ends, key=lambda end: km(end, towards))
    return min(ends, key=lambda end: km(end, nearest_on(towards, end)))


def canal_districts(lines: list[list[list[float]]]) -> list[str]:
    """The DOPA districts a canal crosses."""
    from shapely.geometry import LineString, shape

    from fontokmai.contracts.boundaries import Boundaries

    boundaries = Boundaries.model_validate_json(
        resources.files("fontokmai.ref_data").joinpath("boundaries.json").read_bytes())
    # a canal often is the border between two districts: both count, so the line is widened a little
    geometry = [LineString(line).buffer(DISTRICT_REACH) for line in lines]
    found = []
    for area in boundaries.areas:
        if len(area.code) == 4:
            outline = shape(area.outline.model_dump())
            if any(outline.intersects(line) for line in geometry):
                found.append(area.code)
    return sorted(found)


def main(argv: list[str]) -> int:
    osm = json.loads(Path(argv[0]).read_text(encoding="utf-8")) if argv else overpass()
    shapes = canal_shapes(osm)
    rivers = json.loads(resources.files("fontokmai.ref_data").joinpath("river_lines.json").read_text(
        encoding="utf-8"))
    chao_phraya = [line for stretch in rivers["stretches"] if stretch["river_th"] == "แม่น้ำเจ้าพระยา"
                   for line in stretch["line"]["coordinates"]]
    places = json.loads(resources.files("fontokmai.ref_data").joinpath("places.json").read_text(encoding="utf-8"))
    centres = {place["code"]: place["location"] for place in places["places"] if place.get("kind") == "district"}
    heads = {"raphiphat-west": head(shapes["raphiphat-west"], shapes["raphiphat"])}
    sites = []
    for site in SITES:
        kind, _, key = site["at"].partition(":")
        if kind == "station":
            location = nearest_on(chao_phraya, centres[STATION_DISTRICTS[key]])
            note = "บนแม่น้ำใกล้ตัวอำเภอ ไม่ใช่ตำแหน่งเครื่องวัดจริง"
        elif kind == "dam":
            location, note = CHAO_PHRAYA_DAM, "ตัวเขื่อนตาม OpenStreetMap ประตูรับน้ำอยู่รอบเขื่อน"
        elif kind == "rama6":
            location, note = RAMA6, "ตัวเขื่อนตาม OpenStreetMap ปตร.พระนารายณ์อยู่ที่หัวคลองระพีพัฒน์ข้างเขื่อน"
        else:
            location, note = heads[key], "จุดแยกคลองตาม OpenStreetMap"
        sites.append({"id": site["id"], "name_th": site["name_th"], "location": location, "location_note_th": note,
                      "points": site["points"]})
    flows = {
        "version": date.today().isoformat(),
        "credit_th": "กรมชลประทาน (รายงานสถานการณ์น้ำประจำวัน SWOC และผังน้ำเจ้าพระยาตอนล่าง)",
        "location_credit_th": "© OpenStreetMap contributors (ODbL 1.0)",
        "figures": [{"id": point_id, **figure} for point_id, figure in FIGURES.items()],
        "sites": sites,
        "notes_th": NOTES_TH,
    }
    canals = {
        "schema_version": "1",
        "updated": date.today().isoformat(),
        "credit_th": "© OpenStreetMap contributors",
        "license": "ODbL-1.0",
        "source_url": "https://www.openstreetmap.org/copyright",
        "canals": [{"id": canal["id"], "name_th": canal["name_th"],
                    "line": {"type": "MultiLineString", "coordinates": shapes[canal["id"]]},
                    "districts": canal_districts(shapes[canal["id"]]), "fed_by": canal["fed_by"],
                    "drains_to": canal["drains_to"], "dxs_canals": canal["dxs"]} for canal in CANALS],
        "notes_th": ["เส้นคลองจาก OpenStreetMap ปรับให้เรียบลงเพื่อวาดบนแผนที่ ไม่ใช่แนวเขตหรือขอบตลิ่ง"],
    }
    FLOWS_OUT.write_text(json.dumps(flows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    CANALS_OUT.write_text(json.dumps(canals, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8",
                          newline="\n")
    print(json.dumps({"sites": {s["id"]: s["location"] for s in sites},
                      "canals": {c["id"]: [len(c["line"]["coordinates"]), c["districts"]] for c in canals["canals"]},
                      "canals_bytes": CANALS_OUT.stat().st_size}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
