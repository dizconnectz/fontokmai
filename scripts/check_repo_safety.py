#!/usr/bin/env python3
"""Fail when tracked files contain secrets, unexpected IPv4 addresses, private paths or an oversized AGENTS.md.

`private/denylist.txt` (never committed) adds machine-specific words when the check runs locally.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_AGENTS_BYTES = 32 * 1024
SECRET_PATTERNS = {
    "JWT": re.compile(rb"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\."),
    "private key": re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "GitHub token": re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{30,}"),
}
IPV4 = re.compile(rb"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
FORBIDDEN_PREFIXES = ("private/", ".claude/", "state/", "out/")
FORBIDDEN_SUFFIXES = (".db", ".db-wal", ".db-shm")
SKIP_IP_CHECK = ("pipeline/uv.lock",)


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def load_values(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    values = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.split("#", 1)[0].strip()
        if value:
            values.add(value)
    return values


def main() -> int:
    problems: list[str] = []
    allowed_ips = load_values(ROOT / "scripts" / "ip_allowlist.txt")
    denied_words = [w.lower() for w in load_values(ROOT / "private" / "denylist.txt")]
    for rel in tracked_files():
        name = Path(rel).name
        if rel.startswith(FORBIDDEN_PREFIXES) or rel.endswith(FORBIDDEN_SUFFIXES) or name == ".env":
            problems.append(f"{rel}: must not be tracked")
            continue
        path = ROOT / rel
        if not path.is_file():
            continue
        data = path.read_bytes()
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(data):
                problems.append(f"{rel}: looks like a {label}")
        if rel not in SKIP_IP_CHECK and "/fixtures/" not in rel:
            for ip in sorted({m.decode() for m in IPV4.findall(data)} - allowed_ips):
                problems.append(f"{rel}: IPv4 {ip} is not in scripts/ip_allowlist.txt")
        text = data.decode("utf-8", "ignore").lower()
        if any(word in text for word in denied_words):
            problems.append(f"{rel}: contains a word from private/denylist.txt")
    agents = ROOT / "AGENTS.md"
    if agents.is_file() and agents.stat().st_size > MAX_AGENTS_BYTES:
        problems.append(f"AGENTS.md is {agents.stat().st_size} bytes (limit {MAX_AGENTS_BYTES})")
    for problem in problems:
        print(problem)
    print("repo safety: OK" if not problems else f"repo safety: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
