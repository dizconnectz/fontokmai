"""Public contract examples survive the manual DXS relay without losing units or age."""

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from fontokmai.sources.bma_dxs import RELAY_MODELS, relay_files

EXAMPLES = Path(__file__).resolve().parents[2] / "contracts/v1/examples/bkk"
FILES = {
    "bkk/water.json": "water.json",
    "bkk/rain.json": "rain.json",
    "bkk/flooding.json": "flooding.json",
    "bkk/news.json": "news.json",
    "water/dams.json": "dams.json",
    "weather/today.json": "weather-today.json",
}


@pytest.mark.parametrize("path,example", FILES.items())
def test_every_manual_file_expires_after_thirty_days_independently(tmp_path, path, example):
    content = (EXAMPLES / example).read_bytes()
    fetched = datetime.fromisoformat(json.loads(content)["fetched_at"])
    target = tmp_path / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    assert relay_files(tmp_path, fetched + timedelta(days=30))[path] == content
    assert path not in relay_files(tmp_path, fetched + timedelta(days=30, microseconds=1))
    assert target.read_bytes() == content  # expiry removes the manifest entry, not the local archive


@pytest.mark.parametrize("path,example", FILES.items())
def test_public_examples_validate_and_preserve_unknown_values(path, example):
    value = json.loads((EXAMPLES / example).read_bytes())
    restored = RELAY_MODELS[path].model_validate(value).model_dump(mode="json")
    # Include nulls, zeros and source-specific units, without comparing serialization/timezone spelling.
    for key in ("stations", "gauges", "dams", "reports", "text_th", "notes_th"):
        if key in value:
            assert restored[key] == value[key]
    assert restored["credit_th"] == value["credit_th"]


def test_invalid_delivered_file_does_not_hide_other_valid_sources(tmp_path):
    for path, example in FILES.items():
        target = tmp_path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((EXAMPLES / example).read_bytes())
    (tmp_path / "bkk/rain.json").write_text("{}", encoding="utf8")
    now = datetime.fromisoformat("2026-09-27T00:00:00+07:00")
    assert set(relay_files(tmp_path, now)) == set(FILES) - {"bkk/rain.json"}
