import struct
import zlib
from datetime import UTC, datetime, timedelta

import pytest

from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.radar import RadarFeed
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import FetchError, fixture_fetcher
from fontokmai.sources.tmd_radar import (
    IMAGE_BASE,
    LEGEND,
    LIST_URL,
    PAGE_URL,
    _feed,
    collect_radar,
    frame_due,
    mercator_height,
    mercator_y,
    new_frame_listed,
    parse_legend,
    parse_list,
    png_size,
    prune_frames,
    rain_samples,
)
from helpers import FIXTURES

THAILAND = (97.3, 5.6, 105.7, 20.5)


def _rgb(colour: str) -> bytes:
    return bytes(int(colour[i:i + 2], 16) for i in (1, 3, 5))


def _png(seed: int, width: int = 68, height: int = 100, colour: str | None = None) -> bytes:
    """A small frame with the Web Mercator shape of the TMD corners (68 x 100 px; TMD's is 1800 x 2644), drawn in
    a colour of the scale unless another is given."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = (b"\x00" + (_rgb(colour or LEGEND[seed % len(LEGEND)][1]) + b"\xff") * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _page(legend: list[tuple[float, str, str]]) -> bytes:
    """The colour bar as the TMD page writes it (2026-09-28)."""
    items = "".join(f'<div class="cbar-item"><span class="cbar-swatch" style="background:{colour}"></span>'
                    f'<span class="cbar-val">{label}</span></div>\n' for _, colour, label in legend)
    return f'<html><div class="cbar-strip">\n{items}</div></html>'.encode()


def _listing(times: list[str]) -> str:
    lines = [f'background_THA.png "{t}" overlay=zr/{i}.png' for i, t in enumerate(times)]
    return "\n".join(["# frames", *lines, "garbage line"]) + "\n"


class FakeTmd:
    def __init__(self, times: list[str]):
        self.times = times
        self.calls: list[str] = []
        self.shift_after_images = False
        self.page = _page(LEGEND)
        self.old_scale: set[int] = set()  # frames drawn in TMD's scale before 28 Sep

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url == LIST_URL:
            return _listing(self.times).encode()
        if url == PAGE_URL:
            return self.page
        index = int(url.removeprefix(IMAGE_BASE + "zr/").removesuffix(".png"))
        if self.shift_after_images and index == len(self.times) - 1:
            self.shift_after_images = False
            self.times = self.times[1:] + ["2026-09-25 19:15"]
        return _png(index, colour="#FF8000" if index in self.old_scale else None)


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
    assert [c for c in tmd.calls if c not in (LIST_URL, PAGE_URL)] == [IMAGE_BASE + "zr/4.png"]  # only the new
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
    # the frames keep the colour bar they were published with, not the one written in the code (Codex M29)
    assert failed.feed.legend == ok.feed.legend and failed.feed.legend_opacity == ok.feed.legend_opacity
    unreadable = ok.feed.model_copy(update={"legend": []})
    (tmp_path / "radar.json").write_text(unreadable.model_dump_json(), encoding="utf-8")
    assert collect_radar(down, tmp_path, "g3").feed.legend == []
    (tmp_path / "radar.json").write_text("{broken", encoding="utf-8")
    nothing = collect_radar(down, tmp_path, "g4")
    assert nothing.feed.frames == [] and nothing.feed.legend == []


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


def test_the_colour_scale_is_read_from_the_page_and_a_repeated_colour_keeps_its_lower_value():
    page = _page([(636.0, "#EFE6F1", "&gt; 636.0"), (445.0, "#EFE6F1", "445.0"), (36.5, "#D43320", "36.5"),
                  (17.9, "#D79C37", "17.9"), (12.5, "#D79C37", "12.5"), (3.0, "#F3F453", "3.00"),
                  (1.03, "#69CB5A", "1.03"), (0.21, "#54A431", "0.21")]).decode()
    assert parse_legend(page) == [(445.0, "#EFE6F1", "445"), (36.5, "#D43320", "36.5"), (12.5, "#D79C37", "12.5"),
                                  (3.0, "#F3F453", "3"), (1.03, "#69CB5A", "1.03"), (0.21, "#54A431", "0.21")]
    assert parse_legend("<html>no colour bar</html>") is None


def test_a_page_without_its_colour_bar_leaves_the_scale_of_28_september(tmp_path):
    tmd = FakeTmd(TIMES)
    tmd.page = b"<html>a new page</html>"
    result = collect_radar(tmd, tmp_path, "g")
    assert result.ok and [(i.min_mm_per_hr, i.color) for i in result.feed.legend] == [(v, c) for v, c, _ in LEGEND]
    assert "2026-09-28" in result.message


def test_older_frames_in_another_colour_scale_are_left_out(tmp_path):
    # TMD changed its scale between 11:30 and 11:45 on 28 Sep 2026: an hour had frames of both
    tmd = FakeTmd(TIMES)
    tmd.old_scale = {0, 1, 2, 3}
    result = collect_radar(tmd, tmp_path, "g")
    assert [f.path for f in result.feed.frames] == ["radar/20260925T1845Z.png"]
    assert set(result.files) == {"radar/20260925T1845Z.png", "radar.json"}
    assert result.feed.legend and "3 older frame(s) left out" in result.message


def test_a_latest_frame_in_another_colour_scale_goes_out_without_a_legend(tmp_path):
    tmd = FakeTmd(TIMES)
    tmd.old_scale = {0, 1, 2, 3, 4}
    result = collect_radar(tmd, tmp_path, "g")
    assert len(result.feed.frames) == 4 and result.feed.legend == []  # the pictures, but nothing to read them with
    assert "legend left empty" in result.message


def _frame(blocks: list[tuple[float, float, str]], half: int = 5) -> bytes:
    """A frame of TMD's size, transparent but for squares of (2 half + 1) px of a colour at (lon, lat)."""
    from io import BytesIO

    from PIL import Image
    width = 1800
    height = round(mercator_height(width))
    image = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    top, span = mercator_y(22.5), mercator_y(22.5) - mercator_y(4.0)
    for lon, lat, colour in blocks:
        x = int((lon - 95.0) / 13.0 * width)
        y = int((top - mercator_y(lat)) / span * height)
        image.paste((*_rgb(colour), 255), (x - half, y - half, x + half + 1, y + half + 1))
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_rain_rates_are_read_where_the_frame_draws_them():
    feed = _feed([], "g", LEGEND)
    png = _frame([(100.63, 13.99, "#D43320"), (100.3, 16.0, "#F3F453")])  # 36.5 at Rangsit, 3 near Phitsanulok
    heavy = rain_samples(feed, png, THAILAND, 35.0)
    assert heavy and {value for *_, value in heavy} == {36.5}
    assert sum(lon for lon, *_ in heavy) / len(heavy) == pytest.approx(100.63, abs=0.02)
    assert sum(lat for _, lat, *_ in heavy) / len(heavy) == pytest.approx(13.99, abs=0.02)
    assert sum(km2 for _, _, km2, _ in heavy) == pytest.approx(11 * 11 * 0.78**2, rel=0.35)  # 121 px of ~0.8 km
    assert len(rain_samples(feed, png, THAILAND, 1.0)) > len(heavy)
    assert rain_samples(_feed([], "g", []), png, THAILAND, 35.0) == []  # no legend: nothing is read
    assert rain_samples(feed, _png(0, colour="#F3F453"), THAILAND, 35.0) == []  # light rain everywhere


def test_colours_off_the_legend_are_not_rain():
    # pure red is nearest the 36.5 class and brown the 74.6 one, but neither is a legend colour: a line or a label
    feed = _feed([], "g", LEGEND)
    png = _frame([(100.63, 13.99, "#FF0000"), (100.3, 16.0, "#782828"), (101.0, 15.0, "#D43320")])
    heavy = rain_samples(feed, png, THAILAND, 35.0)
    assert heavy and {value for *_, value in heavy} == {36.5}
    assert all(abs(lon - 101.0) < 0.1 for lon, *_ in heavy)



def test_tmd_is_asked_for_a_new_frame_only_while_it_is_due_and_says_so_once_listed(tmp_path):
    """User 2026-10-09: a round starts as soon as TMD posts the next frame (schedule.py). Its list is asked for only
    from 10 to 30 minutes after the next frame's time; without a published frame the grid fetches the first."""
    newest = datetime(2026, 10, 9, 4, 30, tzinfo=UTC)
    asked = []

    def fetch(url):
        asked.append(url)
        return b'background_THA.png "2026-10-09 04:30" overlay=zr/23.png\n' + listed[0]

    listed = [b""]
    assert not new_frame_listed(fetch, tmp_path, newest + timedelta(minutes=27)) and asked == []  # no radar.json yet
    (tmp_path / "radar.json").write_text(
        _feed([(newest, "radar/20261009T0430Z.png")], "g", []).model_dump_json(), encoding="utf-8")
    # 04:50 is too soon for the frame of 04:45, 05:20 too late (the grid has it): nothing is asked
    for minute in (50, 80):
        assert frame_due(tmp_path, newest + timedelta(minutes=minute - 30)) is None
        assert not new_frame_listed(fetch, tmp_path, newest + timedelta(minutes=minute - 30))
    assert asked == []
    # due: not listed yet, then listed
    at = newest + timedelta(minutes=26)  # 04:56
    assert not new_frame_listed(fetch, tmp_path, at) and len(asked) == 1
    listed[0] = b'background_THA.png "2026-10-09 04:45" overlay=zr/24.png\n'
    assert new_frame_listed(fetch, tmp_path, at + timedelta(minutes=1))
