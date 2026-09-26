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
FORECAST_OLD = timedelta(hours=13)
FLOODS_DOWN = timedelta(minutes=60)
# rejected documents are only worth an alert when they could not be read, not when a download failed once
FETCH_WORDS = ("HTTP", "timed out", "Timeout", "connect", "Connection")


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _clock(value: datetime) -> str:
    return value.astimezone(ICT).strftime("%d/%m %H:%M")


def evaluate(manifest: dict, forecast: dict | None, now: datetime) -> list[tuple[str, str]]:
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
        elif cap.get("status") == "degraded" and not any(w in (cap.get("message") or "") for w in FETCH_WORDS):
            problems.append(("warning", f"มีประกาศที่ระบบอ่านไม่ได้และถูกตัดออก: {cap.get('message')}"))
    for source_id, limit, name in (("tmd_radar", RADAR_DOWN, "ภาพเรดาร์"), ("longdo_floods", FLOODS_DOWN,
                                                                              "รายงานน้ำท่วมสด")):
        status = sources.get(source_id)
        if status is None:
            continue
        last = _time(status.get("last_success_at"))
        if last is None or now - last > limit:
            problems.append(("warning", f"{name}ไม่อัปเดต"
                                        + (f" ตั้งแต่ {_clock(last)} น." if last else "")
                                        + f" · {status.get('message') or ''}".rstrip(" ·")))
    if any(f.get("path") == "forecast/rain.json" for f in manifest.get("files", [])):
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
        forecast = None
        if any(f.get("path") == "forecast/rain.json" for f in manifest.get("files", [])):
            try:
                forecast = _get_json(DATA_BASE + "forecast/rain.json")
            except (OSError, ValueError):
                forecast = None
        problems = evaluate(manifest, forecast, now)
    with open(args.report, "w", encoding="utf-8") as fh:
        fh.write(report(problems, now, args.owner))
    with open(args.status, "w", encoding="utf-8") as fh:
        fh.write("problem" if problems else "ok")
    print("problem" if problems else "ok", *(message for _, message in problems), sep="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
