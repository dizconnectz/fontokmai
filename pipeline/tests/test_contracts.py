import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.bkk import CanalLevels
from fontokmai.contracts.common import GeoMultiPolygon
from fontokmai.contracts.export import export_schemas

NOW = datetime(2026, 9, 25, 11, 20, tzinfo=UTC)


def _feed(**extra):
    return AlertsFeed(generation_id="20260925T112000Z-local", recovery_epoch=1, feed_generated_at=NOW,
                      feed_sequence=1, history_since=NOW, alerts=[], tombstones=[], source_status=[], **extra)


def test_export_schemas_writes_one_file_per_contract(tmp_path):
    written = export_schemas(tmp_path)
    assert sorted(p.name for p in written) == [
        "alerts.schema.json", "bkk_flooding.schema.json", "bkk_news.schema.json", "bkk_rain.schema.json",
        "bkk_water.schema.json", "boundaries.schema.json", "canal_outlook.schema.json", "canals.schema.json",
        "cctv.schema.json", "dams.schema.json", "flows.schema.json", "forecast.schema.json",
        "forecast_rivers.schema.json",
        "live_floods.schema.json", "manifest.schema.json", "outlook.schema.json", "overview.schema.json",
        "places.schema.json",
        "radar.schema.json", "river_lines.schema.json",
        "road_flood_history.schema.json", "satellite.schema.json", "weather_today.schema.json"]
    schema = json.loads((tmp_path / "alerts.schema.json").read_text(encoding="utf-8"))
    assert schema["title"] == "AlertsFeed"
    assert "Alert" in schema["$defs"]
    assert schema["additionalProperties"] is False


def test_export_is_deterministic(tmp_path):
    export_schemas(tmp_path / "a")
    export_schemas(tmp_path / "b")
    for name in ("alerts.schema.json", "cctv.schema.json", "forecast.schema.json", "live_floods.schema.json",
                 "manifest.schema.json", "places.schema.json", "radar.schema.json", "road_flood_history.schema.json"):
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


def test_bank_evidence_is_optional_and_does_not_expand_measurements_into_reaches():
    old = dict(fetched_at=NOW, source_url="https://example.com", credit_th="Test", stations=[], notes_th=[])
    assert CanalLevels(**old).bank_observations == []
    point = dict(id="test", kind="measurement", name_th="Test", observed_at=NOW, verified=True,
                 source_url="https://example.com/evidence", credit_th="Test",
                 geometry={"type": "Point", "coordinates": [100.5, 13.75]}, level_m=1.2, bank_m=1,
                 level_datum="MSL-test", bank_datum="MSL-test", level_side="inner", bank_side="inner")
    file = CanalLevels(**old, bank_observations=[point])
    assert CanalLevels.model_validate_json(file.model_dump_json()) == file
    with pytest.raises(ValidationError):
        CanalLevels(**old, bank_observations=[dict(point, geometry={"type": "LineString",
                                                                  "coordinates": [[100, 13], [100, 14]]})])
    for coordinates in ([100, 91], [181, 13], [100, float("nan")], [100, 13, 0]):
        with pytest.raises(ValidationError):
            CanalLevels(**old, bank_observations=[dict(point, geometry={"type": "Point", "coordinates": coordinates})])


def test_bank_schema_uses_draft7_tuple_constraints_for_the_browser():
    coords = CanalLevels.model_json_schema()["$defs"]["BankPointGeometry"]["properties"]["coordinates"]
    assert "prefixItems" not in coords
    assert coords["items"][1]["maximum"] == 90
