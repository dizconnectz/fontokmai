"""Write JSON Schemas of the public contract (Pydantic → JSON Schema → TypeScript)."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.manifest import Manifest

SCHEMAS: dict[str, type[BaseModel]] = {
    "alerts.schema.json": AlertsFeed,
    "manifest.schema.json": Manifest,
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
