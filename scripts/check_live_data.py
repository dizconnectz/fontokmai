#!/usr/bin/env python3
"""Check the published data from outside the VPS (GitHub Actions, workflow data-watch).

Writes a Thai report and "ok" or "problem" for the run's log and summary. Nothing is sent to anyone: the owner
asked for no emails (2026-10-01), and Claude reads the runs. Only the standard library is used.

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
RIVERS_OLD = timedelta(hours=37)  # rebuilt once a day; the web labels it after 36 hours
OVERVIEW_OLD = timedelta(minutes=40)  # rebuilt every round, like the manifest
# the large dams the server fetches by itself every 2 hours (RID, 2026-10-02); the web says late after 6 hours. A
# dams file that came with the Bangkok update by hand (no "automatic") is not judged: it arrives when someone sends it
DAMS_OLD = timedelta(hours=6)
# RID's daily report of 06:00 (D35), read by the server every 2 hours once it is up (about 10:30): a day RID skips is
# not yet a problem, two are. The canal outlook it feeds is rebuilt every round, like the overview
FLOWS_OLD = timedelta(hours=60)
CANALS_OLD = timedelta(minutes=40)
# the 14-day ensemble rain (contract section 24): fetched every 12 hours, again 3 hours after a failure; the web labels
# it old after 24 hours. A model needs 80% of its members on a day to be read (as the web reads it)
OUTLOOK_OLD = timedelta(hours=27)
OUTLOOK_SHARE = 0.8
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
    "forecast/rivers.json": ("warning", "แนวโน้มน้ำแม่น้ำ"),
    "summary/overview.json": ("warning", "สรุปจุดที่ต้องระวัง"),
    "ref/cctv.json": ("warning", "ทะเบียนกล้อง"),
    "ref/places.json": ("warning", "รายชื่อสถานที่สำหรับค้นหา"),
    "ref/road_flood_history.json": ("warning", "ประวัติน้ำท่วมถนน"),
    # fetched by the server itself since 2026-10-02 (Codex M46: a file dropped from the round was not noticed)
    "water/dams.json": ("warning", "เขื่อนใหญ่"),
    "forecast/outlook.json": ("warning", "แนวโน้มฝน 14 วัน"),
}
# files a source must publish once it is part of the round (its status is in the manifest)
SOURCE_FILES = {
    "bma_dxs": {"bkk/water.json": "ระดับน้ำคลอง กทม.", "bkk/rain.json": "ฝนวัดจริง กทม.",
                "bkk/flooding.json": "รายงานถนนท่วม กทม."},
}
# files a round must carry once it carries the canals they belong to (D35)
CANAL_FILES = {"water/flows.json": "รายงานน้ำกรมชลประทาน", "summary/canals.json": "คลองที่อาจล้น"}


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _clock(value: datetime) -> str:
    return value.astimezone(ICT).strftime("%d/%m %H:%M")


def unreadable(message: str | None) -> list[str]:
    """Items of a status message ("; "-separated) that are not failed downloads."""
    return [item for item in (message or "").split("; ") if item and not any(w in item for w in FETCH_WORDS)]


UNCHECKED: dict = {}  # a document the caller did not fetch: its age is not judged


def evaluate(manifest: dict, forecast: dict | None, now: datetime, radar: dict | None = None,
             rivers: dict | None = UNCHECKED, overview: dict | None = UNCHECKED,
             dams: dict | None = UNCHECKED, flows: dict | None = UNCHECKED,
             canals: dict | None = UNCHECKED, outlook: dict | None = UNCHECKED) -> list[tuple[str, str]]:
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
    if "ref/canals.json" in listed:
        expected.update({path: ("warning", name) for path, name in CANAL_FILES.items()})
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
    for path, document, field, limit, name in (
            ("forecast/rivers.json", rivers, "fetched_at", RIVERS_OLD, "แนวโน้มน้ำแม่น้ำ"),
            ("summary/overview.json", overview, "generated_at", OVERVIEW_OLD, "สรุปจุดที่ต้องระวัง"),
            ("summary/canals.json", canals, "generated_at", CANALS_OLD, "คลองที่อาจล้น")):
        if path not in listed or document is UNCHECKED:
            continue
        made = _time((document or {}).get(field))
        if made is None or now - made > limit:
            problems.append(("warning", f"{name}ไม่อัปเดต" + (f" (ทำล่าสุด {_clock(made)} น.)" if made else "")))
    if "water/dams.json" in listed and dams is not UNCHECKED:
        fetched = _time((dams or {}).get("fetched_at"))
        if dams is None or fetched is None:
            problems.append(("warning", "เปิดไฟล์เขื่อนไม่ได้"))
        elif dams.get("automatic") and now - fetched > DAMS_OLD:
            problems.append(("warning", f"ข้อมูลเขื่อนใหญ่ไม่อัปเดต (ดึงล่าสุด {_clock(fetched)} น.)"
                                        " · งานดึงจากกรมชลประทานทุก 2 ชม. อาจหยุด"))
    if "water/flows.json" in listed and flows is not UNCHECKED:
        observed = _time((flows or {}).get("observed_at"))
        if flows is None or observed is None:
            problems.append(("warning", "เปิดไฟล์รายงานน้ำกรมชลประทานไม่ได้"))
        elif now - observed > FLOWS_OLD:
            problems.append(("warning", f"รายงานน้ำกรมชลประทานไม่อัปเดต (ฉบับล่าสุดเป็นของ {_clock(observed)} น.)"
                                        " · งานอ่านรายงานทุก 2 ชม. อาจหยุด หรือรายงานเปลี่ยนรูปแบบ"))
    if "forecast/outlook.json" in listed and outlook is not UNCHECKED:
        problems += outlook_problems(outlook, now)
    return problems


def outlook_problems(outlook: dict | None, now: datetime) -> list[tuple[str, str]]:
    """The 14-day ensemble (Codex M46): unreadable, old, or with models that cannot be read on some or all points.
    A missing member's rain is null, never 0: it does not count towards a model's members."""
    fetched = _time((outlook or {}).get("fetched_at"))
    if outlook is None or fetched is None:
        return [("warning", "เปิดไฟล์แนวโน้มฝน 14 วันไม่ได้")]
    if now - fetched > OUTLOOK_OLD:
        return [("warning", f"แนวโน้มฝน 14 วันไม่อัปเดต (ดึงล่าสุด {_clock(fetched)} น.)")]
    days = len(outlook.get("days") or [])
    readable = gaps = 0  # (point, model) pairs readable on every day / not readable on some day or missing
    for point in outlook.get("points") or []:
        gaps += len(point.get("missing_models") or [])
        for model in point.get("models") or []:
            need = OUTLOOK_SHARE * (model.get("expected_members") or 0)
            members = model.get("members") or []
            counts = [sum(1 for m in members if d < len(m.get("rain_mm") or []) and m["rain_mm"][d] is not None)
                      for d in range(days)]
            if days and need and all(count >= need for count in counts):
                readable += 1
            else:
                gaps += 1
    if not readable:
        return [("warning", "แนวโน้มฝน 14 วันใช้ไม่ได้: ไม่มีจุดใดที่มีสมาชิกพอทุกวัน")]
    if gaps:
        return [("warning", f"แนวโน้มฝน 14 วันไม่ครบ: ขาดโมเดลหรือสมาชิกไม่พอ {gaps} ชุด (ใช้ได้ {readable} ชุด)")]
    return []


def report(problems: list[tuple[str, str]], now: datetime) -> str:
    """The run's own record, read in its log and summary; it mentions no one, so it emails no one (user 2026-10-01)."""
    lines = [f"ตรวจเมื่อ {_clock(now)} น. (เวลาไทย) จาก GitHub Actions · ข้อมูลที่ตรวจ: {DATA_BASE}", ""]
    for level, message in problems:
        lines.append(f"- {'🔴' if level == 'critical' else '🟠'} {message}")
    if not problems:
        lines.append("- ปกติ")
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
    args = parser.parse_args(argv)
    now = datetime.now(UTC)
    try:
        manifest = _get_json(DATA_BASE + "manifest.json")
    except (OSError, ValueError) as exc:
        problems = [("critical", f"เปิดข้อมูลไม่ได้เลย: {exc}")]
    else:
        listed = {f.get("path") for f in manifest.get("files", [])}
        # each listed file once; None when it could not be opened (a file not listed is not judged)
        documents: dict[str, dict | None] = {}
        for path in ("forecast/rain.json", "radar.json", "forecast/rivers.json", "summary/overview.json",
                     "water/dams.json", "water/flows.json", "summary/canals.json", "forecast/outlook.json"):
            if path in listed:
                try:
                    documents[path] = _get_json(DATA_BASE + path)
                except (OSError, ValueError):
                    documents[path] = None
        problems = evaluate(manifest, documents.get("forecast/rain.json"), now, documents.get("radar.json"),
                            documents.get("forecast/rivers.json"), documents.get("summary/overview.json"),
                            documents.get("water/dams.json"), documents.get("water/flows.json"),
                            documents.get("summary/canals.json"), documents.get("forecast/outlook.json"))
    with open(args.report, "w", encoding="utf-8") as fh:
        fh.write(report(problems, now))
    with open(args.status, "w", encoding="utf-8") as fh:
        fh.write("problem" if problems else "ok")
    print("problem" if problems else "ok", *(message for _, message in problems), sep="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
