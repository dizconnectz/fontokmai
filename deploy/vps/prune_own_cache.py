#!/usr/bin/env python3
"""Remove fontokmai's own leftovers from Docker on the VPS: old build cache and old images of the pipeline.

The machine is shared with other work (deploy/vps/README.md). Nothing here selects a record or an image unless it is
unmistakably fontokmai's:
- a build cache record whose description names fontokmai (the stages of pipeline/Dockerfile are fontokmai-build and
  fontokmai, and each RUN ends with "# fontokmai"), or one built on top of such a record (its Parents);
- a dangling image whose entrypoint is ["fontokmai"].
Records that the latest build used (last used within KEEP_SECONDS) stay, so that the next deploy is still quick, and
so does every record something that stays is built on: BuildKit removes a record only after every record built on it.
The layer a RUN leaves is a mutable record; until 2026-10-02 those were skipped, and with them the whole chain under
each one stayed (45 records, 572 MB, about 60 MB more after each deploy).

Usage: python3 prune_own_cache.py [--dry-run] [--only ID] [--keep-minutes N]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys

KEEP_SECONDS = 2 * 3600
UNITS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 7 * 86400, "month": 30 * 86400,
         "year": 365 * 86400}


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def seconds_ago(text: str) -> float:
    """Docker's relative time ("46 seconds ago", "About an hour ago", "2 days ago") in seconds; unknown = old."""
    text = text.lower().replace("about ", "").replace("less than a second", "0 seconds")
    match = re.match(r"(an?|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago", text)
    if not match:
        return float("inf")
    count = 1 if match.group(1) in ("a", "an") else int(match.group(1))
    return count * UNITS[match.group(2)]


def size_bytes(text: str | None) -> float:
    match = re.match(r"([\d.]+)\s*([kMGT]?B)", text or "")
    return float(match.group(1)) * {"B": 1, "kB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12}[match.group(2)] if match else 0


def own_records() -> list[dict]:
    rows = [json.loads(line) for line in run("docker", "buildx", "du", "--format", "json").splitlines() if line.strip()]
    ours = {row["ID"] for row in rows if "fontokmai" in (row.get("Description") or "")}
    grew = True
    while grew:  # everything built on top of a fontokmai record is fontokmai's too
        grew = False
        for row in rows:
            if row["ID"] not in ours and set(row.get("Parents") or []) & ours:
                ours.add(row["ID"])
                grew = True
    return [row for row in rows if row["ID"] in ours]


def removable(records: list[dict], keep: float, only: str | None = None) -> list[dict]:
    """The records that can go: reclaimable (no build or image holds them), not used within `keep` seconds, and
    nothing that stays is built on them."""
    chosen = {r["ID"]: r for r in records if r.get("Reclaimable") and seconds_ago(r.get("LastUsedAt", "")) > keep
              and (only is None or r["ID"] == only)}
    children: dict[str, set[str]] = {}
    for record in records:
        for parent in record.get("Parents") or []:
            children.setdefault(parent, set()).add(record["ID"])
    dropped = True
    while dropped:  # a record with a child that stays cannot go, nor can what it is built on
        dropped = False
        for record_id in list(chosen):
            if children.get(record_id, set()) - chosen.keys():
                del chosen[record_id]
                dropped = True
    return list(chosen.values())


def megabytes(records: list[dict]) -> float:
    return sum(size_bytes(r.get("Size")) for r in records) / 1e6


def leaves_first(records: list[dict]) -> list[dict]:
    """Records ordered so that one is removed only after every record built on it."""
    left = {r["ID"]: r for r in records}
    ordered = []
    while left:
        parents = {p for r in left.values() for p in (r.get("Parents") or [])}
        leaves = [r for i, r in left.items() if i not in parents] or list(left.values())
        for record in leaves:
            ordered.append(record)
            left.pop(record["ID"])
    return ordered


def own_dangling_images() -> list[str]:
    found = []
    for image in run("docker", "images", "-q", "--filter", "dangling=true").split():
        entrypoint = run("docker", "image", "inspect", "--format", "{{json .Config.Entrypoint}}", image).strip()
        if entrypoint == '["fontokmai"]':
            found.append(image)
    return found


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    keep = int(argv[argv.index("--keep-minutes") + 1]) * 60 if "--keep-minutes" in argv else KEEP_SECONDS
    records = own_records()
    old = removable(records, keep, only)
    print(f"fontokmai build cache: {len(records)} records ({megabytes(records):.0f} MB), {len(old)} can go: not used"
          f" in the last {keep // 60} min and nothing kept built on them ({megabytes(old):.0f} MB)"
          + (" · dry run" if dry else ""))
    if not dry and old:
        for record in leaves_first(old):
            run("docker", "buildx", "prune", "-f", "--filter", f"id={record['ID']}")
        left = own_records()
        print(f"fontokmai build cache now: {len(left)} records ({megabytes(left):.0f} MB)")
    images = own_dangling_images()
    print(f"old fontokmai images: {len(images)}")
    if not dry and only is None:
        for image in images:
            run("docker", "image", "rm", image)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
