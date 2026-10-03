"""Which district a point is in, by the district outlines of ref/boundaries.json (Codex M44).

The nearest subdistrict point of the DOPA list is not the district a point is in: a point well inside Khlong Luang
can be nearer a point of Thanyaburi, kilometres away. The outlines say it, within their simplification (contract
section 22: at most 0.004° and 4% of the square root of the area, then rounded to 3 or 4 digits, so a few hundred
metres at most). The policy, for every kind of point alike (flood reports, gauges, radar samples, rivers, dams):
- a point inside one outline is in that district, also near its line: the error is bounded by the simplification
  (leaving such points out would drop about a quarter of Bangkok's, whose districts are small)
- a point inside two outlines (they can overlap where both were simplified) is unsure: left out
- a point in a hole is outside that district (an enclave is its own district's outline)
- a point outside every outline is in a district only when one district alone is within its simplification of it
  (a simplified coast or edge); otherwise, at sea or abroad, it is in none, never forced into a neighbour
A grid of 0.1° narrows the outlines tested to the few around the point, so a round with many radar samples tests a
handful of polygons for each.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

CELL = 0.1  # degrees of the grid that narrows the outlines to test
# the simplification of ref_data/build_boundaries.py: TOLERANCE, SHARE and the rounding of the points that follows
TOLERANCE, SHARE, FINE = 0.004, 0.04, 0.002
SLACK = TOLERANCE + 0.0005  # the most of any district

Ring = tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class Area:
    code: str
    box: tuple[float, float, float, float]  # west, south, east, north
    rings: tuple[Ring, ...]  # every ring of every polygon, outer rings and holes alike
    slack: float  # how far its outline may be from the true line (degrees)


def _inside(rings: tuple[Ring, ...], x: float, y: float) -> bool:
    """Even-odd ray casting over every ring, so a hole (an enclave) is outside."""
    inside = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


def _distance(rings: tuple[Ring, ...], x: float, y: float, kx: float) -> float:
    """The nearest edge, in degrees of latitude (longitude scaled by kx, the cosine of the latitude)."""
    best = math.inf
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
            ax, ay, bx, by = (x1 - x) * kx, y1 - y, (x2 - x) * kx, y2 - y
            dx, dy = bx - ax, by - ay
            length = dx * dx + dy * dy
            t = 0.0 if length == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length))
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


class DistrictIndex:
    def __init__(self, areas: list[Area]):
        self.cells: dict[tuple[int, int], list[Area]] = defaultdict(list)
        for area in areas:
            west, south, east, north = area.box
            for cx in range(math.floor((west - SLACK) / CELL), math.floor((east + SLACK) / CELL) + 1):
                for cy in range(math.floor((south - SLACK) / CELL), math.floor((north + SLACK) / CELL) + 1):
                    self.cells[(cx, cy)].append(area)

    def district(self, lon: float, lat: float) -> str | None:
        """The DOPA code of the district the point is in by the policy above, or None."""
        around = [area for area in self.cells.get((math.floor(lon / CELL), math.floor(lat / CELL)), ())
                  if area.box[0] - SLACK <= lon <= area.box[2] + SLACK
                  and area.box[1] - SLACK <= lat <= area.box[3] + SLACK]
        inside = [area for area in around if _inside(area.rings, lon, lat)]
        if inside:
            return inside[0].code if len(inside) == 1 else None
        kx = math.cos(math.radians(lat))
        near = [area for area in around if _distance(area.rings, lon, lat, kx) < area.slack]
        return near[0].code if len(near) == 1 else None


def _ring_area(ring: list[list[float]]) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False))) / 2


def district_index() -> DistrictIndex:
    """The districts (4-digit DOPA codes) of the shipped ref/boundaries.json, loaded once per process."""
    return _district_index()


@lru_cache(maxsize=1)
def _district_index() -> DistrictIndex:
    data = json.loads(resources.files("fontokmai.ref_data").joinpath("boundaries.json").read_text(encoding="utf-8"))
    areas = []
    for item in data["areas"]:
        if len(item["code"]) != 4:
            continue
        polygons = item["outline"]["coordinates"]
        rings = tuple(tuple((x, y) for x, y in ring) for polygon in polygons for ring in polygon)
        xs = [x for ring in rings for x, _ in ring]
        ys = [y for ring in rings for _, y in ring]
        size = sum(_ring_area(polygon[0]) - sum(_ring_area(hole) for hole in polygon[1:]) for polygon in polygons)
        tolerance = min(TOLERANCE, SHARE * size**0.5)
        slack = tolerance + (0.0005 if tolerance >= FINE else 0.00005)
        areas.append(Area(item["code"], (min(xs), min(ys), max(xs), max(ys)), rings, slack))
    return DistrictIndex(areas)
