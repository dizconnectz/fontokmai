"""Write JSON Schemas of the public contract (Pydantic → JSON Schema → TypeScript)."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.cctv import CctvRegistry
from fontokmai.contracts.forecast import RainForecast
from fontokmai.contracts.live_floods import LiveFloods
from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.contracts.radar import RadarFeed
from fontokmai.contracts.road_flood import RoadFloodHistory

SCHEMAS: dict[str, type[BaseModel]] = {
    "alerts.schema.json": AlertsFeed,
    "cctv.schema.json": CctvRegistry,
    "forecast.schema.json": RainForecast,
    "live_floods.schema.json": LiveFloods,
    "manifest.schema.json": Manifest,
    "places.schema.json": PlaceGazetteer,
    "radar.schema.json": RadarFeed,
    "road_flood_history.schema.json": RoadFloodHistory,
}


def export_schemas(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, model in SCHEMAS.items():
        schema = model.model_json_schema(mode="serialization")
        path = out_dir / name
        text = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)
    return written
