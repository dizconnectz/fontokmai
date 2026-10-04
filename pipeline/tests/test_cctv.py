import json
from datetime import UTC, date, datetime
from importlib import resources

from fontokmai.contracts.cctv import CctvRegistry
from fontokmai.contracts.manifest import Manifest
from fontokmai.ref_data import build_cctv_dwr
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


def test_dwr_cameras_open_their_own_live_view_and_carry_no_password():
    registry = _registry()
    for camera in registry.cameras:
        assert "@" not in camera.page_url and "dyndns" not in camera.page_url  # the cameras' own addresses: never
    relayed = [c for c in registry.cameras if c.page_url.startswith("https://telemetry.dwr.go.th/cctv/mjpeg/")]
    assert len(relayed) >= 100
    boonrat = next(c for c in registry.cameras if c.id == "dwr-84")  # the user's example, 2026-10-04
    assert boonrat.page_url == "https://telemetry.dwr.go.th/cctv/mjpeg/TA130204"


def _camera(id_: str, name: str, location: list[float], position: str = "source") -> dict:
    return {"id": id_, "name_th": name, "owner_th": build_cctv_dwr.OWNER_TH, "kind": "river", "location": location,
            "position": position, "page_url": build_cctv_dwr.PAGE_URL, "note_th": None}


def _station(code: str, name: str, location: list[float], online: bool = True) -> dict:
    return {"code": code, "name_th": name, "place_th": "ต.ก อ.ข จ.ค", "online": online, "location": location}


def test_dwr_merge_links_by_place_adds_new_stations_and_drops_the_missing():
    registry = {"schema_version": "1", "updated": "2026-09-27", "notes_th": [], "cameras": [
        _camera("dwr-1", "ชื่อเดิม", [100.0, 14.0]),  # 0.1 km from TA000001 under another name
        _camera("dwr-2", "อ.เสนา", [100.4, 14.3], "approximate"),  # 1.1 km, and the names agree
        _camera("dwr-3", "ที่อื่น", [100.8, 14.3]),  # 1.1 km from TA000004 under another name: not the same
        _camera("dwr-4", "ใกล้กัน", [100.002, 14.0]),  # TA000001 goes to the nearer dwr-1
        {**_camera("user-x", "ของคนอื่น", [100.0, 14.0]), "owner_th": "อื่น", "page_url": "https://a.example/"},
    ]}
    stations = [
        _station("TA000001", "สะพานใหม่", [100.0009, 14.0]),
        _station("TA000002", "เสนา", [100.41, 14.3]),
        _station("TA000003", "คลองใหม่", [101.0, 15.0]),
        _station("TA000004", "ไกล", [100.81, 14.3]),
        _station("TA000005", "ปิดอยู่", [102.0, 15.0], online=False),
    ]
    merged = build_cctv_dwr.merge(registry, stations, date(2026, 10, 4))
    cameras = {c["id"]: c for c in merged["cameras"]}
    stream = build_cctv_dwr.STREAM_URL.format
    assert cameras["dwr-1"]["page_url"] == stream(code="TA000001")
    assert cameras["dwr-2"]["page_url"] == stream(code="TA000002")
    assert cameras["dwr-2"]["location"] == [100.41, 14.3] and cameras["dwr-2"]["position"] == "source"
    # no station of the department is theirs: nothing to open, so no pin
    assert "dwr-3" not in cameras and "dwr-4" not in cameras
    assert cameras["user-x"]["page_url"] == "https://a.example/"
    assert cameras["dwr-ta000003"]["kind"] == "canal" and cameras["dwr-ta000003"]["page_url"] == stream(code="TA000003")
    assert "dwr-ta000004" in cameras and "dwr-ta000005" not in cameras  # an offline station is not added
    assert list(cameras) == sorted(cameras) and merged["updated"] == "2026-10-04"
    CctvRegistry.model_validate(merged)
