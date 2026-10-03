"""The coloured state of the stations on RID's daily chart of the lower Chao Phraya (D35, user 2026-10-03).

Every morning RID posts a picture of the basin at 06:00 (water.rid.go.th/flood/plan_new, one JPEG a day) with a dot of
its own at each gauging station: green normal, yellow critical, red flood. The figures of the chart are also in RID's
daily report, which has text (rid_report.py); the dots are only in the picture, and their colour reads reliably. The
picture itself is never copied or published (D35).

The chart is drawn by hand each day: its canvas changes size (1000×1294 or 1000×1414) and the drawing moves by a few
pixels, but it keeps its place inside the outer frame, so each dot is looked for at its place relative to the frame.
A dot that is not there in one of the three colours is left unknown, never guessed.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass

from PIL import Image

CHART_URL = "https://water.rid.go.th/flood/plan_new/chaophaya/Chao_low{day:%d%m%Y}.jpg"


class ChartError(RuntimeError):
    """The picture could not be read as RID's chart."""


@dataclass
class Frame:
    left: int
    top: int
    right: int
    bottom: int

    def point(self, u: float, v: float) -> tuple[float, float]:
        return self.left + u * (self.right - self.left), self.top + v * (self.bottom - self.top)


def find_frame(image: Image.Image) -> Frame:
    """The chart's outer frame: the outermost rows and columns crossed by a dark line over most of the canvas."""
    gray = image.convert("L")
    width, height = gray.size
    px = gray.load()

    def longest(values) -> int:
        best = run = 0
        for value in values:
            run = run + 1 if value < 160 else 0
            best = max(best, run)
        return best

    rows = [y for y in range(height) if longest(px[x, y] for x in range(width)) > 0.7 * width]
    cols = [x for x in range(width) if longest(px[x, y] for y in range(height)) > 0.6 * height]
    if not rows or not cols:
        raise ChartError("no frame")
    frame = Frame(min(cols), min(rows), max(cols), max(rows))
    if frame.right - frame.left < 0.6 * width or frame.bottom - frame.top < 0.6 * height:
        raise ChartError(f"frame too small: {frame}")
    return frame


# RID's legend: green normal, yellow critical, red flood (ระดับและปริมาณน้ำปกติ / วิกฤต / ท่วม)
DOT_COLOURS: dict[str, Callable[[int, int, int], bool]] = {
    "normal": lambda r, g, b: g > 150 and r < 140 and b < 140,
    "critical": lambda r, g, b: r > 200 and g > 180 and b < 120,
    "flood": lambda r, g, b: r > 170 and g < 90 and b < 90,
}
DOT_PIXELS = 12  # a dot is about 13 px across: fewer pixels of one colour is not a dot


def read_dot(image: Image.Image, frame: Frame, at: tuple[float, float], radius: int = 7) -> str | None:
    """RID's state of a station from the colour of its dot, or None when no dot of the three colours is there."""
    cx, cy = frame.point(*at)
    rgb = image.load()
    counts = dict.fromkeys(DOT_COLOURS, 0)
    for y in range(int(cy) - radius, int(cy) + radius + 1):
        for x in range(int(cx) - radius, int(cx) + radius + 1):
            if 0 <= x < image.width and 0 <= y < image.height:
                r, g, b = rgb[x, y][:3]
                for state, test in DOT_COLOURS.items():
                    if test(r, g, b):
                        counts[state] += 1
    state, count = max(counts.items(), key=lambda item: item[1])
    return state if count >= DOT_PIXELS else None


def chart_states(data: bytes, dots: dict[str, tuple[float, float]]) -> dict[str, str | None]:
    """The state of each station by id, from the picture's bytes; ChartError when it is not the chart."""
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except OSError as exc:
        raise ChartError(f"not a picture: {exc}") from exc
    frame = find_frame(image)
    return {point_id: read_dot(image, frame, at) for point_id, at in dots.items()}
