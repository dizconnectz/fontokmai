"""Radar colour-scale and overview regressions from offline, synthetic images."""

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from fontokmai import overview_build
from fontokmai.sources import tmd_radar as radar
from fontokmai.sources.tmd_cap.fetch import FetchError
from PIL import Image
from test_overview_delivery import gazetteer

NOW = datetime(2026, 9, 29, 5, 0, tzinfo=UTC)


def png(colour="#D43320"):
    image = Image.new("RGBA", (68, 100), colour)
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def page_legend(items):
    return "".join(
        f'<span class="cbar-swatch" style="background:{colour}"></span>'
        f'<span class="cbar-val">{value}</span>'
        for value, colour in items
    )


def test_html_legend_uses_values_from_page_and_lowest_duplicate_colour():
    items = [(value, colour) for value, colour, _ in radar.LEGEND]
    items += [(106.7, "#B72D54"), (636, "#EFE6F1")]
    parsed = radar.parse_legend(page_legend(items))
    values = {colour: value for value, colour, _ in parsed}
    assert values["#B72D54"] == 74.6 and values["#EFE6F1"] == 445
    assert values["#F3F453"] == 3
    assert radar.parse_legend("<html>unavailable</html>") is None


@pytest.mark.parametrize("legend", [[], [(1.0, "#D43320", "1")]])
@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="M29: fallback replaces the previous frame's legend",
)
def test_network_fallback_preserves_the_previous_frames_own_legend(tmp_path, legend):
    path = "radar/review.png"
    feed = radar._feed([(NOW, path)], "review-old", legend)
    (tmp_path / "radar").mkdir()
    (tmp_path / path).write_bytes(png())
    (tmp_path / "radar.json").write_text(feed.model_dump_json(), encoding="utf-8")

    def unavailable(url):
        raise FetchError("synthetic upstream outage")

    result = radar.collect_radar(unavailable, tmp_path, "review-new")
    assert not result.ok and len(result.feed.frames) == 1
    assert result.feed.legend == feed.legend, (
        "fallback must not revive unreadable data or change its units"
    )


@pytest.mark.parametrize(
    "case, expected",
    [
        ("two-heavy", True),
        ("empty-legend", False),
        ("one-frame", False),
        ("old", False),
        ("gap", False),
        ("small", False),
        ("earlier-dry", False),
    ],
)
def test_summary_requires_readable_fresh_persistent_radar(case, expected, monkeypatch):
    latest = NOW - (timedelta(minutes=46) if case == "old" else timedelta())
    gap = timedelta(minutes=25 if case == "gap" else 15)
    frames = [(latest - gap, "radar/before.png"), (latest, "radar/now.png")]
    if case == "one-frame":
        frames = frames[1:]
    feed = radar._feed(frames, "review", [] if case == "empty-legend" else None)
    files = {
        "radar.json": feed.model_dump_json().encode(),
        "radar/before.png": b"earlier",
        "radar/now.png": b"latest",
    }

    def samples(feed, content, bounds, threshold):
        if case == "earlier-dry" and content == b"earlier":
            return []
        return [(100, 14, 9.9 if case == "small" else 10.0, 36.5)]

    monkeypatch.setattr(overview_build, "rain_samples", samples)
    result = overview_build.build_overview(files, NOW, gazetteer(1))
    reasons = [
        r for item in result.items for r in item.reasons if r.kind == "rain_radar"
    ]
    assert bool(reasons) is expected
    if expected:
        assert reasons[0].until == latest + timedelta(minutes=45)
        assert reasons[0].source_th == "เรดาร์กรมอุตุฯ"


def test_real_pixel_reader_agrees_with_new_scale_and_refuses_empty_legend():
    feed = radar._feed([(NOW, "radar/review.png")], "review")
    samples = radar.rain_samples(feed, png("#F3F453"), (100, 13, 101, 14), 0)
    assert samples and {sample[3] for sample in samples} == {3.0}
    feed = feed.model_copy(update={"legend": []})
    assert radar.rain_samples(feed, png(), (100, 13, 101, 14), 0) == []
