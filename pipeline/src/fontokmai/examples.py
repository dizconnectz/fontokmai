"""Deterministic example snapshots and expected consumer results (contracts/v1/examples)."""

from __future__ import annotations

import json
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fontokmai.run import SnapshotResult, run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import Fetcher, FetchError, fixture_fetcher

STALE_GRACE = timedelta(minutes=15)


@dataclass(frozen=True)
class Step:
    now: str
    source: str  # "real", "synthetic" or "down"
    index: str = "index.xml"


@dataclass(frozen=True)
class Scenario:
    description_th: str
    steps: tuple[Step, ...]
    mixed: bool = False  # manifest from the first step, alerts.json from the last step


SCENARIOS: dict[str, Scenario] = {
    "active": Scenario(
        "ประกาศจริงของกรมอุตุฯ ชุดวันที่ 2026-09-25 ประเมินเวลา 18:20: มีผล 3 เหตุ (หนึ่งเหตุใช้ expiry ตั้งต้น"
        " เพราะเวลาหมดอายุในต้นฉบับมาก่อนเวลามีผล) และหมดอายุ 6 เหตุ",
        (Step("2026-09-25T18:20:00+07:00", "real"),)),
    "pending": Scenario(
        "ชุดเดียวกันที่เวลา 17:30: ประกาศ TMD20260925163420_2 ยังไม่ถึงเวลามีผล (18:01) จึงเป็น pending",
        (Step("2026-09-25T17:30:00+07:00", "real"),)),
    "expired": Scenario(
        "ชุดเดียวกันที่ 2026-09-26 18:00: ทุกเหตุหมดอายุ เหลือเพียง tombstones",
        (Step("2026-09-26T18:00:00+07:00", "real"),)),
    "source-failed": Scenario(
        "ดึงสำเร็จตอน 18:05 แล้วรอบ 18:20 ดึงหน้ารวมไม่ได้: สถานะแหล่ง failed, snapshot เป็น partial"
        " และยังแสดงประกาศที่เก็บไว้แล้ว",
        (Step("2026-09-25T18:05:00+07:00", "real"), Step("2026-09-25T18:20:00+07:00", "down"))),
    "cancelled": Scenario(
        "ข้อมูลสังเคราะห์: ประกาศตอน 10:00 แล้วมี Cancel ตอน 12:00 → ประเมิน 12:30 เหลือ tombstone แบบ cancelled",
        (Step("2026-09-25T11:00:00+07:00", "synthetic", "index_alert.xml"),
         Step("2026-09-25T12:30:00+07:00", "synthetic", "index_both.xml"))),
    "out-of-order": Scenario(
        "ข้อมูลสังเคราะห์: เห็น Cancel ก่อนประกาศต้นฉบับ แล้วประกาศต้นฉบับมาทีหลัง → เหตุยังเป็น cancelled"
        " และไม่กลับมา active",
        (Step("2026-09-25T12:30:00+07:00", "synthetic", "index_cancel.xml"),
         Step("2026-09-25T12:45:00+07:00", "synthetic", "index_both.xml"))),
    "mixed-generation": Scenario(
        "manifest ของรอบ 18:20 คู่กับ alerts.json ของรอบ 18:35 (cache ปนรุ่น): generation_id ไม่ตรงกัน"
        " consumer ต้องโหลด manifest ใหม่และห้ามรวมสองรุ่น",
        (Step("2026-09-25T18:20:00+07:00", "real"), Step("2026-09-25T18:35:00+07:00", "real")),
        mixed=True),
}


def _down(url: str) -> bytes:
    raise FetchError(f"{url}: HTTP 503 (simulated)")


def _fetcher(step: Step, real: Path, synthetic: Path) -> Fetcher:
    if step.source == "down":
        return _down
    return fixture_fetcher(real if step.source == "real" else synthetic, index_name=step.index)


def _expected(name: str, scenario: Scenario, first: SnapshotResult, last: SnapshotResult) -> dict[str, Any]:
    manifest = first.manifest if scenario.mixed else last.manifest
    feed = last.feed
    return {
        "scenario": name,
        "description_th": scenario.description_th,
        "generation_match": manifest.generation_id == feed.generation_id,
        "completeness": manifest.completeness,
        "stale_after": (manifest.next_due_at + STALE_GRACE).isoformat(),
        "recovery_epoch": feed.recovery_epoch,
        "feed_sequence": feed.feed_sequence,
        "visible_alerts": [
            {"event_id": a.event_id, "revision": a.revision, "lifecycle_status": a.lifecycle_status,
             "is_effective": a.is_effective, "effective": a.effective.isoformat(),
             "expires": a.expires.isoformat(), "expires_policy": a.expires_policy, "qc_flags": a.qc_flags}
            for a in feed.alerts
        ],
        "ended_events": [
            {"event_id": t.event_id, "lifecycle_status": t.lifecycle_status, "ended_at": t.ended_at.isoformat()}
            for t in feed.tombstones
        ],
        "source_status": [
            {"source_id": s.source_id, "status": s.status,
             "last_success_at": s.last_success_at.isoformat() if s.last_success_at else None}
            for s in feed.source_status
        ],
    }


def write_examples(out: Path, *, real: Path, synthetic: Path) -> list[Path]:
    written: list[Path] = []
    for name, scenario in SCENARIOS.items():
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            results = [
                run_cap_snapshot(db=work / "state.db", out=work / f"step{i}", fetch=_fetcher(step, real, synthetic),
                                 now=datetime.fromisoformat(step.now), writer="example", owner_epoch=1)
                for i, step in enumerate(scenario.steps)
            ]
            last = len(results) - 1
            target = out / name
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True)
            shutil.copyfile(work / f"step{0 if scenario.mixed else last}" / "manifest.json", target / "manifest.json")
            shutil.copyfile(work / f"step{last}" / "alerts.json", target / "alerts.json")
            expected = _expected(name, scenario, results[0], results[last])
            (target / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n",
                                                   encoding="utf-8", newline="\n")
            written.extend(target / f for f in ("manifest.json", "alerts.json", "expected.json"))
    return written


ROAD_FLOOD_BUILT_AT = "2025-12-20T10:00:00+07:00"
ROAD_FLOOD_NORMALIZE = ["ถนนสุขุมวิท", "ถ.พระราม 2", "สุขุมวิท 21(อโศก)", "ซ.เพชรเกษม 42 *", "เฉลิมพระเกียรติ ร.๙",
                        "ถ.รังสิต-นครนายก", "ถนน"]
ROAD_FLOOD_SEARCHES = ["สุขุมวิท", "ถนนสุขุมวิท", "ดินแดง", "ถนนที่ไม่มีในข้อมูล", "ถนน"]
ROAD_FLOOD_PINS = [[100.6015, 13.7005], [100.5, 13.9]]


def write_road_flood_example(out: Path, fixtures: Path) -> list[Path]:
    """contracts/v1/examples/road-flood-history: the producer file and the answers a consumer must reproduce."""
    from fontokmai.feeds.road_flood import roads_near, search_roads
    from fontokmai.feeds.road_names import search_key
    from fontokmai.road_flood_build import REF_PATH, build_road_flood_history, fixture_files
    from fontokmai.sources.open_data.http import fixture_opener

    target = out / "road-flood-history"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        history = build_road_flood_history(work / "out", work / "cache", datetime.fromisoformat(ROAD_FLOOD_BUILT_AT),
                                           opener=fixture_opener(fixture_files(fixtures)), first_year=2024)
        shutil.copyfile(work / "out" / REF_PATH, target / "road_flood_history.json")

    def brief(road):
        return {"key": road.key, "name_th": road.name_th, "kind": road.kind, "flood_days": road.flood_days,
                "reports": road.reports, "last_date": road.last_date.isoformat(), "max_depth_cm": road.max_depth_cm}

    expected = {
        "scenario": "road-flood-history",
        "description_th": "ประวัติน้ำท่วมถนนจากไฟล์ตัวอย่าง (สถิติ กทม. ปี 2022, 2024, 2025 และเหตุการณ์ iTIC สังเคราะห์"
                          " ปี 2024–2025): การแปลงคำค้น ผลค้นชื่อถนน และถนนใกล้หมุดที่ consumer ต้องได้ตรงกัน",
        "normalize": [{"input": text, "key": search_key(text)} for text in ROAD_FLOOD_NORMALIZE],
        "searches": [{"query": q, "results": [brief(r) for r in search_roads(history, q)]}
                     for q in ROAD_FLOOD_SEARCHES],
        "near": [{"pin": pin, "radius_m": 2000,
                  "results": [dict(brief(road), distance_m=round(dist)) for road, dist in roads_near(history, pin)]}
                 for pin in ROAD_FLOOD_PINS],
    }
    (target / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n",
                                          encoding="utf-8", newline="\n")
    return [target / "road_flood_history.json", target / "expected.json"]


PLACES_EXAMPLE_PROVINCES = ("10", "13")  # Bangkok and Pathum Thani


def write_places_example(out: Path) -> list[Path]:
    """contracts/v1/examples/places: the shipped gazetteer cut to two provinces, small enough to read and test."""
    from importlib import resources

    from fontokmai.contracts.places import PlaceGazetteer

    shipped = resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes()
    gazetteer = PlaceGazetteer.model_validate_json(shipped)
    subset = PlaceGazetteer.model_validate({
        **gazetteer.model_dump(), "places": [p.model_dump() for p in gazetteer.places
                                             if p.code[:2] in PLACES_EXAMPLE_PROVINCES]})
    target = out / "places"
    target.mkdir(parents=True, exist_ok=True)
    path = target / "places.json"
    path.write_text(subset.model_dump_json(indent=2) + "\n", encoding="utf-8", newline="\n")
    return [path]
