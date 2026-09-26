"""Command line: export-schemas, contract-examples, cap-snapshot, road-flood-history, rain-forecast and schedule."""

from __future__ import annotations

import argparse
import json
import shlex
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fontokmai.contracts.export import export_schemas
from fontokmai.examples import (
    write_bkk_examples,
    write_examples,
    write_forecast_example,
    write_live_floods_example,
    write_places_example,
    write_road_flood_example,
)
from fontokmai.forecast_build import budget as forecast_budget
from fontokmai.forecast_build import build_rain_forecast, refresh_rain_forecast
from fontokmai.publish.git_pages import publish_snapshot
from fontokmai.road_flood_build import build_road_flood_history, fixture_files, is_fresh
from fontokmai.run import SnapshotResult, run_cap_snapshot
from fontokmai.schedule import run_forever
from fontokmai.sources.open_data.http import fixture_opener, open_url
from fontokmai.sources.open_data.longdo_live import FEED_URL as LONGDO_FEED_URL
from fontokmai.sources.tmd_cap.fetch import LiveFetcher, fixture_fetcher
from fontokmai.sources.tmd_radar import summary as radar_summary

ROAD_FLOOD_RETRY = timedelta(hours=6)


def ssh_command(key: Path, known_hosts: Path) -> str:
    """ssh for git: only the given deploy key, and only the pinned host keys."""
    return " ".join([
        "ssh", "-i", shlex.quote(str(key)), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={shlex.quote(str(known_hosts))}",
    ])


def _summary(result: SnapshotResult) -> dict[str, Any]:
    summary = {"generation_id": result.manifest.generation_id, "feed_sequence": result.feed.feed_sequence,
               "alerts": len(result.feed.alerts), "tombstones": len(result.feed.tombstones),
               "source_status": result.status.status}
    if result.radar is not None:
        radar_status = next(s.status for s in result.manifest.source_status if s.source_id == "tmd_radar")
        summary["radar"] = {**radar_summary(result.radar), "status": radar_status}
    return summary


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="fontokmai")
    sub = parser.add_subparsers(dest="command", required=True)
    schemas = sub.add_parser("export-schemas", help="write JSON Schemas of the public contract")
    schemas.add_argument("--out", type=Path, required=True)
    examples = sub.add_parser("contract-examples", help="write example snapshots with expected consumer results")
    examples.add_argument("--out", type=Path, required=True)
    examples.add_argument("--real-fixtures", type=Path, required=True)
    examples.add_argument("--synthetic-fixtures", type=Path, required=True)
    examples.add_argument("--road-flood-fixtures", type=Path, help="also write the road-flood-history example")
    examples.add_argument("--forecast-fixtures", type=Path, help="also write the rain forecast example")
    examples.add_argument("--live-floods-fixtures", type=Path, help="also write the live flood reports example")
    examples.add_argument("--bkk-fixtures", type=Path, help="also write the Bangkok water and rain examples (DXS)")
    cap = sub.add_parser("cap-snapshot", help="collect TMD CAP alerts and write a /data/v1 snapshot")
    cap.add_argument("--db", type=Path, required=True, help="SQLite state file")
    cap.add_argument("--out", type=Path, required=True, help="snapshot directory")
    cap.add_argument("--fixtures", type=Path, help="read the feed from a local directory instead of the network")
    cap.add_argument("--now", help="evaluation time, ISO 8601 with offset (default: current time)")
    cap.add_argument("--writer", default="local")
    cap.add_argument("--owner-epoch", type=int, default=1)
    cap.add_argument("--radar", action="store_true", help="also republish the latest TMD radar frames (network)")
    cap.add_argument("--floods", type=Path, help="read live flood reports from this RSS file (tests and examples)")
    road = sub.add_parser("road-flood-history", help="build ref/road_flood_history.json from BMA and iTIC open data")
    road.add_argument("--out", type=Path, required=True, help="snapshot directory; the file goes to ref/")
    road.add_argument("--cache", type=Path, required=True, help="directory for the per-year iTIC caches")
    road.add_argument("--first-year", type=int, default=2012)
    road.add_argument("--fixtures", type=Path, help="read local fixture files instead of the network")
    road.add_argument("--now", help="build time, ISO 8601 with offset (default: current time)")
    rain = sub.add_parser("rain-forecast", help="build forecast/rain.json from Open-Meteo (about 900 API calls)")
    rain.add_argument("--out", type=Path, required=True, help="snapshot directory; the file goes to forecast/")
    rain.add_argument("--fixtures", type=Path, help="read a recorded answer instead of the network (examples)")
    rain.add_argument("--now", help="fetch time, ISO 8601 with offset (default: current time)")
    rain.add_argument("--db", type=Path,
                      help="state database of the scheduled job, so a manual run counts in its Open-Meteo budget")
    probe = sub.add_parser("dxs-probe", help="call one BMA DXS service and print the shape of its answer")
    probe.add_argument("operation", help="service function, e.g. GetWaterLastData")
    probe.add_argument("--account", type=Path, required=True, help="file with the DXS user name and password")
    probe.add_argument("--param", action="append", default=[], help="NAME=VALUE for the service, repeatable")
    sched = sub.add_parser("schedule", help="run cap-snapshot on the 15-minute grid and optionally publish it")
    sched.add_argument("--db", type=Path, required=True)
    sched.add_argument("--out", type=Path, required=True)
    sched.add_argument("--writer", default="vps")
    sched.add_argument("--owner-epoch", type=int, default=1)
    sched.add_argument("--publish-remote", default="",
                       help="git remote of the static-hosting branch (empty = no publish)")
    sched.add_argument("--publish-work", type=Path, help="scratch directory for the publish commit")
    sched.add_argument("--ssh-key", type=Path, help="deploy key for git over SSH")
    sched.add_argument("--known-hosts", type=Path, help="known_hosts file of the git host")
    sched.add_argument("--cache", type=Path,
                       help="iTIC cache directory; when set, rebuild ref/road_flood_history.json once a week")
    sched.add_argument("--dxs-account", type=Path,
                       help="BMA DXS account file (user name, password); empty or missing = no DXS data")
    sched.add_argument("--forecast", action="store_true",
                       help="rebuild forecast/rain.json from Open-Meteo every 6 hours (network)")
    sched.add_argument("--max-rounds", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.command == "schedule" and args.publish_remote and args.publish_work is None:
        parser.error("--publish-remote needs --publish-work")
    return args


def _dxs_account(path: Path | None) -> Any:
    """The DXS account, or None when no file (or an empty one) is mounted: the round then skips DXS."""
    if path is None or not path.is_file() or path.stat().st_size == 0:
        return None
    from fontokmai.sources.bma_dxs import load_account
    return load_account(path)


def _scheduled_job(args: argparse.Namespace) -> Callable[[datetime], dict[str, Any]]:
    ssh = ssh_command(args.ssh_key, args.known_hosts) if args.ssh_key and args.known_hosts else None
    last_road_attempt: list[datetime] = []

    def refresh_road_flood(now: datetime) -> str | None:
        """Weekly rebuild of the road-flood history; failures never stop the alerts snapshot."""
        if args.cache is None or is_fresh(args.out, now):
            return None
        if last_road_attempt and now - last_road_attempt[-1] < ROAD_FLOOD_RETRY:
            return "waiting to retry"
        last_road_attempt[:] = [now]
        try:
            history = build_road_flood_history(args.out, args.cache, now, backfill=False)
        except Exception as exc:  # noqa: BLE001 - reported in the round log, the job goes on
            return f"error: {type(exc).__name__}: {exc}"[:300]
        return f"built {len(history.roads)} roads"

    def refresh_forecast(now: datetime) -> str | None:
        """Rain forecast every 6 hours within a daily call budget; failures never stop the alerts snapshot."""
        return refresh_rain_forecast(args.out, args.db, now) if args.forecast else None

    def job(now: datetime) -> dict[str, Any]:
        road_flood = refresh_road_flood(now)
        fetch = LiveFetcher()
        try:
            result = run_cap_snapshot(db=args.db, out=args.out, fetch=fetch, now=now, writer=args.writer,
                                      owner_epoch=args.owner_epoch, radar_fetch=fetch, floods_opener=open_url,
                                      dxs_account=_dxs_account(args.dxs_account))
        finally:
            fetch.close()
        summary = _summary(result)
        if road_flood:
            summary["road_flood_history"] = road_flood
        if args.publish_remote:
            commit = publish_snapshot(args.out, args.publish_work, args.publish_remote,
                                      message=result.manifest.generation_id, ssh_command=ssh)
            summary["published"] = commit[:12]
        # after publishing: the paced requests (about 2.5 minutes) never delay the alerts; the next round
        # lists the new forecast
        forecast = refresh_forecast(now)
        if forecast:
            summary["forecast"] = forecast
        return summary

    return job


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.command == "export-schemas":
        for path in export_schemas(args.out):
            print(path.as_posix())
        return 0
    if args.command == "contract-examples":
        written = write_examples(args.out, real=args.real_fixtures, synthetic=args.synthetic_fixtures)
        written += write_places_example(args.out)
        if args.road_flood_fixtures:
            written += write_road_flood_example(args.out, args.road_flood_fixtures)
        if args.forecast_fixtures:
            written += write_forecast_example(args.out, args.forecast_fixtures)
        if args.live_floods_fixtures:
            written += write_live_floods_example(args.out, args.live_floods_fixtures)
        if args.bkk_fixtures:
            written += write_bkk_examples(args.out, args.bkk_fixtures)
        for path in written:
            print(path.as_posix())
        return 0
    if args.command == "road-flood-history":
        now = datetime.fromisoformat(args.now) if args.now else datetime.now(UTC)
        opener = fixture_opener(fixture_files(args.fixtures)) if args.fixtures else open_url
        history = build_road_flood_history(args.out, args.cache, now, opener=opener, first_year=args.first_year)
        print(json.dumps({"roads": len(history.roads), "sources": [
            {"source_id": s.source_id, "reports": s.reports, "without_place": s.reports_without_place,
             "rejected": s.rejected, "period": [str(s.period_from), str(s.period_to)]} for s in history.sources]},
            ensure_ascii=False))
        return 0
    if args.command == "rain-forecast":
        now = datetime.fromisoformat(args.now) if args.now else datetime.now(UTC)
        if args.fixtures:
            from fontokmai.examples import forecast_fixture_run
            forecast = forecast_fixture_run(args.out, args.fixtures, now)
        elif args.db:
            from fontokmai.state import StateStore
            with StateStore(args.db) as store:
                calls = forecast_budget(store)
                forecast = build_rain_forecast(args.out, now, spend=lambda n: calls.spend(now, n))
        else:
            forecast = build_rain_forecast(args.out, now)
        print(json.dumps({"points": len(forecast.points), "hours": len(forecast.hours), "days": len(forecast.days),
                          "first_hour": forecast.hours[0].isoformat()}, ensure_ascii=False))
        return 0
    if args.command == "dxs-probe":
        from fontokmai.sources import bma_dxs
        params = dict(item.split("=", 1) for item in args.param)
        answer = bma_dxs.call(args.operation, bma_dxs.load_account(args.account), params)
        print("\n".join(bma_dxs.outline(answer)))
        return 0
    if args.command == "schedule":
        run_forever(_scheduled_job(args), max_rounds=args.max_rounds)
        return 0
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(UTC)
    if now.tzinfo is None:
        raise SystemExit("--now needs a UTC offset, e.g. 2026-09-25T18:20:00+07:00")
    fetch = fixture_fetcher(args.fixtures) if args.fixtures else LiveFetcher()
    try:
        radar_fetch = LiveFetcher() if args.radar else None
        floods = fixture_opener({LONGDO_FEED_URL: args.floods}) if args.floods else None
        result = run_cap_snapshot(db=args.db, out=args.out, fetch=fetch, now=now, writer=args.writer,
                                  owner_epoch=args.owner_epoch, radar_fetch=radar_fetch, floods_opener=floods)
    finally:
        close = getattr(fetch, "close", None)
        if close is not None:
            close()
    print(json.dumps(_summary(result), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
