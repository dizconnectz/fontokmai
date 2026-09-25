"""Command line: `fontokmai export-schemas`, `fontokmai cap-snapshot`, `fontokmai contract-examples`."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from fontokmai.contracts.export import export_schemas
from fontokmai.examples import write_examples
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import LiveFetcher, fixture_fetcher


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
    return parser.parse_args(argv)


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
    print(json.dumps({"generation_id": result.manifest.generation_id, "feed_sequence": result.feed.feed_sequence,
                      "alerts": len(result.feed.alerts), "tombstones": len(result.feed.tombstones),
                      "source_status": result.status.status}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
