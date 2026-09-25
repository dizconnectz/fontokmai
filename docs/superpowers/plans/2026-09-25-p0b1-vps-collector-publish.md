# P0-B1: ตัวเก็บ TMD CAP บน VPS ทุก 15 นาที + เผยแพร่ไฟล์ข้อมูล (dev host) — แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ VPS รัน slice TMD CAP ทุก 15 นาทีใน Docker และเผยแพร่ snapshot `/data/v1` ไปที่ static host ช่วงพัฒนา (GitHub Pages ของ repo `fontokmai-data`) เพื่อให้หน้าเว็บของ Codex อ่านข้อมูลจริงได้

**Architecture:** เพิ่ม `schedule` (ตาราง :03/:18/:33/:48 ตามข้อ 4.3) และ `publish/git_pages.py` ที่แทนที่ branch `gh-pages` ด้วย orphan commit เดียวต่อรอบ (สลับทั้งชุด ไม่สะสมประวัติ) ผ่าน deploy key ที่มีสิทธิ์เฉพาะ repo ข้อมูล · container รันด้วย uid ของผู้ใช้ (ไม่ใช่ root) จำกัด CPU 0.5 / RAM 512 MB และหมุน log · Cloudflare Pages ยังเป็น host หลักตามแบบ (ย้ายได้โดยเปลี่ยน `DATA_BASE_URL`) · takeover/restore, ตัวตรวจจากนอกเครื่อง และ systemd slice อยู่ใน P0-B2

**Tech Stack:** Python 3.13 + uv, Docker 29 / Compose v5 บน VPS, git + OpenSSH, GitHub Pages (branch)

**อ้างอิง:** design v6.1 ข้อ 3 (P0 ลำดับที่ 7–8), 4.3, 4.4 (ข้อ 2, 3, 11), 4.9 · AGENTS.md A4 (git), C2

---

### Task 1: ตารางเวลา 15 นาที

**Files:** Create `pipeline/src/fontokmai/schedule.py`, Test `pipeline/tests/test_schedule.py`

- [ ] **Step 1: failing test**

```python
# file: pipeline/tests/test_schedule.py
from datetime import datetime, timedelta

from fontokmai.schedule import next_slot, run_forever

T = datetime.fromisoformat


def test_next_slot_is_strictly_after_now():
    assert next_slot(T("2026-09-25T12:00:00+00:00")) == T("2026-09-25T12:03:00+00:00")
    assert next_slot(T("2026-09-25T12:03:00+00:00")) == T("2026-09-25T12:18:00+00:00")
    assert next_slot(T("2026-09-25T12:50:00+00:00")) == T("2026-09-25T13:03:00+00:00")
    assert next_slot(T("2026-09-25T23:59:30+00:00")) == T("2026-09-26T00:03:00+00:00")
    assert next_slot(T("2026-09-25T19:40:00+07:00")) == T("2026-09-25T12:48:00+00:00")


class FakeClock:
    def __init__(self, start):
        self.now = start

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += timedelta(seconds=seconds)


def test_run_forever_runs_on_slots_and_survives_failures():
    clock = FakeClock(T("2026-09-25T12:00:00+00:00"))
    calls, logs = [], []

    def job(started):
        calls.append(started)
        if len(calls) == 1:
            raise RuntimeError("source down")
        return {"alerts": 3}

    run_forever(job, clock=clock, sleep=clock.sleep, log=logs.append, max_rounds=2)
    assert calls == [T("2026-09-25T12:03:00+00:00"), T("2026-09-25T12:18:00+00:00")]
    assert '"ok": false' in logs[0] and "RuntimeError: source down" in logs[0]
    assert '"ok": true' in logs[1] and '"alerts": 3' in logs[1]
```

- [ ] **Step 2: Run** `uv run pytest tests/test_schedule.py` · Expected: FAIL (module not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/schedule.py
"""Run a job on the fixed 15-minute grid of design 4.3: :03, :18, :33 and :48 past each hour (same in UTC and ICT)."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

SLOT_MINUTES = (3, 18, 33, 48)


def next_slot(now: datetime) -> datetime:
    """First slot strictly after `now`, in UTC."""
    now = now.astimezone(UTC)
    hour = now.replace(minute=0, second=0, microsecond=0)
    for offset in (timedelta(0), timedelta(hours=1)):
        for minute in SLOT_MINUTES:
            slot = hour + offset + timedelta(minutes=minute)
            if slot > now:
                return slot
    raise AssertionError("a slot always exists within two hours")


def _utc_now() -> datetime:
    return datetime.now(UTC)


def run_forever(job: Callable[[datetime], dict[str, Any]], *, clock: Callable[[], datetime] = _utc_now,
                sleep: Callable[[float], None] = time.sleep, log: Callable[[str], None] = print,
                max_rounds: int | None = None) -> None:
    """Sleep until each slot and run the job. A failing round is logged and the schedule continues,
    because a stopped scheduler is worse than one failed round (stale data stays visible on the web)."""
    rounds = 0
    while max_rounds is None or rounds < max_rounds:
        slot = next_slot(clock())
        delay = (slot - clock()).total_seconds()
        if delay > 0:
            sleep(delay)
        started = clock()
        record: dict[str, Any] = {"slot": slot.isoformat(), "started": started.isoformat()}
        try:
            record.update(ok=True, **job(started))
        except Exception as exc:
            record.update(ok=False, error=f"{type(exc).__name__}: {exc}")
        log(json.dumps(record, ensure_ascii=False))
        rounds += 1
```

- [ ] **Step 4: Run** `uv run pytest tests/test_schedule.py` · Expected: PASS
- [ ] **Step 5: Commit** `feat(schedule): 15-minute slot grid that survives failed rounds`

### Task 2: เผยแพร่ snapshot ไป branch ของ static host

**Files:** Create `pipeline/src/fontokmai/publish/git_pages.py`, Test `pipeline/tests/test_git_pages.py`

- [ ] **Step 1: failing test**

```python
# file: pipeline/tests/test_git_pages.py
import subprocess

import pytest

from fontokmai.publish.git_pages import PublishError, publish_snapshot


def _bare(tmp_path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(bare)], check=True)
    return bare


def _git(bare, *args):
    return subprocess.run(["git", "--git-dir", str(bare), *args], capture_output=True, text=True, check=True).stdout


def _snapshot(tmp_path, manifest):
    src = tmp_path / "out"
    src.mkdir(exist_ok=True)
    (src / "manifest.json").write_text(manifest, encoding="utf-8")
    (src / "alerts.json").write_text("{}", encoding="utf-8")
    (src / ".alerts.json.tmp123").write_text("partial", encoding="utf-8")
    return src


def test_publish_replaces_the_branch_with_one_commit(tmp_path):
    bare = _bare(tmp_path)
    publish_snapshot(_snapshot(tmp_path, '{"g":1}'), tmp_path / "work", str(bare), message="g1")
    commit = publish_snapshot(_snapshot(tmp_path, '{"g":2}'), tmp_path / "work", str(bare), message="g2")
    assert _git(bare, "log", "--format=%H %s", "gh-pages").split() == [commit, "g2"]
    files = _git(bare, "ls-tree", "-r", "--name-only", "gh-pages").split()
    assert files == [".nojekyll", "data/v1/alerts.json", "data/v1/manifest.json", "index.html"]
    assert _git(bare, "show", "gh-pages:data/v1/manifest.json") == '{"g":2}'


def test_refuses_a_snapshot_without_manifest(tmp_path):
    src = tmp_path / "empty"
    src.mkdir()
    with pytest.raises(PublishError, match="no manifest.json"):
        publish_snapshot(src, tmp_path / "work", str(_bare(tmp_path)), message="x")
```

- [ ] **Step 2: Run** `uv run pytest tests/test_git_pages.py` · Expected: FAIL (module not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/publish/git_pages.py
"""Publish a snapshot as a single orphan commit on a static-hosting branch (development host, design 4.4).

Every publish replaces the whole branch, so the site switches as one unit and the repository keeps no
history. GitHub Pages is the development host; the primary host in the design is Cloudflare Pages.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

INDEX_HTML = (
    '<!doctype html>\n<html lang="th">\n<meta charset="utf-8">\n<title>fontokmai data</title>\n'
    "<p>ไฟล์ข้อมูลของ fontokmai (ฝนตกไหม) สำหรับหน้าเว็บ ไม่ใช่หน้าเว็บสำหรับผู้ใช้ ·"
    ' เริ่มที่ <a href="data/v1/manifest.json">data/v1/manifest.json</a></p>\n'
    "<p>ที่มาของประกาศ: กรมอุตุนิยมวิทยา · fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยา</p>\n"
    "</html>\n"
)
COMMITTER = ("fontokmai publisher", "4536990+dizconnectz@users.noreply.github.com")


class PublishError(RuntimeError):
    """The snapshot could not be published."""


def _remove_readonly(func, path, _exc) -> None:
    """git marks object files read-only; Windows cannot delete them until they are writable."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _git(cwd: Path, *args: str, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise PublishError(f"git {args[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def publish_snapshot(src: Path, work: Path, remote: str, *, message: str, branch: str = "gh-pages",
                     ssh_command: str | None = None) -> str:
    """Replace `branch` on `remote` with exactly the files of `src` under data/v1/; returns the commit id."""
    if not (src / "manifest.json").is_file():
        raise PublishError(f"{src} has no manifest.json; refusing to publish an incomplete snapshot")
    env = dict(os.environ)
    if ssh_command:
        env["GIT_SSH_COMMAND"] = ssh_command
    if work.exists():
        shutil.rmtree(work, onexc=_remove_readonly)
    shutil.copytree(src, work / "data" / "v1", ignore=shutil.ignore_patterns(".*"))
    (work / ".nojekyll").write_text("", encoding="utf-8")
    (work / "index.html").write_text(INDEX_HTML, encoding="utf-8", newline="\n")
    name, email = COMMITTER
    _git(work, "init", "-q", "-b", branch)
    _git(work, "config", "core.autocrlf", "false")
    _git(work, "add", "-A")
    _git(work, "-c", f"user.name={name}", "-c", f"user.email={email}", "-c", "commit.gpgsign=false",
         "commit", "-q", "-m", message)
    _git(work, "push", "-q", "--force", remote, f"HEAD:refs/heads/{branch}", env=env)
    return _git(work, "rev-parse", "HEAD")
```

- [ ] **Step 4: Run** `uv run pytest tests/test_git_pages.py` · Expected: PASS
- [ ] **Step 5: Commit** `feat(publish): replace a static-hosting branch with one orphan commit per snapshot`

### Task 3: คำสั่ง `schedule`

**Files:** Modify `pipeline/src/fontokmai/cli.py`, Test `pipeline/tests/test_cli.py`

- [ ] **Step 1: failing test** (ต่อท้าย `tests/test_cli.py`)

```python
def test_schedule_requires_a_work_dir_when_publishing(tmp_path):
    with pytest.raises(SystemExit):
        main(["schedule", "--db", str(tmp_path / "s.db"), "--out", str(tmp_path / "v1"),
              "--publish-remote", "git@github.com:dizconnectz/fontokmai-data.git"])


def test_ssh_command_pins_key_and_known_hosts(tmp_path):
    cmd = ssh_command(tmp_path / "deploy key", tmp_path / "known_hosts")
    assert "-o IdentitiesOnly=yes" in cmd and "-o StrictHostKeyChecking=yes" in cmd
    assert "'" + str(tmp_path / "deploy key") + "'" in cmd
```

- [ ] **Step 2: Run** `uv run pytest tests/test_cli.py` · Expected: FAIL (`ssh_command` import)

- [ ] **Step 3: implementation** — subcommand `schedule` และ `ssh_command()` · job แต่ละรอบรัน `run_cap_snapshot` ด้วย `LiveFetcher` แล้วถ้ามี `--publish-remote` ให้ `publish_snapshot(..., message=generation_id)`

```python
# file: pipeline/src/fontokmai/cli.py
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
```

```python
# file: pipeline/tests/test_cli.py
import json

import pytest

from fontokmai.cli import main, ssh_command
from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.manifest import Manifest
from helpers import FIXTURES


def test_cap_snapshot_from_fixtures(tmp_path, capsys):
    args = ["cap-snapshot", "--db", str(tmp_path / "state.db"), "--out", str(tmp_path / "v1"),
            "--fixtures", str(FIXTURES), "--now", "2026-09-25T18:20:00+07:00"]
    assert main(args) == 0
    summary = json.loads(capsys.readouterr().out)
    assert (summary["alerts"], summary["tombstones"], summary["source_status"]) == (3, 6, "ok")
    feed = AlertsFeed.model_validate_json((tmp_path / "v1" / "alerts.json").read_bytes())
    manifest = Manifest.model_validate_json((tmp_path / "v1" / "manifest.json").read_bytes())
    assert feed.generation_id == manifest.generation_id == "20260925T112000Z-local"
    assert (manifest.files[0].path, manifest.completeness) == ("alerts.json", "complete")
    assert main(args) == 0
    assert json.loads(capsys.readouterr().out)["feed_sequence"] == summary["feed_sequence"] == 1


def test_export_schemas_command(tmp_path, capsys):
    assert main(["export-schemas", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "alerts.schema.json").is_file()


def test_schedule_requires_a_work_dir_when_publishing(tmp_path):
    with pytest.raises(SystemExit):
        main(["schedule", "--db", str(tmp_path / "s.db"), "--out", str(tmp_path / "v1"),
              "--publish-remote", "git@github.com:dizconnectz/fontokmai-data.git"])


def test_ssh_command_pins_key_and_known_hosts(tmp_path):
    cmd = ssh_command(tmp_path / "deploy key", tmp_path / "known_hosts")
    assert "-o IdentitiesOnly=yes" in cmd and "-o StrictHostKeyChecking=yes" in cmd
    assert "'" + str(tmp_path / "deploy key") + "'" in cmd
```

- [ ] **Step 4: Run** `uv run pytest` · Expected: PASS ทั้งหมด
- [ ] **Step 5: Commit** `feat(cli): schedule command with optional publishing`

### Task 4: Docker และชุดติดตั้งบน VPS

**Files:** Create `pipeline/Dockerfile`, `pipeline/.dockerignore`, `deploy/vps/compose.yaml`, `deploy/vps/.env.example`, `deploy/vps/github_known_hosts` (จาก `gh api meta` ตรวจ fingerprint กับค่าที่ GitHub ประกาศ), `deploy/vps/README.md` · Modify `.github/workflows/ci.yml` (job `docker`)

```dockerfile
# file: pipeline/Dockerfile
# fontokmai pipeline image: built and run on the VPS, not published to a registry
FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" HOME=/tmp
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev
ENTRYPOINT ["fontokmai"]
```

```text
# file: pipeline/.dockerignore
.venv
**/__pycache__
.pytest_cache
.ruff_cache
tests
```

```yaml
# file: deploy/vps/compose.yaml
# fontokmai on the VPS (design 4.3, 4.9). Values come from deploy/vps/.env, which is never committed.
name: fontokmai
services:
  cap-collector:
    build:
      context: ../../pipeline
    image: fontokmai-pipeline:local
    user: "${FONTOKMAI_UID}:${FONTOKMAI_GID}"
    command:
      - schedule
      - --db=/var/lib/fontokmai/state/fontokmai.db
      - --out=/var/lib/fontokmai/out/data/v1
      - --writer=vps
      - --owner-epoch=${OWNER_EPOCH:-1}
      - --publish-remote=${PUBLISH_REMOTE:-}
      - --publish-work=/var/lib/fontokmai/pages
      - --ssh-key=/run/secrets/deploy_key
      - --known-hosts=/etc/fontokmai/github_known_hosts
    volumes:
      - ${FONTOKMAI_VAR}:/var/lib/fontokmai
      - ${DEPLOY_KEY}:/run/secrets/deploy_key:ro
      - ./github_known_hosts:/etc/fontokmai/github_known_hosts:ro
    restart: unless-stopped
    cpus: 0.5
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 128
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
```

```text
# file: deploy/vps/.env.example
# Copy to deploy/vps/.env on the VPS and fill in. Never commit .env.
FONTOKMAI_UID=1000
FONTOKMAI_GID=1000
FONTOKMAI_VAR=/home/USER/fontokmai/var
DEPLOY_KEY=/home/USER/fontokmai/secrets/deploy_key
# empty = collect only; set to git@github.com:dizconnectz/fontokmai-data.git to publish
PUBLISH_REMOTE=
OWNER_EPOCH=1
```

- [ ] CI job `docker`: `docker build -t fontokmai-pipeline:ci pipeline` แล้ว `docker run --rm fontokmai-pipeline:ci --help`
- [ ] README ของ `deploy/vps/` เป็น runbook ภาษาไทย: ติดตั้ง, อัปเดต, ดู log, หยุด, ถอนสิทธิ์เผยแพร่ และสิ่งที่ยังไม่รองรับ (takeover/restore = P0-B2)
- [ ] Commit `feat(deploy): docker image, compose project and VPS runbook`

### Task 5: ติดตั้งบน VPS (เก็บอย่างเดียวก่อน)

- [ ] clone repo ไป `~/fontokmai/app`, สร้าง `~/fontokmai/var/{state,out,pages}` และ `~/fontokmai/secrets/`, สร้าง deploy key (`ssh-keygen -t ed25519 -N ""`), เขียน `.env` จาก `.env.example` (ยังไม่ตั้ง `PUBLISH_REMOTE`)
- [ ] `docker compose -f deploy/vps/compose.yaml build` แล้วรัน `cap-snapshot` หนึ่งรอบใน container · Expected: `source_status` เป็น `ok` (ยืนยันว่าใบกลางที่แนบใช้ได้บน Linux)
- [ ] `docker compose ... up -d` แล้วดู log หนึ่งรอบตามตาราง และ `docker stats` ว่าอยู่ในเพดาน · ไม่แตะงานเดิมบนเครื่อง

### Task 6: repo ข้อมูลและ GitHub Pages (ต้องได้อนุญาตจากผู้ใช้ก่อน เพราะเป็นการเผยแพร่ใหม่)

- [ ] `gh repo create dizconnectz/fontokmai-data --public` · เพิ่ม deploy key ของ VPS แบบเขียนได้เฉพาะ repo นี้ · ตั้ง `PUBLISH_REMOTE` แล้ว restart · เปิด Pages จาก branch `gh-pages`
- [ ] ตรวจ `https://dizconnectz.github.io/fontokmai-data/data/v1/manifest.json` ได้ 200, มี CORS `*`, `generation_id` ตรงกับ `alerts.json`
- [ ] แก้ `contracts/v1/README.md` ให้ระบุ `DATA_BASE_URL` ของช่วงพัฒนา และให้ต่อท้าย manifest ด้วย `?t=<เวลา>` เพื่อข้าม cache ของ CDN

### Task 7: ส่งต่องาน

- [ ] AGENTS.md: บันทึก A6 (URL ข้อมูล, ผลตรวจจริง, ข้อจำกัด), C2 ให้ Codex ใช้ `DATA_BASE_URL` · design 4.4 ข้อ 11 ระบุ dev host จริง · commit + push และดู CI
