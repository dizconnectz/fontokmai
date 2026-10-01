"""Build ref_data/boundaries.json: province and district outlines, simplified for drawing on the map.

The source is the Thailand ADM2 of geoBoundaries (gbOpen, release below), which is the COD-AB of OCHA from the Royal
Thai Survey Department (กรมแผนที่ทหาร) under CC BY 3.0 IGO. Run by hand for a new release:
    uv run --with shapely python -m fontokmai.ref_data.build_boundaries [geoBoundaries-THA-ADM2_simplified.geojson]
Without a file, the simplified ADM2 file (about 8.5 MB) is downloaded into a temporary folder that is deleted when
the script ends, and its sha256 checked. geoBoundaries has no DOPA codes: an outline takes the code of the district
most of whose subdistrict points (ref_data/places.json) fall inside it, and a province is the union of its
districts. shapely (BSD) runs at build time only; the package does not depend on it.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from importlib import resources
from pathlib import Path

from fontokmai.contracts.boundaries import AreaOutline, Boundaries
from fontokmai.contracts.common import GeoMultiPolygon
from fontokmai.contracts.places import PlaceGazetteer

RELEASE = "9469f09"
DOWNLOAD_URL = (f"https://github.com/wmgeolab/geoBoundaries/raw/{RELEASE}/releaseData/gbOpen/THA/ADM2/"
                "geoBoundaries-THA-ADM2_simplified.geojson")
SHA256 = "faae0d9d6fe56b489a9cb3bd5b8fe100025aad99ec554bf7a9f49cbe2216bf10"
USER_AGENT = "fontokmai-build/1.0 (+https://dizconnectz.github.io/fontokmai/)"
SOURCE_URL = "https://data.humdata.org/dataset/cod-ab-tha"
SOURCE_DATE = date(2023, 1, 19)  # sourceDataUpdateDate of the geoBoundaries metadata
CREDIT_TH = "กรมแผนที่ทหาร / OCHA (COD-AB ผ่าน geoBoundaries, CC BY 3.0 IGO)"
LICENSE = "CC BY 3.0 IGO"
# A line on the map, not a survey: a large district or a province within about 440 m, a small one (the เขต of inner
# Bangkok are 1.4 km² and more) within 4% of its width so that it keeps its shape
TOLERANCE = 0.004  # degrees, at most
SHARE = 0.04  # of the square root of the area
FINE = 0.002  # below this tolerance the points keep 4 digits (about 11 m) instead of 3 (about 110 m)
MIN_PART = 4e-6  # square degrees (about 0.05 km²): smaller islands are left out of an outline
OUT = Path(__file__).with_name("boundaries.json")
NOTES_TH = [
    "เส้นขอบเขตปรับให้เรียบลงไม่เกินราว 440 เมตร (พื้นที่เล็กละเอียดกว่านั้น) เพื่อวาดบนแผนที่ ใช้ดูว่าพื้นที่อยู่ตรงไหน ไม่ใช่แนวเขตที่ใช้ทางกฎหมาย",
    "เกาะเล็กมาก (ไม่ถึงราว 0.05 ตร.กม.) ไม่ได้วาด",
    "รหัสพื้นที่จับคู่จากจุดที่ตั้งตำบลของกรมการปกครอง (ref/places.json)",
]


def download(folder: Path) -> Path:
    target = folder / "adm2.geojson"
    request = urllib.request.Request(DOWNLOAD_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        target.write_bytes(response.read())
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"unexpected sha256 {digest}; check the release before trusting it")
    return target


def assign_codes(shapes: list, gazetteer: PlaceGazetteer) -> list[str]:
    """The DOPA district code of each shape, one shape per district (raises when they cannot be paired)."""
    from shapely import STRtree
    from shapely.geometry import Point

    tree = STRtree(shapes)
    votes: list[Counter[str]] = [Counter() for _ in shapes]
    for place in gazetteer.places:
        if place.kind == "subdistrict":
            for index in tree.query(Point(place.location), predicate="intersects"):
                votes[int(index)][place.code[:4]] += 1
    districts = {p.code: p for p in gazetteer.places if p.kind == "district"}
    codes: list[str | None] = [None] * len(shapes)
    taken: set[str] = set()
    # the clearest pairs first, so a shape that only grazes a neighbour's points does not take its code
    ranked = sorted(((count, index, code) for index, vote in enumerate(votes) for code, count in vote.items()),
                    reverse=True)
    for _count, index, code in ranked:
        if codes[index] is None and code not in taken:
            codes[index] = code
            taken.add(code)
    for index, shape in enumerate(shapes):  # no subdistrict point inside: the district whose middle is
        if codes[index] is None:
            left = [c for c in districts if c not in taken]
            best = min(left, key=lambda c: shape.distance(Point(districts[c].location)))
            codes[index] = best
            taken.add(best)
    missing = sorted(set(districts) - taken)
    if missing:
        raise SystemExit(f"districts without an outline: {missing}")
    return [code for code in codes if code is not None]


def rings(shape) -> list[list[list[list[float]]]]:
    """MultiPolygon coordinates of a simplified shape, rounded, without slivers and tiny islands."""
    from shapely.geometry import MultiPolygon, Polygon

    tolerance = min(TOLERANCE, SHARE * shape.area ** 0.5)
    digits = 4 if tolerance < FINE else 3
    simple = shape.simplify(tolerance, preserve_topology=True)
    parts = simple.geoms if isinstance(simple, MultiPolygon) else [simple]
    out = []
    for part in sorted(parts, key=lambda p: -p.area):
        if not isinstance(part, Polygon) or (out and part.area < MIN_PART):
            continue
        polygon = []
        for ring in [part.exterior, *part.interiors]:
            points: list[list[float]] = []
            for x, y in ring.coords:
                point = [round(x, digits), round(y, digits)]
                if not points or points[-1] != point:
                    points.append(point)
            if len(points) >= 4 and points[0] == points[-1]:
                polygon.append(points)
            elif not polygon:
                break  # the outer ring collapsed: leave the part out
        if polygon:
            out.append(polygon)
    return out


def build(path: Path) -> Boundaries:
    from shapely import make_valid, unary_union
    from shapely.geometry import shape

    gazetteer = PlaceGazetteer.model_validate_json(
        resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes())
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    shapes = [make_valid(shape(feature["geometry"])) for feature in features]
    codes = assign_codes(shapes, gazetteer)
    by_province = defaultdict(list)
    for code, item in zip(codes, shapes, strict=True):
        by_province[code[:2]].append(item)
    areas = [AreaOutline(code=code, outline=GeoMultiPolygon(coordinates=rings(unary_union(items))))
             for code, items in sorted(by_province.items())]
    areas += [AreaOutline(code=code, outline=GeoMultiPolygon(coordinates=rings(item)))
              for code, item in sorted(zip(codes, shapes, strict=True), key=lambda pair: pair[0])]
    return Boundaries(geometry_version=f"geoBoundaries {RELEASE} THA ADM2 · ≤ {TOLERANCE}° or {SHARE:.0%} of the width",
                      updated=SOURCE_DATE, credit_th=CREDIT_TH, license=LICENSE, source_url=SOURCE_URL,
                      areas=areas, notes_th=NOTES_TH)


def main(argv: list[str]) -> int:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(argv[0]) if argv else download(Path(folder))
        result = build(path)
    OUT.write_text(result.model_dump_json(exclude_none=False) + "\n", encoding="utf-8", newline="\n")
    provinces = sum(1 for area in result.areas if len(area.code) == 2)
    print(f"{OUT.name}: {provinces} provinces, {len(result.areas) - provinces} districts, {OUT.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
