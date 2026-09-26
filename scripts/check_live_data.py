#!/usr/bin/env python3
"""Check the published data from outside the VPS (GitHub Actions, workflow data-watch).

Writes a Thai report and "ok" or "problem" so the workflow can open, update or close one GitHub issue, which
emails the owner. Only the standard library is used.

    python3 scripts/check_live_data.py --report report.md --status status.txt
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import UTC, datetime, timedelta, timezone

DATA_BASE = "https://dizconnectz.github.io/fontokmai-data/data/v1/"
ICT = timezone(timedelta(hours=7))
# The VPS publishes every 15 minutes; these leave room for GitHub Pages' 10-minute cache and one missed round.
STALE = timedelta(minutes=40)
CAP_DOWN = timedelta(minutes=45)
RADAR_DOWN = timedelta(minutes=60)
# TMD posts a frame every 15 minutes about 20 minutes late; an hour means the source stopped making images
RADAR_OLD = timedelta(minutes=60)
FORECAST_OLD = timedelta(hours=13)
FLOODS_DOWN = timedelta(minutes=60)
DXS_DOWN = timedelta(minutes=60)
# rejected documents are only worth an alert when they could not be read, not when a download failed once
FETCH_WORDS = ("HTTP", "timed out", "Timeout", "connect", "Connection")
# every published round carries these; a file that drops out of the manifest is a problem of its own
EXPECTED_FILES = {
    "alerts.json": ("critical", "ประกาศกรมอุตุฯ"),
    "radar.json": ("warning", "เรดาร์"),
    "forecast/rain.json": ("warning", "พยากรณ์ฝน"),
    "live/floods.json": ("warning", "รายงานน้ำท่วมสด"),
    "ref/cctv.json": ("warning", "ทะเบียนกล้อง"),
    "ref/places.json": ("warning", "รายชื่อสถานที่สำหรับค้นหา"),
    "ref/road_flood_history.json": ("warning", "ประวัติน้ำท่วมถนน"),
}
# files a source must publish once it is part of the round (its status is in the manifest)
SOURCE_FILES = {
    "bma_dxs": {"bkk/water.json": "ระดับน้ำคลอง กทม.", "bkk/rain.json": "ฝนวัดจริง กทม.",
                "bkk/flooding.json": "รายงานถนนท่วม กทม."},
}


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _clock(value: datetime) -> str:
    return value.astimezone(ICT).strftime("%d/%m %H:%M")


def unreadable(message: str | None) -> list[str]:
    """Items of a status message ("; "-separated) that are not failed downloads."""
    return [item for item in (message or "").split("; ") if item and not any(w in item for w in FETCH_WORDS)]


def evaluate(manifest: dict, forecast: dict | None, now: datetime,
             radar: dict | None = None) -> list[tuple[str, str]]:
    """(level, Thai message) for every problem; empty when all is well."""
    problems: list[tuple[str, str]] = []
    generated = _time(manifest.get("generated_at"))
    if generated is None or now - generated > STALE:
        age = "ไม่ทราบเวลา" if generated is None else f"{int((now - generated).total_seconds() // 60)} นาที"
        problems.append(("critical", f"ข้อมูลหยุดอัปเดต: ชุดล่าสุดเก่า {age}"
                                     + (f" (ออกเมื่อ {_clock(generated)} น.)" if generated else "")
                                     + " · VPS หรือการเผยแพร่อาจหยุด"))
    sources = {s["source_id"]: s for s in manifest.get("source_status", [])}
    cap = sources.get("tmd_cap")
    if cap is None:
        problems.append(("critical", "ไม่มีสถานะของประกาศกรมอุตุฯ ใน manifest"))
    else:
        last = _time(cap.get("last_success_at"))
        if last is None or now - last > CAP_DOWN:
            problems.append(("critical", "ดึงประกาศกรมอุตุฯ ไม่สำเร็จ"
                                         + (f" ตั้งแต่ {_clock(last)} น." if last else "")
                                         + f" · {cap.get('message') or 'ไม่มีรายละเอียด'}"))
        elif cap.get("status") == "degraded" and (bad := unreadable(cap.get("message"))):
            problems.append(("warning", f"มีประกาศที่ระบบอ่านไม่ได้และถูกตัดออก: {'; '.join(bad)}"))
    for source_id, limit, name in (("tmd_radar", RADAR_DOWN, "ภาพเรดาร์"),
                                   ("longdo_floods", FLOODS_DOWN, "รายงานน้ำท่วมสด"),
                                   ("bma_dxs", DXS_DOWN, "ข้อมูลน้ำและฝน กทม. (DXS)")):
        status = sources.get(source_id)
        if status is None:
            continue
        last = _time(status.get("last_success_at"))
        if last is None or now - last > limit:
            problems.append(("warning", f"{name}ไม่อัปเดต"
                                        + (f" ตั้งแต่ {_clock(last)} น." if last else "")
                                        + f" · {status.get('message') or ''}".rstrip(" ·")))
    listed = {f.get("path") for f in manifest.get("files", [])}
    expected = dict(EXPECTED_FILES)
    for source_id, files in SOURCE_FILES.items():
        if source_id in sources:
            expected.update({path: ("warning", name) for path, name in files.items()})
    for path, (level, name) in expected.items():
        if path not in listed:
            problems.append((level, f"ไม่มีไฟล์{name} ({path}) ในชุดข้อมูลล่าสุด"))
    # a radar download can succeed every round while the source keeps serving the same old images
    if "radar.json" in listed:
        frames = (radar or {}).get("frames") or []
        latest = _time(frames[-1].get("time")) if frames else None
        if radar is None:
            problems.append(("warning", "เปิดไฟล์เรดาร์ไม่ได้"))
        elif latest is None:
            problems.append(("warning", "ไฟล์เรดาร์ไม่มีภาพเลย"))
        elif now - latest > RADAR_OLD:
            problems.append(("warning", f"ภาพเรดาร์ล่าสุดเป็นของ {_clock(latest)} น."
                                        f" (เก่า {int((now - latest).total_seconds() // 60)} นาที)"
                                        " · ต้นทางอาจหยุดทำภาพใหม่"))
    if "forecast/rain.json" in listed:
        fetched = _time((forecast or {}).get("fetched_at"))
        if fetched is None or now - fetched > FORECAST_OLD:
            problems.append(("warning", "พยากรณ์ฝนไม่อัปเดต"
                                        + (f" (ดึงล่าสุด {_clock(fetched)} น.)" if fetched else "")))
    return problems


def report(problems: list[tuple[str, str]], now: datetime, owner: str) -> str:
    lines = [f"ตรวจเมื่อ {_clock(now)} น. (เวลาไทย) จาก GitHub Actions · ข้อมูลที่ตรวจ: {DATA_BASE}", ""]
    for level, message in problems:
        lines.append(f"- {'🔴' if level == 'critical' else '🟠'} {message}")
    lines += ["", "issue นี้ปิดเองเมื่อทุกข้อกลับมาปกติ และจะไม่ส่งแจ้งเตือนซ้ำระหว่างที่ยังเปิดอยู่",
              f"cc @{owner}" if owner else ""]
    return "\n".join(lines).rstrip() + "\n"


def _get_json(url: str) -> dict:
    stamp = int(datetime.now(UTC).timestamp())
    request = urllib.request.Request(f"{url}?watch={stamp}", headers={"User-Agent": "fontokmai-data-watch"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--owner", default="")
    args = parser.parse_args(argv)
    now = datetime.now(UTC)
    try:
        manifest = _get_json(DATA_BASE + "manifest.json")
    except (OSError, ValueError) as exc:
        problems = [("critical", f"เปิดข้อมูลไม่ได้เลย: {exc}")]
    else:
        listed = {f.get("path") for f in manifest.get("files", [])}
        forecast = radar = None
        if "forecast/rain.json" in listed:
            try:
                forecast = _get_json(DATA_BASE + "forecast/rain.json")
            except (OSError, ValueError):
                forecast = None
        if "radar.json" in listed:
            try:
                radar = _get_json(DATA_BASE + "radar.json")
            except (OSError, ValueError):
                radar = None
        problems = evaluate(manifest, forecast, now, radar)
    with open(args.report, "w", encoding="utf-8") as fh:
        fh.write(report(problems, now, args.owner))
    with open(args.status, "w", encoding="utf-8") as fh:
        fh.write("problem" if problems else "ok")
    print("problem" if problems else "ok", *(message for _, message in problems), sep="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
