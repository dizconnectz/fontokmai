import json
from datetime import UTC, datetime
from importlib import resources

from fontokmai.contracts.cctv import CctvRegistry
from fontokmai.contracts.manifest import Manifest
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES


def _registry() -> CctvRegistry:
    return CctvRegistry.model_validate_json(resources.files("fontokmai.ref_data").joinpath("cctv.json").read_bytes())


def test_registry_links_out_and_stays_inside_thailand():
    registry = _registry()
    ids = [c.id for c in registry.cameras]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
    for camera in registry.cameras:
        assert camera.page_url.startswith(("https://", "http://"))
        if camera.location:
            lon, lat = camera.location
            assert 97 <= lon <= 106 and 5 <= lat <= 21
    saphan_daeng = next(c for c in registry.cameras if c.id == "user-saphandaeng-rangsit")
    assert saphan_daeng.page_url == "https://www.ipcamlive.com/6ab688b9f0f7d" and saphan_daeng.position == "approximate"


def test_snapshot_publishes_the_registry(tmp_path):
    out = tmp_path / "v1"
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                     now=datetime(2026, 9, 25, 11, 20, tzinfo=UTC), writer="t", owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert "ref/cctv.json" in [f.path for f in manifest.files]
    assert json.loads((out / "ref" / "cctv.json").read_text(encoding="utf-8")) == json.loads(
        _registry().model_dump_json())
