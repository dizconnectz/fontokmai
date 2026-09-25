import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.common import GeoMultiPolygon
from fontokmai.contracts.export import export_schemas

NOW = datetime(2026, 9, 25, 11, 20, tzinfo=UTC)


def _feed(**extra):
    return AlertsFeed(generation_id="20260925T112000Z-local", recovery_epoch=1, feed_generated_at=NOW,
                      feed_sequence=1, history_since=NOW, alerts=[], tombstones=[], source_status=[], **extra)


def test_export_schemas_writes_one_file_per_contract(tmp_path):
    written = export_schemas(tmp_path)
    assert sorted(p.name for p in written) == ["alerts.schema.json", "cctv.schema.json", "manifest.schema.json",
                                               "radar.schema.json", "road_flood_history.schema.json"]
    schema = json.loads((tmp_path / "alerts.schema.json").read_text(encoding="utf-8"))
    assert schema["title"] == "AlertsFeed"
    assert "Alert" in schema["$defs"]
    assert schema["additionalProperties"] is False


def test_export_is_deterministic(tmp_path):
    export_schemas(tmp_path / "a")
    export_schemas(tmp_path / "b")
    for name in ("alerts.schema.json", "cctv.schema.json", "manifest.schema.json", "radar.schema.json",
                 "road_flood_history.schema.json"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


def test_feed_round_trips_and_rejects_unknown_fields():
    feed = _feed()
    assert AlertsFeed.model_validate_json(feed.model_dump_json()) == feed
    with pytest.raises(ValidationError):
        _feed(surprise=True)


def test_positions_must_be_lon_lat_pairs():
    ring = [[100.5, 13.7], [100.6, 13.7], [100.6, 13.8], [100.5, 13.7]]
    GeoMultiPolygon(coordinates=[[ring]])
    with pytest.raises(ValidationError):
        GeoMultiPolygon(coordinates=[[[[100.5, 13.7, 0.0]] * 4]])
