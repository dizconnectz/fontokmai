"""Command line: export-schemas, contract-examples, cap-snapshot and schedule."""

from __future__ import annotations

import argparse
import json
import shlex
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fontokmai.contracts.export import export_schemas
from fontokmai.examples import write_examples
from fontokmai.publish.git_pages import publish_snapshot
from fontokmai.run import SnapshotResult, run_cap_snapshot
from fontokmai.schedule import run_forever
from fontokmai.sources.tmd_cap.fetch import LiveFetcher, fixture_fetcher


def ssh_command(key: Path, known_hosts: Path) -> str:
    """ssh for git: only the given deploy key, and only the pinned host keys."""
    return " ".join([
        "ssh", "-i", shlex.quote(str(key)), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={shlex.quote(str(known_hosts))}",
    ])


def _summary(result: SnapshotResult) -> dict[str, Any]:
    return {"generation_id": result.manifest.generation_id, "feed_sequence": result.feed.feed_sequence,
            "alerts": len(result.feed.alerts), "tombstones": len(result.feed.tombstones),
            "source_status": result.status.status}


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="fontokmai")
    sub = parser.add_subparsers(dest="command", required=True)
    schemas = sub.add_parser("export-schemas", help="write JSON Schemas of the public contract")
    schemas.add_argument("--out", type=Path, required=True)
    examples = sub.add_parser("contract-examples", help="write example snapshots with expected consumer results")
    examples.add_argument("--out", type=Path, required=True)
    examples.add_argument("--real-fixtures", type=Path, required=True)
    examples.add_argument("--synthetic-fixtures", type=Path, required=True)
    cap = sub.add_parser("cap-snapshot", help="collect TMD CAP alerts and write a /data/v1 snapshot")
    cap.add_argument("--db", type=Path, required=True, help="SQLite state file")
    cap.add_argument("--out", type=Path, required=True, help="snapshot directory")
    cap.add_argument("--fixtures", type=Path, help="read the feed from a local directory instead of the network")
    cap.add_argument("--now", help="evaluation time, ISO 8601 with offset (default: current time)")
    cap.add_argument("--writer", default="local")
    cap.add_argument("--owner-epoch", type=int, default=1)
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
    sched.add_argument("--max-rounds", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.command == "schedule" and args.publish_remote and args.publish_work is None:
        parser.error("--publish-remote needs --publish-work")
    return args


def _scheduled_job(args: argparse.Namespace) -> Callable[[datetime], dict[str, Any]]:
    ssh = ssh_command(args.ssh_key, args.known_hosts) if args.ssh_key and args.known_hosts else None

    def job(now: datetime) -> dict[str, Any]:
        fetch = LiveFetcher()
        try:
            result = run_cap_snapshot(db=args.db, out=args.out, fetch=fetch, now=now, writer=args.writer,
                                      owner_epoch=args.owner_epoch)
        finally:
            fetch.close()
        summary = _summary(result)
        if args.publish_remote:
            commit = publish_snapshot(args.out, args.publish_work, args.publish_remote,
                                      message=result.manifest.generation_id, ssh_command=ssh)
            summary["published"] = commit[:12]
        return summary

    return job


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.command == "export-schemas":
        for path in export_schemas(args.out):
            print(path.as_posix())
        return 0
    if args.command == "contract-examples":
        for path in write_examples(args.out, real=args.real_fixtures, synthetic=args.synthetic_fixtures):
            print(path.as_posix())
        return 0
    if args.command == "schedule":
        run_forever(_scheduled_job(args), max_rounds=args.max_rounds)
        return 0
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(UTC)
    if now.tzinfo is None:
        raise SystemExit("--now needs a UTC offset, e.g. 2026-09-25T18:20:00+07:00")
    fetch = fixture_fetcher(args.fixtures) if args.fixtures else LiveFetcher()
    try:
        result = run_cap_snapshot(db=args.db, out=args.out, fetch=fetch, now=now, writer=args.writer,
                                  owner_epoch=args.owner_epoch)
    finally:
        close = getattr(fetch, "close", None)
        if close is not None:
            close()
    print(json.dumps(_summary(result), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
