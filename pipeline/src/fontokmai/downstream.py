"""Where the water of a dam goes: the provinces its river runs through, from ref_data/dam_downstream.json.

The table is built by ref_data/build_downstream.py from HydroRIVERS v1.0 (HydroSHEDS, © WWF; the attribution is in
NOTICE and on /sources). It is a modelled river network: places to follow when a dam releases water, not a forecast
of floods.
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from collections.abc import Mapping
from functools import cache
from importlib import resources

from fontokmai.contracts.places import Place, PlaceGazetteer


@cache
def downstream_table() -> dict[str, dict]:
    """Dam id → {"end": "sea" | "abroad", "districts": [[district code, km from the dam], ...]}."""
    raw = resources.files("fontokmai.ref_data").joinpath("dam_downstream.json").read_text(encoding="utf-8")
    return json.loads(raw)["dams"]


@cache
def places() -> dict[str, Place]:
    """The DOPA places of ref_data/places.json by code (provinces, districts and subdistricts)."""
    raw = resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes()
    return {place.code: place for place in PlaceGazetteer.model_validate_json(raw).places}


def downstream_th(known: Mapping[str, Place], entry: dict | None, most: int = 6) -> str | None:
    """"ท้ายน้ำ: นครนายก → ปราจีนบุรี → ฉะเชิงเทรา · ออกทะเลที่ อ.บางปะกง จ.ฉะเชิงเทรา". A river that is a border
    passes two provinces by turns, so provinces go in the order of the middle distance of their districts."""
    districts = [(code, km) for code, km in (entry or {}).get("districts", []) if code in known]
    if not districts:
        return None
    along: dict[str, list[float]] = defaultdict(list)
    for code, km in districts:
        along[code[:2]].append(km)
    order = [p for p in sorted(along, key=lambda p: statistics.median(along[p])) if p in known]
    names = ["กรุงเทพฯ" if p == "10" else known[p].name for p in order]
    text = "ท้ายน้ำ: " + " → ".join(names[:most]) + (" → …" if len(names) > most else "")
    if entry.get("end") == "sea":
        text += f" · ออกทะเลที่ {known[max(districts, key=lambda d: d[1])[0]].label}"
    elif entry.get("end") == "abroad":
        text += " · แล้วไหลออกนอกประเทศ"
    return text


def dam_downstream_th(dam_id: str) -> str | None:
    """The line for one dam, or None when the table has no river for it."""
    return downstream_th(places(), downstream_table().get(dam_id))
