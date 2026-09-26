import struct
import zlib
from datetime import UTC, datetime

import pytest

from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.radar import RadarFeed
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import FetchError, fixture_fetcher
from fontokmai.sources.tmd_radar import (
    IMAGE_BASE,
    LIST_URL,
    collect_radar,
    mercator_height,
    parse_list,
    png_size,
    prune_frames,
)
from helpers import FIXTURES


def _png(seed: int, width: int = 68, height: int = 100) -> bytes:
    """A small frame with the Web Mercator shape of the TMD corners (68 x 100 px; TMD's is 1800 x 2644)."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = (b"\x00" + bytes([seed % 256, 0, 0, 255]) * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _listing(times: list[str]) -> str:
    lines = [f'background_THA.png "{t}" overlay=zr/{i}.png' for i, t in enumerate(times)]
    return "\n".join(["# frames", *lines, "garbage line"]) + "\n"


class FakeTmd:
    def __init__(self, times: list[str]):
        self.times = times
        self.calls: list[str] = []
        self.shift_after_images = False

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url == LIST_URL:
            return _listing(self.times).encode()
        index = int(url.removeprefix(IMAGE_BASE + "zr/").removesuffix(".png"))
        if self.shift_after_images and index == len(self.times) - 1:
            self.shift_after_images = False
            self.times = self.times[1:] + ["2026-09-25 19:15"]
        return _png(index)


TIMES = ["2026-09-25 17:45", "2026-09-25 18:00", "2026-09-25 18:15", "2026-09-25 18:30", "2026-09-25 18:45"]


def test_parse_list_reads_rain_rate_overlays_in_utc():
    frames = parse_list(_listing(TIMES[:2]))
    assert frames == [(datetime(2026, 9, 25, 17, 45, tzinfo=UTC), "zr/0.png"),
                      (datetime(2026, 9, 25, 18, 0, tzinfo=UTC), "zr/1.png")]


def test_collect_keeps_the_last_hour_and_reuses_files_on_disk(tmp_path):
    tmd = FakeTmd(TIMES)
    first = collect_radar(tmd, tmp_path, "g1")
    assert first.ok and [f.path for f in first.feed.frames] == [
        "radar/20260925T1800Z.png", "radar/20260925T1815Z.png", "radar/20260925T1830Z.png", "radar/20260925T1845Z.png"]
    assert set(first.files) == {f.path for f in first.feed.frames} | {"radar.json"}
    for path, data in first.files.items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(data)
    tmd.calls.clear()
    tmd.times = TIMES[1:] + ["2026-09-25 19:00"]
    second = collect_radar(tmd, tmp_path, "g2")
    assert [c for c in tmd.calls if c != LIST_URL] == [IMAGE_BASE + "zr/4.png"]  # only the new frame
    assert second.feed.frames[-1].path == "radar/20260925T1900Z.png"
    assert RadarFeed.model_validate_json(second.files["radar.json"]).generation_id == "g2"


def test_a_list_that_moves_during_the_download_is_read_again(tmp_path):
    tmd = FakeTmd(TIMES)
    tmd.shift_after_images = True
    result = collect_radar(tmd, tmp_path, "g")
    assert result.ok and result.feed.frames[-1].path == "radar/20260925T1915Z.png"


def test_failure_keeps_the_previous_frames_and_reports_failed(tmp_path):
    ok = collect_radar(FakeTmd(TIMES), tmp_path, "g1")
    for path, data in ok.files.items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(data)

    def down(url: str) -> bytes:
        raise FetchError(f"{url}: HTTP 503")

    failed = collect_radar(down, tmp_path, "g2")
    assert not failed.ok and "503" in (failed.message or "")
    assert [f.path for f in failed.feed.frames] == [f.path for f in ok.feed.frames]
    assert failed.feed.generation_id == "g2"


def test_prune_removes_frames_no_longer_listed(tmp_path):
    (tmp_path / "radar").mkdir()
    for name in ("20260925T1745Z.png", "20260925T1800Z.png"):
        (tmp_path / "radar" / name).write_bytes(_png(1))
    feed = collect_radar(FakeTmd(TIMES), tmp_path, "g").feed
    assert prune_frames(tmp_path, feed) == ["radar/20260925T1745Z.png"]


@pytest.mark.parametrize("radar_up", [True, False])
def test_snapshot_lists_radar_files_and_status(tmp_path, radar_up):
    def radar_fetch(url: str) -> bytes:
        if not radar_up:
            raise FetchError("down")
        return FakeTmd(TIMES)(url)

    out = tmp_path / "v1"
    now = datetime(2026, 9, 25, 11, 20, tzinfo=UTC)
    result = run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES), now=now, writer="t",
                              owner_epoch=1, radar_fetch=radar_fetch)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    paths = [f.path for f in manifest.files]
    assert "radar.json" in paths
    radar_status = next(s for s in manifest.source_status if s.source_id == "tmd_radar")
    assert radar_status.status == ("ok" if radar_up else "failed")
    assert manifest.completeness == ("complete" if radar_up else "partial")
    assert (len([p for p in paths if p.startswith("radar/")]) == 4) is radar_up
    assert result.radar is not None and result.radar.generation_id == manifest.generation_id


def test_frames_are_web_mercator_images_of_the_corners():
    # TMD's composite is 1800 x 2644 px: the Mercator height of 95-108 E x 4-22.5 N at that width is 2644.4 px,
    # while an even lat/lon grid would be 2561.5 px, so rows must be read in Mercator y (contract section 9)
    assert round(mercator_height(1800), 1) == 2644.4
    assert png_size(_png(0, 1800, 2644)) == (1800, 2644)
    assert png_size(b"not a png") is None


def test_a_frame_of_another_shape_is_rejected(tmp_path):
    tmd = FakeTmd(TIMES[:2])

    def fetch(url: str) -> bytes:
        return _png(1, 70, 72) if url.endswith("zr/0.png") else tmd(url)  # square-ish: not the TMD box

    result = collect_radar(fetch, tmp_path, "g1")
    assert [f.path for f in result.feed.frames] == ["radar/20260925T1800Z.png"]
    assert result.rejected == 1 and result.ok
    assert "Web Mercator" in result.message
    assert result.feed.projection == "EPSG:3857"
