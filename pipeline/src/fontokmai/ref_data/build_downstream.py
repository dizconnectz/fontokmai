"""Build ref_data/dam_downstream.json: the districts a river passes below each large dam (HydroRIVERS v1.0).

Run by hand, for a new dam in dam_locations.json or a new release of HydroRIVERS:
    uv run --with pyshp python -m fontokmai.ref_data.build_downstream [HydroRIVERS_v10_as_shp.zip or its .shp]
Without a file, the Asia tile (about 90 MB) is downloaded into a temporary folder that is deleted when the script
ends, and a zip given to it is unpacked into one too. Nothing of HydroRIVERS itself is kept: only the DOPA district
codes whose subdistrict point is nearest to the river line, in the order the water reaches them, and how far from
the dam. pyshp (MIT) reads the shapefile at build time only; the package does not depend on it.

HydroRIVERS is © World Wildlife Fund, Inc. (HydroSHEDS v1 licence: free for commercial and non-commercial use,
with the attribution written in docs/sources.md and on /sources). A river line is a model of where water flows at
15 arc-seconds, not a survey: a district listed is one the river runs through or beside, not a forecast of floods.
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date
from importlib import resources
from pathlib import Path

DOWNLOAD_URL = "https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip"
SOURCE_URL = "https://www.hydrosheds.org/products/hydrorivers"
SHP_NAME = "HydroRIVERS_v10_as.shp"
BBOX = (95.0, 4.0, 108.0, 22.5)  # the rivers of Thailand, and the stretches by which they leave it
START_KM = 8.0  # the dam is on its river within this distance (the OpenStreetMap point may be the reservoir's middle)
STEP_KM = 1.0  # the river line is read about every kilometre
ABROAD_KM = 25.0  # this far with no Thai subdistrict near the river: it has left Thailand
OUT = Path(__file__).with_name("dam_downstream.json")


@dataclass
class Reach:
    next_down: int
    upland_km2: float
    points: list[tuple[float, float]]  # upstream to downstream


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * math.cos(lat), a[1] - b[1]) * 111.32


def read_reaches(shp: Path) -> dict[int, Reach]:
    import shapefile  # pyshp, at build time only

    reaches: dict[int, Reach] = {}
    with shapefile.Reader(str(shp)) as reader:
        for item in reader.iterShapeRecords(bbox=BBOX):
            record = item.record
            reaches[int(record["HYRIV_ID"])] = Reach(int(record["NEXT_DOWN"]), float(record["UPLAND_SKM"]),
                                                    [(x, y) for x, y in item.shape.points])
    return reaches


def start_reach(reaches: dict[int, Reach], location: list[float]) -> tuple[int, int] | None:
    """(reach, vertex) of the largest river passing within START_KM of the dam: the dam's own river."""
    best: tuple[float, int, int] | None = None
    here = (location[0], location[1])
    reach_box = START_KM / 111.32 * 1.5
    for rid, reach in reaches.items():
        (x0, y0), (x1, y1) = reach.points[0], reach.points[-1]
        if min(x0, x1) - reach_box > here[0] or max(x0, x1) + reach_box < here[0] or \
                min(y0, y1) - reach_box > here[1] or max(y0, y1) + reach_box < here[1]:
            continue
        for index, point in enumerate(reach.points):
            if km_between(point, here) <= START_KM and (best is None or reach.upland_km2 > best[0]):
                best = (reach.upland_km2, rid, index)
                break
    return (best[1], best[2]) if best else None


def downstream_path(reaches: dict[int, Reach], start: int, vertex: int) -> tuple[list[tuple[float, float, float]], str]:
    """(lon, lat, km from the dam) along the river down to the sea or out of the box, and how it ends."""
    path: list[tuple[float, float, float]] = []
    km, last, since = 0.0, None, STEP_KM
    rid, points = start, reaches[start].points[vertex:]
    while True:
        for point in points:
            if last is not None:
                step = km_between(last, point)
                km += step
                since += step
            last = point
            if since >= STEP_KM:
                path.append((point[0], point[1], round(km, 1)))
                since = 0.0
        following = reaches[rid].next_down
        if following == 0:
            return path, "sea"
        if following not in reaches:
            return path, "abroad"
        rid, points = following, reaches[following].points


def districts_along(path: list[tuple[float, float, float]], nearest) -> tuple[list[list], str | None]:
    """[district code, km] in the order the water reaches them; "abroad" when the river leaves Thailand for good.
    `nearest` names the subdistrict of a point, or None outside Thailand (Gazetteer.nearest)."""
    seen: dict[str, float] = {}
    outside_since: float | None = None
    for lon, lat, km in path:
        place = nearest([lon, lat])
        if place is None:
            outside_since = km if outside_since is None else outside_since
            if km - outside_since >= ABROAD_KM:
                return [[code, at] for code, at in seen.items()], "abroad"
            continue
        outside_since = None
        seen.setdefault(place.code[:4], km)
    return [[code, at] for code, at in seen.items()], None


def build(shp: Path) -> dict:
    from fontokmai.overview_build import Gazetteer

    gazetteer = Gazetteer.load()
    locations = json.loads(resources.files("fontokmai.ref_data").joinpath("dam_locations.json").read_text(
        encoding="utf-8"))["dams"]
    reaches = read_reaches(shp)
    dams = {}
    for dam_id, place in sorted(locations.items()):
        start = start_reach(reaches, place["location"])
        if start is None:
            continue
        path, end = downstream_path(reaches, *start)
        districts, left = districts_along(path, gazetteer.nearest)
        dams[dam_id] = {"end": left or end, "districts": districts}
    return {
        "source_th": "เส้นทางน้ำ HydroRIVERS v1.0 (HydroSHEDS © World Wildlife Fund, Inc.)",
        "source_url": SOURCE_URL,
        "built": date.today().isoformat(),
        "notes": [
            "district = DOPA district whose subdistrict point is nearest to the river line below the dam, in order",
            "km = along the river from the dam; end = sea, or abroad when the river leaves Thailand",
            "a modelled river network (15 arc-seconds), not a survey and not a flood forecast",
        ],
        "dams": dams,
    }


def main(argv: list[str]) -> int:
    with tempfile.TemporaryDirectory(prefix="hydrorivers-") as work:
        given = Path(argv[0]) if argv else None
        if given is None or given.suffix == ".zip":
            archive = given or Path(work) / "hydrorivers.zip"
            if given is None:
                urllib.request.urlretrieve(DOWNLOAD_URL, archive)
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(work)
            shp = next(Path(work).rglob(SHP_NAME))
        else:
            shp = given
        result = build(shp)
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{OUT.name}: {len(result['dams'])} dams, {OUT.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
