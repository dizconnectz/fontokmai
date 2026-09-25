# P0-A: ฐาน repo + สัญญาข้อมูลขั้นต่ำ + TMD CAP vertical slice — แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง repo สาธารณะที่สะอาด (ประวัติเต็มแยกไป private repo), สัญญาข้อมูลขั้นต่ำที่ Codex ใช้เริ่มหน้าเว็บได้ และตัวเก็บประกาศ TMD CAP ที่ทดสอบได้ครบ ตั้งแต่ดึงข้อมูลจนเขียน snapshot `/data/v1` บนเครื่องนี้

**Architecture:** Python package `fontokmai` (ใน `pipeline/`) มี Pydantic contract เป็นต้นทาง → JSON Schema → TypeScript types (`contracts/v1/`) · collector ดึง RSS index ของ CAP แล้วตามลิงก์ไป XML รายฉบับ เก็บเอกสารดิบใน SQLite, จัดกลุ่มเป็นเหตุ (event lineage) ตาม `references`, คำนวณ lifecycle ณ เวลา `now` แล้วเขียน `alerts.json` กับ `manifest.json` แบบ atomic (manifest เขียนท้ายสุด) · revision/feed_sequence เพิ่มเฉพาะเมื่อเนื้อหาเปลี่ยน · ยังไม่ deploy และยังไม่ติดตั้งบน VPS (อยู่ในแผน P0-B)

**Tech Stack:** Python 3.13 + uv, Pydantic 2 (MIT), httpx (BSD-3), pytest (MIT), ruff (MIT), hatchling (MIT), json-schema-to-typescript 16 (MIT, รันผ่าน npx), GitHub Actions

**อ้างอิง:** design v6 ข้อ 3 (P0 ลำดับที่ 2–4), 4.4–4.6, 9.1–9.2 · รีวิว v6 ของ Codex หัวข้อ 3 (สัญญาขั้นต่ำ) และ F1/F4/F5

---

## โครงไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `.gitignore`, `.gitattributes` | กันไฟล์ private/secret/state และคง byte ของ fixtures |
| `README.md` | แนะนำ repo, license, ข้อความไม่เกี่ยวข้องกับหน่วยงาน |
| `scripts/check_repo_safety.py`, `scripts/ip_allowlist.txt` | ตรวจ secret, IP, path ต้องห้าม, ขนาด AGENTS.md (และคำต้องห้ามจาก `private/denylist.txt` เมื่อรันในเครื่อง) |
| `scripts/gen-ts-types.sh` | JSON Schema → TypeScript |
| `.github/workflows/ci.yml` | lint, test, drift ของ contract, license ของ dependency, repo safety |
| `pipeline/pyproject.toml` | โปรเจกต์ Python (uv) |
| `pipeline/src/fontokmai/contracts/{common,alerts,manifest,export}.py` | สัญญาข้อมูล + export schema |
| `pipeline/src/fontokmai/sources/tmd_cap/{index,parser,lifecycle,fetch,collect}.py` | ตัวเก็บ TMD CAP |
| `pipeline/src/fontokmai/state.py` | SQLite: เอกสารดิบ, revision, meta |
| `pipeline/src/fontokmai/feeds/alerts.py` | ประกอบ `alerts.json` แบบไม่ผูกกับแหล่ง |
| `pipeline/src/fontokmai/publish/snapshot.py` | เขียนไฟล์ข้อมูลแล้วเขียน manifest ท้ายสุด |
| `pipeline/src/fontokmai/run.py` | หนึ่งรอบของ slice (ใช้ร่วมกันระหว่าง CLI กับตัวอย่าง) |
| `pipeline/src/fontokmai/examples.py` | สร้างตัวอย่าง snapshot + ผลที่คาดหมายให้ consumer |
| `pipeline/src/fontokmai/cli.py` | `export-schemas`, `cap-snapshot`, `contract-examples` |
| `pipeline/tests/...` | tests + fixtures จริง 13 ฉบับ + fixtures สังเคราะห์ |
| `contracts/v1/{schema,ts,examples}/`, `contracts/v1/README.md` | สิ่งที่ส่งให้ Codex (generated + ความหมาย) |

---

### Task 1: แยกประวัติไป private และตั้ง git

**Files:**
- Move: `docs/handoffs/` → `private/handoffs/`
- Modify: `AGENTS.md`, `CLAUDE.md`, `docs/design/fontokmai-design.md` (path `docs/handoffs/` → `private/handoffs/`, ตัดรายละเอียดเครื่อง)
- Create: `private/denylist.txt`, `.gitignore`, `.gitattributes`, `scripts/check_repo_safety.py`, `scripts/ip_allowlist.txt`

- [ ] **Step 1: ย้ายประวัติและแก้ path** — `mv docs/handoffs private/handoffs` แล้วแทน `docs/handoffs/` ด้วย `private/handoffs/` ใน AGENTS.md, CLAUDE.md และ design พร้อมระบุว่าเป็น private repo · แทนชื่องานเดิมบนเครื่องใน AGENTS.md ด้วย “งานเดิมบนเครื่อง”

- [ ] **Step 2: คำต้องห้ามแบบ private** — เขียน `private/denylist.txt` (บรรทัดละคำ เช่น ชื่องานเดิมบนเครื่องและ hostname ของ VPS) ไฟล์นี้อยู่ใน private repo เท่านั้น และห้ามคัดลอกคำเหล่านี้มาไว้ในเอกสารสาธารณะ รวมถึงแผนนี้

- [ ] **Step 3: ignore และ attributes**

```gitignore
# file: .gitignore
# private material (history, machine notes, backups) lives in a separate private repo
private/
.env
.env.*
!.env.example
.claude/
# python
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
# runtime state and output
state/
out/
*.db
*.db-wal
*.db-shm
# web (later)
node_modules/
dist/
```

```gitattributes
# file: .gitattributes
* text=auto eol=lf
# real source documents are kept byte-for-byte (BOM, CRLF, signatures)
pipeline/tests/fixtures/** -text
```

- [ ] **Step 4: ตัวตรวจความปลอดภัยของ repo**

```text
# file: scripts/ip_allowlist.txt
# IPv4 addresses allowed in tracked files: value, then optional comment
101.109.253.60  # third-party public camera page listed in docs/sources.md (not the user's machine)
```

```python
# file: scripts/check_repo_safety.py
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
```

- [ ] **Step 5: private repo และ repo หลัก**

```bash
git -C private init -b main && git -C private add -A && git -C private commit -m "Private history and machine notes"
git init -b main
git config user.email "4536990+dizconnectz@users.noreply.github.com"
git add .gitignore .gitattributes scripts LICENSE NOTICE AGENTS.md CLAUDE.md docs
python scripts/check_repo_safety.py
```
Expected: `repo safety: OK` (ถ้าไม่ผ่าน ให้แก้ไฟล์ก่อน commit) แล้วจึง commit ข้อความ `chore: initial public docs, license and repo safety check` (ใส่บรรทัด Co-Authored-By)

### Task 2: โครง Python project

**Files:** Create `pipeline/pyproject.toml`, `pipeline/.python-version` (`3.13`), `pipeline/src/fontokmai/__init__.py` และ `__init__.py` ของ `contracts`, `sources`, `sources/tmd_cap`, `feeds`, `publish`

- [ ] **Step 1: pyproject**

```toml
# file: pipeline/pyproject.toml
[project]
name = "fontokmai-pipeline"
version = "0.1.0"
description = "fontokmai data pipeline: source collectors, public data contract and snapshot publisher"
requires-python = ">=3.12"
license = "PolyForm-Noncommercial-1.0.0"
dependencies = [
    "certifi>=2024.2.2",
    "httpx>=0.27",
    "pydantic>=2.8",
]

[project.scripts]
fontokmai = "fontokmai.cli:main"

[dependency-groups]
dev = [
    "pytest>=8",
    "ruff>=0.6",
]

[build-system]
requires = ["hatchling>=1.27"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/fontokmai"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"

[tool.ruff]
line-length = 120
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.ruff.lint.isort]
known-first-party = ["fontokmai", "helpers"]
```

- [ ] **Step 2: package markers**

```python
# file: pipeline/src/fontokmai/__init__.py
"""fontokmai (ฝนตกไหม) data pipeline."""

__version__ = "0.1.0"
```

```python
# file: pipeline/src/fontokmai/contracts/__init__.py
"""Public data contract (/data/v1): Pydantic models are the source; JSON Schema and TypeScript are generated."""
```

```python
# file: pipeline/src/fontokmai/sources/__init__.py
"""Source collectors."""
```

```python
# file: pipeline/src/fontokmai/sources/tmd_cap/__init__.py
"""TMD CAP 1.2 warnings (https://www.tmd.go.th/api/xml/CAP), design section 9.2."""
```

```python
# file: pipeline/src/fontokmai/feeds/__init__.py
"""Source-independent assembly of published feeds."""
```

```python
# file: pipeline/src/fontokmai/publish/__init__.py
"""Snapshot writing: publication means deploying one complete snapshot (design 4.4)."""
```

- [ ] **Step 3: ติดตั้งและตรวจ** — Run: `cd pipeline && uv sync && uv run python -c "import fontokmai; print(fontokmai.__version__)"` · Expected: `0.1.0`
- [ ] **Step 4: Commit** `feat(pipeline): python project skeleton`

### Task 3: สัญญาข้อมูล (alerts, manifest) และ export

**Files:** Create `pipeline/src/fontokmai/contracts/{common,alerts,manifest,export}.py`, Test `pipeline/tests/test_contracts.py`

- [ ] **Step 1: failing test**

```python
# file: pipeline/tests/test_contracts.py
import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.common import GeoMultiPolygon
from fontokmai.contracts.export import export_schemas

NOW = datetime(2026, 9, 25, 11, 20, tzinfo=UTC)


def _feed(**extra):
    return AlertsFeed(generation_id="20260925T112000Z-local", recovery_epoch=1, feed_generated_at=NOW,
                      feed_sequence=1, history_since=NOW, alerts=[], tombstones=[], source_status=[], **extra)


def test_export_schemas_writes_one_file_per_contract(tmp_path):
    written = export_schemas(tmp_path)
    assert sorted(p.name for p in written) == ["alerts.schema.json", "manifest.schema.json"]
    schema = json.loads((tmp_path / "alerts.schema.json").read_text(encoding="utf-8"))
    assert schema["title"] == "AlertsFeed"
    assert "Alert" in schema["$defs"]
    assert schema["additionalProperties"] is False


def test_export_is_deterministic(tmp_path):
    export_schemas(tmp_path / "a")
    export_schemas(tmp_path / "b")
    for name in ("alerts.schema.json", "manifest.schema.json"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


def test_feed_round_trips_and_rejects_unknown_fields():
    feed = _feed()
    assert AlertsFeed.model_validate_json(feed.model_dump_json()) == feed
    with pytest.raises(ValidationError):
        _feed(surprise=True)


def test_positions_must_be_lon_lat_pairs():
    ring = [[100.5, 13.7], [100.6, 13.7], [100.6, 13.8], [100.5, 13.7]]
    GeoMultiPolygon(coordinates=[[ring]])
    with pytest.raises(ValidationError):
        GeoMultiPolygon(coordinates=[[[[100.5, 13.7, 0.0]] * 4]])
```

- [ ] **Step 2: Run** `uv run pytest tests/test_contracts.py` · Expected: FAIL (`ModuleNotFoundError: fontokmai.contracts.alerts`)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/contracts/common.py
"""Shared building blocks of the public data contract published under /data/v1."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

SCHEMA_VERSION: Literal["1"] = "1"

# GeoJSON positions are [longitude, latitude] in WGS84 (RFC 7946).
Position = Annotated[list[float], Field(min_length=2, max_length=2)]
LinearRing = Annotated[list[Position], Field(min_length=4)]


class ContractModel(BaseModel):
    """Base for published models: unknown fields are rejected and instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class GeoMultiPolygon(ContractModel):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[LinearRing]]


class SourceStatus(ContractModel):
    source_id: str
    status: Literal["ok", "degraded", "failed"]
    last_attempt_at: AwareDatetime
    last_success_at: AwareDatetime | None
    items_seen: int = Field(ge=0)
    items_rejected: int = Field(ge=0)
    message: str | None = None
```

```python
# file: pipeline/src/fontokmai/contracts/alerts.py
"""Contract of /data/v1/alerts.json: official alerts with a lifecycle (design section 9)."""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, GeoMultiPolygon, SourceStatus

LifecycleStatus = Literal["pending", "active", "expired", "cancelled"]
EVENT_ID_PATTERN = r"^[a-z0-9_]+:\S+$"


class AlertTarget(ContractModel):
    kind: Literal["province"]
    code: str = Field(pattern=r"^TH-[0-9A-Z]{1,2}$", description="ISO 3166-2 code")


class Alert(ContractModel):
    event_id: str = Field(pattern=EVENT_ID_PATTERN, description="Namespaced id of the event lineage")
    revision: int = Field(ge=1, description="Increases only when the published content of the event changes")
    message_type: Literal["new", "update", "cancel"]
    lifecycle_status: LifecycleStatus
    is_effective: bool
    origin: Literal["official"]
    issuer: str
    source_message_id: str
    supersedes: list[str]
    event: str
    severity: str
    urgency: str
    certainty: str
    headline_th: str | None
    body_th: str | None
    instruction_th: str | None
    area_desc_th: str | None
    sent: AwareDatetime
    effective: AwareDatetime
    onset: AwareDatetime | None
    expires: AwareDatetime
    expires_policy: Literal["source", "default_24h"]
    qc_flags: list[str]
    targets: list[AlertTarget]
    geometry: GeoMultiPolygon | None
    source_url: str
    credit_th: str
    notify_eligible: bool


class AlertTombstone(ContractModel):
    event_id: str = Field(pattern=EVENT_ID_PATTERN)
    revision: int = Field(ge=1)
    lifecycle_status: Literal["expired", "cancelled"]
    ended_at: AwareDatetime


class AlertsFeed(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    generation_id: str = Field(description="Must equal manifest.generation_id; otherwise the files are mixed")
    recovery_epoch: int = Field(ge=1, description="Changes when published state could not be recovered")
    feed_generated_at: AwareDatetime
    feed_sequence: int = Field(ge=1, description="Increases only when alerts or tombstones change")
    history_since: AwareDatetime
    alerts: list[Alert]
    tombstones: list[AlertTombstone]
    source_status: list[SourceStatus]
```

```python
# file: pipeline/src/fontokmai/contracts/manifest.py
"""Contract of /data/v1/manifest.json: one complete snapshot generation (design 4.4 and 4.6)."""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, Field

from fontokmai.contracts.common import SCHEMA_VERSION, ContractModel, SourceStatus


class ManifestFile(ContractModel):
    path: str = Field(description="Path relative to the data base URL (/data/v1/)")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(ge=0)
    revision: int = Field(ge=1, description="Increases only when the file bytes change")


class Manifest(ContractModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    generation_id: str
    generated_at: AwareDatetime
    next_due_at: AwareDatetime
    writer: str
    owner_epoch: int = Field(ge=1)
    recovery_epoch: int = Field(ge=1)
    completeness: Literal["complete", "partial"]
    files: list[ManifestFile]
    source_status: list[SourceStatus]
```

```python
# file: pipeline/src/fontokmai/contracts/export.py
"""Write JSON Schemas of the public contract (Pydantic → JSON Schema → TypeScript)."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.manifest import Manifest

SCHEMAS: dict[str, type[BaseModel]] = {
    "alerts.schema.json": AlertsFeed,
    "manifest.schema.json": Manifest,
}


def export_schemas(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, model in SCHEMAS.items():
        schema = model.model_json_schema(mode="serialization")
        path = out_dir / name
        text = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)
    return written
```

- [ ] **Step 4: Run** `uv run pytest tests/test_contracts.py` · Expected: PASS (4 tests)
- [ ] **Step 5: Commit** `feat(contracts): alerts and manifest contract with JSON Schema export`

### Task 4: fixtures และ RSS index

**Files:** Copy 13 เอกสาร CAP จริง + `index.xml` (ดาวน์โหลด 2026-09-25 18:16 ICT) ไปที่ `pipeline/tests/fixtures/tmd_cap/` พร้อม `README.md` · Create `pipeline/tests/fixtures/tmd_cap_synthetic/` (ข้อความระบุชัดว่าเป็นข้อมูลสังเคราะห์) · Create `pipeline/src/fontokmai/sources/tmd_cap/index.py`, `pipeline/tests/helpers.py`, Test `pipeline/tests/test_tmd_cap_index.py`

- [ ] **Step 1: fixtures สังเคราะห์** (`SYN_A1.xml` = Alert 10:00 ปทุมธานี, `SYN_C1.xml` = Cancel 12:00 ที่อ้าง A1, และ RSS `index_alert.xml`, `index_cancel.xml`, `index_both.xml`)

```xml
<!-- file: pipeline/tests/fixtures/tmd_cap_synthetic/SYN_A1.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>SYN20260925100000_1</identifier>
  <sender>TMD</sender>
  <sent>2026-09-25T10:00:00+07:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>th-TH</language>
    <category>Met</category>
    <event>Heavy Rain</event>
    <urgency>Expected</urgency>
    <severity>Moderate</severity>
    <certainty>Likely</certainty>
    <effective>2026-09-25T10:00:00+07:00</effective>
    <expires>2026-09-26T10:00:00+07:00</expires>
    <senderName>TMD</senderName>
    <headline>ข้อมูลสังเคราะห์สำหรับทดสอบ fontokmai: ฝนตกหนัก (ไม่ใช่ประกาศจริง)</headline>
    <description>ข้อความสังเคราะห์ ไม่ใช่ประกาศของกรมอุตุนิยมวิทยา</description>
    <area>
      <areaDesc>ปทุมธานี</areaDesc>
      <polygon>14.00,100.50 14.00,100.70 14.15,100.70 14.15,100.50 14.00,100.50</polygon>
      <geocode><valueName>ISO3166-2</valueName><value>TH-13</value></geocode>
    </area>
  </info>
</alert>
```

```xml
<!-- file: pipeline/tests/fixtures/tmd_cap_synthetic/SYN_C1.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>SYN20260925120000_1</identifier>
  <sender>TMD</sender>
  <sent>2026-09-25T12:00:00+07:00</sent>
  <status>Actual</status>
  <msgType>Cancel</msgType>
  <scope>Public</scope>
  <references>TMD,SYN20260925100000_1,2026-09-25T10:00:00+07:00</references>
  <info>
    <language>th-TH</language>
    <category>Met</category>
    <event>Heavy Rain</event>
    <urgency>Past</urgency>
    <severity>Minor</severity>
    <certainty>Observed</certainty>
    <effective>2026-09-25T12:00:00+07:00</effective>
    <expires>2026-09-26T10:00:00+07:00</expires>
    <senderName>TMD</senderName>
    <headline>ข้อมูลสังเคราะห์สำหรับทดสอบ fontokmai: ยกเลิกประกาศฝนตกหนัก (ไม่ใช่ประกาศจริง)</headline>
    <description>ข้อความสังเคราะห์ ไม่ใช่ประกาศของกรมอุตุนิยมวิทยา</description>
    <area>
      <areaDesc>ปทุมธานี</areaDesc>
      <polygon>14.00,100.50 14.00,100.70 14.15,100.70 14.15,100.50 14.00,100.50</polygon>
      <geocode><valueName>ISO3166-2</valueName><value>TH-13</value></geocode>
    </area>
  </info>
</alert>
```

```xml
<!-- file: pipeline/tests/fixtures/tmd_cap_synthetic/index_alert.xml -->
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>synthetic</title><copyright>test data</copyright>
<item><title>ฝนตกหนัก (สังเคราะห์)</title><link>https://www.tmd.go.th/uploads/CAP/SYN_A1.xml</link><guid>SYN20260925100000_1</guid><pubDate>Fri, 25 Sep 2026 03:00:00 +0700</pubDate></item>
</channel></rss>
```

```xml
<!-- file: pipeline/tests/fixtures/tmd_cap_synthetic/index_cancel.xml -->
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>synthetic</title><copyright>test data</copyright>
<item><title>ยกเลิก (สังเคราะห์)</title><link>https://www.tmd.go.th/uploads/CAP/SYN_C1.xml</link><guid>SYN20260925120000_1</guid><pubDate>Fri, 25 Sep 2026 05:00:00 +0700</pubDate></item>
</channel></rss>
```

```xml
<!-- file: pipeline/tests/fixtures/tmd_cap_synthetic/index_both.xml -->
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>synthetic</title><copyright>test data</copyright>
<item><title>ยกเลิก (สังเคราะห์)</title><link>https://www.tmd.go.th/uploads/CAP/SYN_C1.xml</link><guid>SYN20260925120000_1</guid><pubDate>Fri, 25 Sep 2026 05:00:00 +0700</pubDate></item>
<item><title>ฝนตกหนัก (สังเคราะห์)</title><link>https://www.tmd.go.th/uploads/CAP/SYN_A1.xml</link><guid>SYN20260925100000_1</guid><pubDate>Fri, 25 Sep 2026 03:00:00 +0700</pubDate></item>
</channel></rss>
```

- [ ] **Step 2: helpers + failing test**

```python
# file: pipeline/tests/helpers.py
from pathlib import Path

from fontokmai.sources.tmd_cap.parser import CapMessage, parse_cap

FIXTURES = Path(__file__).parent / "fixtures" / "tmd_cap"
SYNTHETIC = Path(__file__).parent / "fixtures" / "tmd_cap_synthetic"
CAP_BASE = "https://www.tmd.go.th/uploads/CAP/"


def read_fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def real_messages() -> list[tuple[CapMessage, str]]:
    return [(parse_cap(p.read_bytes()), CAP_BASE + p.name) for p in sorted(FIXTURES.glob("CAPTMD*.xml"))]
```

```python
# file: pipeline/tests/test_tmd_cap_index.py
from fontokmai.sources.tmd_cap.index import parse_index
from helpers import read_fixture


def test_parse_real_index():
    items = parse_index(read_fixture("index.xml"))
    assert len(items) == 13
    first = items[0]
    assert first.guid == "TMD20260925163420_2"
    assert first.link == "https://www.tmd.go.th/uploads/CAP/CAPTMD20260925163420_2.xml"
    assert first.pub_date_raw == "Fri, 25 Sep 2026 09:34:00 +0700"
    assert first.pub_date is not None and first.pub_date.utcoffset().total_seconds() == 7 * 3600


def test_parse_index_accepts_bom_and_skips_items_without_link():
    raw = (b"\xef\xbb\xbf<?xml version='1.0' encoding='utf-8'?><rss><channel>"
           b"<item><title>a</title></item>"
           b"<item><title>b</title><link>https://www.tmd.go.th/uploads/CAP/x.xml</link><guid>X</guid></item>"
           b"</channel></rss>")
    items = parse_index(raw)
    assert [i.guid for i in items] == ["X"]
    assert items[0].pub_date is None
```

- [ ] **Step 3: Run** `uv run pytest tests/test_tmd_cap_index.py` · Expected: FAIL (module not found)

- [ ] **Step 4: implementation**

```python
# file: pipeline/src/fontokmai/sources/tmd_cap/index.py
"""Parse the TMD CAP RSS index (https://www.tmd.go.th/api/xml/CAP)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime


@dataclass(frozen=True)
class IndexItem:
    guid: str | None
    title: str
    link: str
    pub_date_raw: str | None
    pub_date: datetime | None


def _text(el: ET.Element, tag: str) -> str | None:
    value = el.findtext(tag)
    if value is None or not value.strip():
        return None
    return value.strip()


def parse_index(raw: bytes) -> list[IndexItem]:
    """Items of the RSS index in document order.

    pubDate is kept as published. TMD labels it +0700 although it matches UTC, so lifecycle
    decisions use the times inside each CAP document instead (design 9.2).
    """
    try:
        root = ET.fromstring(raw.removeprefix(b"\xef\xbb\xbf"))
    except ET.ParseError as exc:
        raise ValueError(f"invalid RSS index: {exc}") from exc
    channel = root.find("channel")
    if channel is None:
        raise ValueError("RSS index has no <channel>")
    items = []
    for item in channel.findall("item"):
        link = _text(item, "link")
        if link is None:
            continue
        pub_raw = _text(item, "pubDate")
        try:
            pub = parsedate_to_datetime(pub_raw) if pub_raw else None
        except (TypeError, ValueError):
            pub = None
        items.append(IndexItem(guid=_text(item, "guid"), title=_text(item, "title") or "", link=link,
                               pub_date_raw=pub_raw, pub_date=pub))
    return items
```

- [ ] **Step 5: Run** test ซ้ำ (ต้องมี parser จาก Task 5 เพราะ helpers import — ให้ทำ Task 5 Step 3 ก่อนรัน) · Expected: PASS
- [ ] **Step 6: Commit** `feat(tmd-cap): real CAP fixtures and RSS index parser`

### Task 5: ตัวอ่านเอกสาร CAP 1.2

**Files:** Create `pipeline/src/fontokmai/sources/tmd_cap/parser.py`, Test `pipeline/tests/test_tmd_cap_parser.py`

- [ ] **Step 1: failing test**

```python
# file: pipeline/tests/test_tmd_cap_parser.py
from datetime import datetime

import pytest

from fontokmai.sources.tmd_cap.parser import CapParseError, parse_cap
from helpers import read_fixture

T = datetime.fromisoformat
MINIMAL = ("<identifier>T1</identifier><sender>TMD</sender><sent>2026-09-25T10:00:00+07:00</sent>"
           "<status>Actual</status><msgType>Alert</msgType><scope>Public</scope>")


def _cap(body: str) -> bytes:
    return ("<alert xmlns='urn:oasis:names:tc:emergency:cap:1.2'>" + body + "</alert>").encode()


def test_parse_real_update_message():
    msg = parse_cap(read_fixture("CAPTMD20260925162831_2.xml"))
    assert (msg.identifier, msg.sender) == ("TMD20260925162831_2", "TMD")
    assert msg.sent == T("2026-09-25T16:27:00+07:00")
    assert (msg.status, msg.msg_type, msg.scope) == ("Actual", "Update", "Public")
    assert [(r.identifier, r.sent) for r in msg.references] == [("TMD20260925071317_2", T("2026-09-25T07:10:00+07:00"))]
    info = msg.infos[0]
    assert (info.language, info.event) == ("th-TH", "Very Heavy Rain")
    assert (info.effective, info.expires, info.onset) == (
        T("2026-09-25T08:00:00+07:00"), T("2026-09-26T06:00:00+07:00"), None)
    area = info.areas[0]
    assert len(area.polygons) == 52
    assert ("ISO3166-2", "TH-10") in area.geocodes


def test_real_polygons_are_lon_lat_and_closed():
    msg = parse_cap(read_fixture("CAPTMD20260925162831_2.xml"))
    for ring in msg.infos[0].areas[0].polygons:
        assert ring[0] == ring[-1]
        assert all(97.0 < lon < 106.0 and 5.0 < lat < 21.0 for lon, lat in ring)


def test_lat_lon_pairs_become_lon_lat():
    raw = _cap(MINIMAL + "<info><event>Heavy Rain</event><urgency>Expected</urgency><severity>Moderate</severity>"
               "<certainty>Likely</certainty><area><areaDesc>x</areaDesc>"
               "<polygon>13.0,100.0 13.0,101.0 14.0,101.0</polygon></area></info>")
    ring = parse_cap(raw).infos[0].areas[0].polygons[0]
    assert ring == ((100.0, 13.0), (101.0, 13.0), (101.0, 14.0), (100.0, 13.0))


def test_bom_is_accepted():
    assert parse_cap(b"\xef\xbb\xbf" + _cap(MINIMAL)).identifier == "T1"


def test_missing_language_defaults_to_en_us():
    raw = _cap(MINIMAL + "<info><event>E</event><urgency>U</urgency><severity>S</severity>"
               "<certainty>C</certainty></info>")
    assert parse_cap(raw).infos[0].language == "en-US"


@pytest.mark.parametrize("raw", [
    b"not xml",
    b"<alert><identifier>x</identifier></alert>",
    _cap("<sender>TMD</sender>"),
    _cap(MINIMAL.replace("+07:00", "")),
    _cap(MINIMAL + "<references>TMD,only-two</references>"),
])
def test_invalid_documents_raise(raw):
    with pytest.raises(CapParseError):
        parse_cap(raw)
```

- [ ] **Step 2: Run** `uv run pytest tests/test_tmd_cap_parser.py` · Expected: FAIL (module not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/sources/tmd_cap/parser.py
"""Parse CAP 1.2 documents published by TMD (design 9.2)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime

CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2"
_NS = {"cap": CAP_NS}


class CapParseError(ValueError):
    """The document is not a usable CAP 1.2 alert."""


@dataclass(frozen=True)
class CapReference:
    sender: str
    identifier: str
    sent: datetime


@dataclass(frozen=True)
class CapArea:
    area_desc: str
    polygons: tuple[tuple[tuple[float, float], ...], ...]  # closed rings of (lon, lat)
    geocodes: tuple[tuple[str, str], ...]  # (valueName, value)


@dataclass(frozen=True)
class CapInfo:
    language: str
    event: str
    urgency: str
    severity: str
    certainty: str
    effective: datetime | None
    onset: datetime | None
    expires: datetime | None
    sender_name: str | None
    headline: str | None
    description: str | None
    instruction: str | None
    web: str | None
    areas: tuple[CapArea, ...]


@dataclass(frozen=True)
class CapMessage:
    identifier: str
    sender: str
    sent: datetime
    status: str
    msg_type: str
    scope: str
    references: tuple[CapReference, ...]
    infos: tuple[CapInfo, ...]

    @property
    def key(self) -> str:
        """Message identity per CAP: (sender, identifier, sent)."""
        return f"{self.sender}|{self.identifier}|{self.sent.isoformat()}"


def _text(el: ET.Element, path: str) -> str | None:
    value = el.findtext(path, namespaces=_NS)
    if value is None or not value.strip():
        return None
    return value.strip()


def _required(el: ET.Element, path: str) -> str:
    value = _text(el, path)
    if value is None:
        raise CapParseError(f"missing <{path}>")
    return value


def _time(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise CapParseError(f"invalid time: {value}") from exc
    if parsed.tzinfo is None:
        raise CapParseError(f"time without UTC offset: {value}")
    return parsed


def _polygon(text: str) -> tuple[tuple[float, float], ...]:
    """CAP polygons are space-separated "lat,lon" pairs; GeoJSON positions are (lon, lat)."""
    try:
        ring = [(float(lon), float(lat)) for lat, lon in (pair.split(",") for pair in text.split())]
    except ValueError as exc:
        raise CapParseError(f"invalid polygon: {exc}") from exc
    if len(ring) < 3:
        raise CapParseError("polygon needs at least 3 points")
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return tuple(ring)


def _references(text: str | None) -> tuple[CapReference, ...]:
    if not text:
        return ()
    refs = []
    for triple in text.split():
        parts = triple.split(",")
        if len(parts) != 3:
            raise CapParseError(f"invalid reference: {triple}")
        sender, identifier, sent = parts
        refs.append(CapReference(sender=sender, identifier=identifier, sent=_time(sent)))
    return tuple(refs)


def _area(area: ET.Element) -> CapArea:
    polygons = tuple(_polygon(p.text) for p in area.findall("cap:polygon", _NS) if p.text and p.text.strip())
    geocodes = tuple((_required(g, "cap:valueName"), _required(g, "cap:value"))
                     for g in area.findall("cap:geocode", _NS))
    return CapArea(area_desc=_text(area, "cap:areaDesc") or "", polygons=polygons, geocodes=geocodes)


def _info(info: ET.Element) -> CapInfo:
    return CapInfo(
        language=_text(info, "cap:language") or "en-US",
        event=_required(info, "cap:event"),
        urgency=_required(info, "cap:urgency"),
        severity=_required(info, "cap:severity"),
        certainty=_required(info, "cap:certainty"),
        effective=_time(_text(info, "cap:effective")),
        onset=_time(_text(info, "cap:onset")),
        expires=_time(_text(info, "cap:expires")),
        sender_name=_text(info, "cap:senderName"),
        headline=_text(info, "cap:headline"),
        description=_text(info, "cap:description"),
        instruction=_text(info, "cap:instruction"),
        web=_text(info, "cap:web"),
        areas=tuple(_area(a) for a in info.findall("cap:area", _NS)),
    )


def parse_cap(raw: bytes) -> CapMessage:
    try:
        root = ET.fromstring(raw.removeprefix(b"\xef\xbb\xbf"))
    except ET.ParseError as exc:
        raise CapParseError(f"invalid XML: {exc}") from exc
    if root.tag != f"{{{CAP_NS}}}alert":
        raise CapParseError(f"not a CAP 1.2 alert: {root.tag}")
    return CapMessage(
        identifier=_required(root, "cap:identifier"),
        sender=_required(root, "cap:sender"),
        sent=_time(_required(root, "cap:sent")),
        status=_required(root, "cap:status"),
        msg_type=_required(root, "cap:msgType"),
        scope=_required(root, "cap:scope"),
        references=_references(_text(root, "cap:references")),
        infos=tuple(_info(i) for i in root.findall("cap:info", _NS)),
    )
```

- [ ] **Step 4: Run** `uv run pytest tests/test_tmd_cap_parser.py tests/test_tmd_cap_index.py` · Expected: PASS
- [ ] **Step 5: Commit** `feat(tmd-cap): CAP 1.2 parser with lat,lon → lon,lat conversion`

### Task 6: SQLite state

**Files:** Create `pipeline/src/fontokmai/state.py`, Test `pipeline/tests/test_state.py`

- [ ] **Step 1: failing test**

```python
# file: pipeline/tests/test_state.py
from datetime import datetime

from fontokmai.state import StateStore

NOW = datetime.fromisoformat("2026-09-25T18:20:00+07:00")


def test_documents_are_stored_once_and_round_trip(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        doc = {"identifier": "T1", "sender": "TMD", "sent": NOW, "raw": b"<xml/>", "source_url": "u", "seen_at": NOW}
        assert store.add_cap_document(**doc) is True
        assert store.add_cap_document(**doc) is False
        assert store.has_cap_document("T1") and not store.has_cap_document("T2")
        assert store.cap_documents() == [(b"<xml/>", "u")]


def test_revision_increases_only_when_content_changes(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        assert store.revision_for("alert:x", "h1", NOW) == 1
        assert store.revision_for("alert:x", "h1", NOW) == 1
        assert store.revision_for("alert:x", "h2", NOW) == 2
        assert store.revision_for("alert:y", "h2", NOW) == 1


def test_state_survives_reopen(tmp_path):
    path = tmp_path / "s.db"
    with StateStore(path) as store:
        store.feed_sequence_for("a", NOW)
        store.feed_sequence_for("b", NOW)
        store.set_meta("tmd_cap.last_success_at", NOW.isoformat())
    with StateStore(path) as store:
        assert store.feed_sequence_for("b", NOW) == 2
        assert store.get_meta("tmd_cap.last_success_at") == NOW.isoformat()
        assert store.get_meta("missing") is None
```

- [ ] **Step 2: Run** `uv run pytest tests/test_state.py` · Expected: FAIL (module not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/state.py
"""SQLite state: raw source documents, content revisions and metadata (design 4.5)."""

from __future__ import annotations

import hashlib
import sqlite3
import zlib
from datetime import datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS cap_documents (
    identifier TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    sent TEXT NOT NULL,
    source_url TEXT NOT NULL,
    raw_sha256 TEXT NOT NULL,
    raw_zlib BLOB NOT NULL,
    first_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
    key TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class StateStore:
    """Checkpoint of one writer. Every public method commits its own transaction."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> StateStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def has_cap_document(self, identifier: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM cap_documents WHERE identifier = ?", (identifier,)).fetchone()
        return row is not None

    def add_cap_document(self, *, identifier: str, sender: str, sent: datetime, raw: bytes, source_url: str,
                         seen_at: datetime) -> bool:
        """Store a raw CAP document once; False when it was already stored."""
        with self._conn:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO cap_documents VALUES (?, ?, ?, ?, ?, ?, ?)",
                (identifier, sender, sent.isoformat(), source_url, hashlib.sha256(raw).hexdigest(),
                 zlib.compress(raw, 6), seen_at.isoformat()),
            )
        return cur.rowcount == 1

    def cap_documents(self) -> list[tuple[bytes, str]]:
        rows = self._conn.execute(
            "SELECT raw_zlib, source_url FROM cap_documents ORDER BY sent, identifier").fetchall()
        return [(zlib.decompress(raw), url) for raw, url in rows]

    def revision_for(self, key: str, content_hash: str, now: datetime) -> int:
        """Revision of `key`; it increases only when the content hash changes."""
        with self._conn:
            row = self._conn.execute(
                "SELECT revision, content_hash FROM revisions WHERE key = ?", (key,)).fetchone()
            if row is not None and row[1] == content_hash:
                return row[0]
            revision = 1 if row is None else row[0] + 1
            self._conn.execute("INSERT OR REPLACE INTO revisions VALUES (?, ?, ?, ?)",
                               (key, revision, content_hash, now.isoformat()))
        return revision

    def feed_sequence_for(self, feed_hash: str, now: datetime) -> int:
        return self.revision_for("feed:alerts", feed_hash, now)

    def file_revision(self, path: str, sha256: str, now: datetime) -> int:
        return self.revision_for(f"file:{path}", sha256, now)

    def get_meta(self, key: str) -> str | None:
        row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._conn:
            self._conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, value))
```

- [ ] **Step 4: Run** `uv run pytest tests/test_state.py` · Expected: PASS (3 tests)
- [ ] **Step 5: Commit** `feat(state): SQLite checkpoint with content revisions`

### Task 7: event lineage, lifecycle และการประกอบ feed

**Files:** Create `pipeline/src/fontokmai/feeds/alerts.py`, `pipeline/src/fontokmai/sources/tmd_cap/lifecycle.py`, Test `pipeline/tests/test_tmd_cap_lifecycle.py`, `pipeline/tests/test_feed.py`

- [ ] **Step 1: failing tests**

```python
# file: pipeline/tests/test_tmd_cap_lifecycle.py
from datetime import datetime

from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from fontokmai.sources.tmd_cap.parser import parse_cap
from helpers import real_messages

T = datetime.fromisoformat


def _msg(identifier, sent, msg_type="Alert", status="Actual", refs="", effective=None, expires=None, info=True):
    body = ""
    if info:
        body = ("<info><language>th-TH</language><event>Heavy Rain</event><urgency>Expected</urgency>"
                "<severity>Severe</severity><certainty>Likely</certainty>"
                + (f"<effective>{effective}</effective>" if effective else "")
                + (f"<expires>{expires}</expires>" if expires else "")
                + "<area><areaDesc>กรุงเทพมหานคร</areaDesc>"
                "<polygon>13.0,100.0 13.0,101.0 14.0,101.0 13.0,100.0</polygon>"
                "<geocode><valueName>ISO3166-2</valueName><value>TH-10</value></geocode></area></info>")
    raw = ("<alert xmlns='urn:oasis:names:tc:emergency:cap:1.2'>"
           f"<identifier>{identifier}</identifier><sender>TMD</sender><sent>{sent}</sent>"
           f"<status>{status}</status><msgType>{msg_type}</msgType><scope>Public</scope>"
           + (f"<references>{refs}</references>" if refs else "") + body + "</alert>")
    return parse_cap(raw.encode())


def _real_candidates(now):
    pairs = real_messages()
    urls = {m.key: url for m, url in pairs}
    return {c.event_id: c for c in alert_candidates(group_events(m for m, _ in pairs), urls, T(now))}


def test_real_messages_group_into_nine_events():
    events = {e.event_id: e for e in group_events(m for m, _ in real_messages())}
    assert len(events) == 9
    lineage = events["tmd:TMD20260925071317_2"]
    assert [m.identifier for m in lineage.messages] == ["TMD20260925071317_2", "TMD20260925162831_2"]


def test_real_messages_at_1820():
    cands = _real_candidates("2026-09-25T18:20:00+07:00")
    active = sorted(e for e, c in cands.items() if c.payload["lifecycle_status"] == "active")
    assert active == ["tmd:TMD20260925071012_2", "tmd:TMD20260925071317_2", "tmd:TMD20260925163420_2"]
    assert sum(c.payload["lifecycle_status"] == "expired" for c in cands.values()) == 6
    update = cands["tmd:TMD20260925071317_2"].payload
    assert (update["message_type"], update["source_message_id"]) == ("update", "TMD20260925162831_2")
    assert update["supersedes"] == ["TMD20260925071317_2"]
    assert {"kind": "province", "code": "TH-10"} in update["targets"]
    assert len(update["geometry"]["coordinates"]) == 52
    assert (update["credit_th"], update["notify_eligible"]) == ("กรมอุตุนิยมวิทยา", False)


def test_invalid_source_window_uses_default_expiry_and_is_flagged():
    p = _real_candidates("2026-09-25T18:20:00+07:00")["tmd:TMD20260925071012_2"].payload
    assert p["source_message_id"] == "TMD20260925163148_2"
    assert (p["expires_policy"], p["qc_flags"]) == ("default_24h", ["expires_not_after_effective"])
    assert p["expires"] == T("2026-09-26T16:29:00+07:00")
    assert p["lifecycle_status"] == "active"


def test_future_effective_is_pending():
    p = _real_candidates("2026-09-25T17:30:00+07:00")["tmd:TMD20260925163420_2"].payload
    assert (p["lifecycle_status"], p["is_effective"]) == ("pending", False)


def test_non_actual_messages_are_ignored():
    assert group_events([_msg("X1", "2026-09-25T10:00:00+07:00", status="Test")]) == []


def test_cancel_before_alert_keeps_event_cancelled():
    alert = _msg("A1", "2026-09-25T10:00:00+07:00", expires="2026-09-26T10:00:00+07:00")
    cancel = _msg("C1", "2026-09-25T12:00:00+07:00", msg_type="Cancel", refs="TMD,A1,2026-09-25T10:00:00+07:00")
    assert [e.event_id for e in group_events([cancel])] == ["tmd:A1"]
    both = group_events([cancel, alert])
    assert [e.event_id for e in both] == ["tmd:A1"]
    urls = {m.key: "https://www.tmd.go.th/uploads/CAP/x.xml" for m in (alert, cancel)}
    (cand,) = alert_candidates(both, urls, T("2026-09-25T13:00:00+07:00"))
    assert cand.payload["lifecycle_status"] == "cancelled"
    assert cand.ended_at == T("2026-09-25T12:00:00+07:00")


def test_cancel_without_info_still_ends_the_event():
    cancel = _msg("C2", "2026-09-25T12:00:00+07:00", msg_type="Cancel", refs="TMD,A2,2026-09-25T10:00:00+07:00",
                  info=False)
    (cand,) = alert_candidates(group_events([cancel]), {cancel.key: "u"}, T("2026-09-25T13:00:00+07:00"))
    assert (cand.event_id, cand.payload["lifecycle_status"], cand.ended_at) == (
        "tmd:A2", "cancelled", T("2026-09-25T12:00:00+07:00"))


def test_missing_expires_uses_default_and_flag():
    msg = _msg("M1", "2026-09-25T10:00:00+07:00")
    (cand,) = alert_candidates(group_events([msg]), {msg.key: "u"}, T("2026-09-25T11:00:00+07:00"))
    assert cand.payload["effective"] == T("2026-09-25T10:00:00+07:00")
    assert cand.payload["expires"] == T("2026-09-26T10:00:00+07:00")
    assert cand.payload["qc_flags"] == ["missing_expires"]
```

```python
# file: pipeline/tests/test_feed.py
from datetime import datetime

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.common import SourceStatus
from fontokmai.feeds.alerts import assemble_alerts_feed
from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from fontokmai.state import StateStore
from helpers import real_messages

T = datetime.fromisoformat


def _feed(store, now):
    now = T(now)
    pairs = real_messages()
    urls = {m.key: url for m, url in pairs}
    status = SourceStatus(source_id="tmd_cap", status="ok", last_attempt_at=now, last_success_at=now,
                          items_seen=13, items_rejected=0)
    candidates = alert_candidates(group_events(m for m, _ in pairs), urls, now)
    return assemble_alerts_feed(candidates, store, now=now, generation_id="g", recovery_epoch=1,
                                source_status=[status])


def test_feed_at_1820_has_three_alerts_and_six_tombstones(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        feed = _feed(store, "2026-09-25T18:20:00+07:00")
    assert [a.event_id for a in feed.alerts] == [
        "tmd:TMD20260925071012_2", "tmd:TMD20260925071317_2", "tmd:TMD20260925163420_2"]
    assert len(feed.tombstones) == 6 and {t.lifecycle_status for t in feed.tombstones} == {"expired"}
    assert (feed.feed_sequence, feed.generation_id, feed.recovery_epoch) == (1, "g", 1)
    assert AlertsFeed.model_validate_json(feed.model_dump_json()) == feed


def test_rerun_without_changes_keeps_sequence_and_revisions(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        first = _feed(store, "2026-09-25T18:20:00+07:00")
        second = _feed(store, "2026-09-25T18:35:00+07:00")
    assert second.feed_sequence == first.feed_sequence == 1
    assert [a.revision for a in second.alerts] == [1, 1, 1]


def test_lifecycle_change_bumps_revision_and_sequence(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        before = _feed(store, "2026-09-25T17:30:00+07:00")
        after = _feed(store, "2026-09-25T18:20:00+07:00")
    pending = {a.event_id: a for a in before.alerts}["tmd:TMD20260925163420_2"]
    active = {a.event_id: a for a in after.alerts}["tmd:TMD20260925163420_2"]
    assert (pending.lifecycle_status, pending.revision) == ("pending", 1)
    assert (active.lifecycle_status, active.revision) == ("active", 2)
    assert after.feed_sequence == 2


def test_old_tombstones_leave_the_feed(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        feed = _feed(store, "2026-10-05T12:00:00+07:00")
    assert feed.alerts == [] and feed.tombstones == []
```

- [ ] **Step 2: Run** `uv run pytest tests/test_tmd_cap_lifecycle.py tests/test_feed.py` · Expected: FAIL (modules not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/feeds/alerts.py
"""Assemble /data/v1/alerts.json from source-specific alert candidates (design 9.1)."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from fontokmai.contracts.alerts import Alert, AlertsFeed, AlertTombstone
from fontokmai.contracts.common import SourceStatus

HISTORY = timedelta(days=7)
LIVE_STATUSES = ("pending", "active")


@dataclass(frozen=True)
class AlertCandidate:
    event_id: str
    payload: dict[str, Any]  # every Alert field except `revision`
    ended_at: datetime | None  # set for expired and cancelled events


class RevisionStore(Protocol):
    def revision_for(self, key: str, content_hash: str, now: datetime) -> int: ...

    def feed_sequence_for(self, feed_hash: str, now: datetime) -> int: ...


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def content_hash(value: Any) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def assemble_alerts_feed(candidates: Iterable[AlertCandidate], store: RevisionStore, *, now: datetime,
                         generation_id: str, recovery_epoch: int,
                         source_status: list[SourceStatus]) -> AlertsFeed:
    """Live events go to `alerts`; events that ended within HISTORY become tombstones."""
    since = now - HISTORY
    alerts: list[Alert] = []
    tombstones: list[AlertTombstone] = []
    for cand in sorted(candidates, key=lambda c: c.event_id):
        revision = store.revision_for(f"alert:{cand.event_id}", content_hash(cand.payload), now)
        status = cand.payload["lifecycle_status"]
        if status in LIVE_STATUSES:
            alerts.append(Alert(revision=revision, **cand.payload))
        elif cand.ended_at is not None and cand.ended_at >= since:
            tombstones.append(AlertTombstone(event_id=cand.event_id, revision=revision,
                                             lifecycle_status=status, ended_at=cand.ended_at))
    body = {"alerts": [a.model_dump(mode="json") for a in alerts],
            "tombstones": [t.model_dump(mode="json") for t in tombstones]}
    return AlertsFeed(generation_id=generation_id, recovery_epoch=recovery_epoch, feed_generated_at=now,
                      feed_sequence=store.feed_sequence_for(content_hash(body), now), history_since=since,
                      alerts=alerts, tombstones=tombstones, source_status=source_status)
```

```python
# file: pipeline/src/fontokmai/sources/tmd_cap/lifecycle.py
"""Group TMD CAP messages into event lineages and derive alert payloads (design 9.1-9.2)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fontokmai.feeds.alerts import AlertCandidate
from fontokmai.sources.tmd_cap.parser import CapInfo, CapMessage

NAMESPACE = "tmd"
ISSUER = "กรมอุตุนิยมวิทยา"
CREDIT_TH = "กรมอุตุนิยมวิทยา"
DEFAULT_EXPIRY = timedelta(hours=24)
MESSAGE_TYPES = {"Alert": "new", "Update": "update", "Cancel": "cancel"}


@dataclass(frozen=True)
class EventLineage:
    event_id: str
    messages: tuple[CapMessage, ...]  # sorted by (sent, identifier); the last one is current

    @property
    def current(self) -> CapMessage:
        return self.messages[-1]


def is_official(msg: CapMessage) -> bool:
    """Only real public messages become alerts; Test/Exercise/System/Draft and Ack/Error do not."""
    return msg.status == "Actual" and msg.scope == "Public" and msg.msg_type in MESSAGE_TYPES


def group_events(messages: Iterable[CapMessage]) -> list[EventLineage]:
    """Union messages linked by `references`; the event id comes from the earliest known message.

    A Cancel seen before its Alert already maps to the Alert's event id (taken from the reference),
    and a late older message cannot reactivate the event because the newest message stays current.
    """
    official = {m.identifier: m for m in messages if is_official(m)}
    parent: dict[str, str] = {}
    first_sent: dict[str, datetime] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for msg in official.values():
        first_sent.setdefault(msg.identifier, msg.sent)
        find(msg.identifier)
        for ref in msg.references:
            first_sent.setdefault(ref.identifier, ref.sent)
            a, b = find(msg.identifier), find(ref.identifier)
            if a != b:
                parent[b] = a

    groups: dict[str, list[str]] = {}
    for identifier in list(parent):
        groups.setdefault(find(identifier), []).append(identifier)

    lineages = []
    for members in groups.values():
        seen = sorted((official[i] for i in members if i in official), key=lambda m: (m.sent, m.identifier))
        if not seen:
            continue
        root = min(members, key=lambda i: (first_sent[i], i))
        lineages.append(EventLineage(event_id=f"{NAMESPACE}:{root}", messages=tuple(seen)))
    return sorted(lineages, key=lambda e: (e.current.sent, e.event_id))


def primary_info(msg: CapMessage) -> CapInfo | None:
    for info in msg.infos:
        if info.language.lower().startswith("th"):
            return info
    return msg.infos[0] if msg.infos else None


def _display_source(lineage: EventLineage) -> tuple[CapMessage, CapInfo] | None:
    """Newest message that carries an <info>; a Cancel may come without one."""
    for msg in reversed(lineage.messages):
        info = primary_info(msg)
        if info is not None:
            return msg, info
    return None


def _times(msg: CapMessage, info: CapInfo) -> tuple[datetime, datetime, str, list[str]]:
    """(effective, expires, expires_policy, qc_flags). Default: 24 h after the later of sent/effective."""
    effective = info.effective or msg.sent
    default_expires = max(msg.sent, effective) + DEFAULT_EXPIRY
    if info.expires is None:
        return effective, default_expires, "default_24h", ["missing_expires"]
    if info.expires <= effective:
        return effective, default_expires, "default_24h", ["expires_not_after_effective"]
    return effective, info.expires, "source", []


def _geometry(info: CapInfo) -> dict[str, Any] | None:
    polygons = [[[list(point) for point in ring]] for area in info.areas for ring in area.polygons]
    return {"type": "MultiPolygon", "coordinates": polygons} if polygons else None


def _targets(info: CapInfo) -> list[dict[str, str]]:
    codes: list[str] = []
    for area in info.areas:
        for name, value in area.geocodes:
            if name.upper() == "ISO3166-2" and value not in codes:
                codes.append(value)
    return [{"kind": "province", "code": code} for code in codes]


def alert_candidates(lineages: Iterable[EventLineage], urls: dict[str, str],
                     now: datetime) -> list[AlertCandidate]:
    candidates = []
    for lineage in lineages:
        current = lineage.current
        shown = _display_source(lineage)
        if shown is None:
            payload = {"event_id": lineage.event_id, "lifecycle_status": "cancelled",
                       "source_message_id": current.identifier}
            candidates.append(AlertCandidate(lineage.event_id, payload, ended_at=current.sent))
            continue
        shown_msg, info = shown
        effective, expires, policy, flags = _times(shown_msg, info)
        if current.msg_type == "Cancel":
            status, ended_at = "cancelled", current.sent
        elif now >= expires:
            status, ended_at = "expired", expires
        elif now < effective:
            status, ended_at = "pending", None
        else:
            status, ended_at = "active", None
        payload = {
            "event_id": lineage.event_id,
            "message_type": MESSAGE_TYPES[current.msg_type],
            "lifecycle_status": status,
            "is_effective": status == "active",
            "origin": "official",
            "issuer": ISSUER,
            "source_message_id": current.identifier,
            "supersedes": [ref.identifier for ref in current.references],
            "event": info.event,
            "severity": info.severity,
            "urgency": info.urgency,
            "certainty": info.certainty,
            "headline_th": info.headline,
            "body_th": info.description,
            "instruction_th": info.instruction,
            "area_desc_th": "; ".join(a.area_desc for a in info.areas if a.area_desc) or None,
            "sent": current.sent,
            "effective": effective,
            "onset": info.onset,
            "expires": expires,
            "expires_policy": policy,
            "qc_flags": flags,
            "targets": _targets(info),
            "geometry": _geometry(info),
            "source_url": urls[current.key],
            "credit_th": CREDIT_TH,
            "notify_eligible": False,
        }
        candidates.append(AlertCandidate(lineage.event_id, payload, ended_at=ended_at))
    return candidates
```

- [ ] **Step 4: Run** `uv run pytest tests/test_tmd_cap_lifecycle.py tests/test_feed.py` · Expected: PASS
- [ ] **Step 5: Commit** `feat(alerts): CAP event lineage, lifecycle and alerts feed with content revisions`

### Task 8: การดึงข้อมูลและหนึ่งรอบการเก็บ

**Files:** Create `pipeline/src/fontokmai/sources/tmd_cap/fetch.py`, `pipeline/src/fontokmai/sources/tmd_cap/collect.py`, Test `pipeline/tests/test_tmd_cap_fetch.py`, `pipeline/tests/test_tmd_cap_collect.py`

- [ ] **Step 1: failing tests**

```python
# file: pipeline/tests/test_tmd_cap_fetch.py
import httpx
import pytest

from fontokmai.sources.tmd_cap.fetch import FetchError, LiveFetcher, get_bytes, is_allowed_cap_url, make_ssl_context

INDEX = "https://www.tmd.go.th/api/xml/CAP"


@pytest.mark.parametrize(("url", "ok"), [
    ("https://www.tmd.go.th/uploads/CAP/CAPTMD20260925163420_2.xml", True),
    ("https://tmd.go.th/uploads/CAP/x.xml", True),
    ("http://www.tmd.go.th/uploads/CAP/x.xml", False),
    ("https://evil.example/uploads/CAP/x.xml", False),
    ("https://www.tmd.go.th/other/x.xml", False),
    ("https://www.tmd.go.th/uploads/CAP/x.html", False),
])
def test_cap_url_allowlist(url, ok):
    assert is_allowed_cap_url(url) is ok


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_live_fetcher_returns_body_and_identifies_itself():
    seen = {}

    def handler(request):
        seen["ua"] = request.headers.get("user-agent")
        return httpx.Response(200, content=b"<rss/>")

    fetch = LiveFetcher(transport=httpx.MockTransport(handler))
    try:
        assert fetch(INDEX) == b"<rss/>"
    finally:
        fetch.close()
    assert seen["ua"].startswith("fontokmai/")


def test_http_errors_and_oversized_bodies_raise():
    with _client(lambda r: httpx.Response(404)) as client:
        with pytest.raises(FetchError, match="HTTP 404"):
            get_bytes(client, INDEX)
    with _client(lambda r: httpx.Response(200, content=b"x" * 11)) as client:
        with pytest.raises(FetchError, match="larger than 10"):
            get_bytes(client, INDEX, max_bytes=10)


def test_transport_errors_become_fetch_errors():
    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    with _client(handler) as client:
        with pytest.raises(FetchError, match="ConnectError"):
            get_bytes(client, INDEX)


def test_ssl_context_adds_the_intermediate_that_the_tmd_server_does_not_send():
    ctx = make_ssl_context()
    names = [dict(part[0] for part in cert["subject"]).get("commonName") for cert in ctx.get_ca_certs()]
    assert "GlobalSign GCC R6 AlphaSSL CA 2025" in names
    assert "GlobalSign" in names  # the root still has to be trusted on its own
    assert ctx.verify_mode.name == "CERT_REQUIRED" and ctx.check_hostname
```

```python
# file: pipeline/tests/test_tmd_cap_collect.py
from datetime import datetime

from fontokmai.sources.tmd_cap.collect import collect, load_messages
from fontokmai.sources.tmd_cap.fetch import INDEX_URL, FetchError, fixture_fetcher
from fontokmai.state import StateStore
from helpers import FIXTURES

NOW = datetime.fromisoformat("2026-09-25T18:20:00+07:00")


def test_collect_stores_every_document_once(tmp_path):
    fetch = fixture_fetcher(FIXTURES)
    with StateStore(tmp_path / "s.db") as store:
        first = collect(store, fetch, NOW)
        assert (first.status, first.items_seen, first.fetched, first.rejected) == ("ok", 13, 13, 0)
        second = collect(store, fetch, NOW)
        assert (second.status, second.fetched) == ("ok", 0)
        assert len(load_messages(store)) == 13


def test_index_failure_is_reported_and_keeps_stored_documents(tmp_path):
    def broken(url):
        raise FetchError(f"{url}: HTTP 503")

    with StateStore(tmp_path / "s.db") as store:
        collect(store, fixture_fetcher(FIXTURES), NOW)
        result = collect(store, broken, NOW)
        assert result.status == "failed"
        assert result.errors == [f"index: {INDEX_URL}: HTTP 503"]
        assert len(load_messages(store)) == 13


def test_missing_document_makes_the_round_degraded(tmp_path):
    base = fixture_fetcher(FIXTURES)

    def flaky(url):
        if url.endswith("CAPTMD20260925163420_2.xml"):
            raise FetchError(f"{url}: HTTP 500")
        return base(url)

    with StateStore(tmp_path / "s.db") as store:
        result = collect(store, flaky, NOW)
        assert (result.status, result.fetched, result.rejected) == ("degraded", 12, 1)
```

- [ ] **Step 2: Run** `uv run pytest tests/test_tmd_cap_fetch.py tests/test_tmd_cap_collect.py` · Expected: FAIL (modules not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/sources/tmd_cap/fetch.py
"""HTTP access for the TMD CAP feed: allowlisted links, size limit and clear errors."""

from __future__ import annotations

import ssl
from collections.abc import Callable
from importlib import resources
from pathlib import Path
from urllib.parse import urlsplit

import certifi
import httpx

INDEX_URL = "https://www.tmd.go.th/api/xml/CAP"
ALLOWED_HOSTS = frozenset({"www.tmd.go.th", "tmd.go.th"})
CAP_PATH_PREFIX = "/uploads/CAP/"
MAX_BYTES = 5_000_000
USER_AGENT = "fontokmai/0.1 (+https://github.com/dizconnectz/fontokmai)"
# www.tmd.go.th sends only its leaf certificate (checked 2026-09-25); see certs/ for the provenance.
EXTRA_INTERMEDIATE = "globalsign-gcc-r6-alphassl-ca-2025.pem"

Fetcher = Callable[[str], bytes]


class FetchError(RuntimeError):
    """A source document could not be fetched."""


def is_allowed_cap_url(url: str) -> bool:
    parts = urlsplit(url)
    return (parts.scheme == "https" and parts.hostname in ALLOWED_HOSTS
            and parts.path.startswith(CAP_PATH_PREFIX) and parts.path.endswith(".xml"))


def make_ssl_context() -> ssl.SSLContext:
    """Normal certificate verification plus the public intermediate that www.tmd.go.th does not send.

    The intermediate only helps to build the chain: verification still has to end at a trusted root,
    and hostname checking stays on.
    """
    ctx = ssl.create_default_context(cafile=certifi.where())
    text = resources.files("fontokmai.sources.tmd_cap").joinpath("certs", EXTRA_INTERMEDIATE).read_text("ascii")
    ctx.load_verify_locations(cadata=text[text.index("-----BEGIN CERTIFICATE-----"):])
    return ctx


def get_bytes(client: httpx.Client, url: str, max_bytes: int = MAX_BYTES) -> bytes:
    chunks: list[bytes] = []
    try:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise FetchError(f"{url}: HTTP {resp.status_code}")
            total = 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise FetchError(f"{url}: larger than {max_bytes} bytes")
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise FetchError(f"{url}: {exc.__class__.__name__}: {exc}") from exc
    return b"".join(chunks)


class LiveFetcher:
    """Fetch over verified HTTPS; redirects are not followed."""

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(30.0),
                                    verify=make_ssl_context(), transport=transport)

    def __call__(self, url: str) -> bytes:
        return get_bytes(self._client, url)

    def close(self) -> None:
        self._client.close()


def fixture_fetcher(directory: Path, index_name: str = "index.xml") -> Fetcher:
    """Serve the index and CAP documents from a local directory (tests, examples and replay)."""

    def fetch(url: str) -> bytes:
        name = index_name if url == INDEX_URL else urlsplit(url).path.rsplit("/", 1)[-1]
        path = directory / name
        if not path.is_file():
            raise FetchError(f"{url}: not in fixtures")
        return path.read_bytes()

    return fetch
```

```python
# file: pipeline/src/fontokmai/sources/tmd_cap/collect.py
"""One collection round of the TMD CAP feed: index → allowed links → new documents (design 9.2)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from fontokmai.sources.tmd_cap.fetch import INDEX_URL, Fetcher, FetchError, is_allowed_cap_url
from fontokmai.sources.tmd_cap.index import parse_index
from fontokmai.sources.tmd_cap.parser import CapMessage, CapParseError, parse_cap
from fontokmai.state import StateStore


@dataclass
class CollectResult:
    index_ok: bool = False
    items_seen: int = 0
    fetched: int = 0
    rejected: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if not self.index_ok:
            return "failed"
        return "degraded" if self.rejected else "ok"


def collect(store: StateStore, fetch: Fetcher, now: datetime) -> CollectResult:
    """Documents that dropped off the index stay stored; an event never ends just by leaving the index."""
    result = CollectResult()
    try:
        items = parse_index(fetch(INDEX_URL))
    except (FetchError, ValueError) as exc:
        result.errors.append(f"index: {exc}")
        return result
    result.index_ok = True
    result.items_seen = len(items)
    for item in items:
        if not is_allowed_cap_url(item.link):
            result.rejected += 1
            result.errors.append(f"link not allowed: {item.link}")
            continue
        if item.guid and store.has_cap_document(item.guid):
            continue
        try:
            raw = fetch(item.link)
            msg = parse_cap(raw)
        except (FetchError, CapParseError) as exc:
            result.rejected += 1
            result.errors.append(str(exc))
            continue
        if store.add_cap_document(identifier=msg.identifier, sender=msg.sender, sent=msg.sent, raw=raw,
                                  source_url=item.link, seen_at=now):
            result.fetched += 1
    return result


def load_messages(store: StateStore) -> list[tuple[CapMessage, str]]:
    return [(parse_cap(raw), url) for raw, url in store.cap_documents()]
```

- [ ] **Step 4: Run** `uv run pytest tests/test_tmd_cap_fetch.py tests/test_tmd_cap_collect.py` · Expected: PASS
- [ ] **Step 4b: ใบรับรอง** (พบตอนลองกับเว็บจริงใน Task 10) — `www.tmd.go.th` ส่งใบรับรองมาแค่ใบปลาย จึงแนบใบกลางสาธารณะ `certs/globalsign-gcc-r6-alphassl-ca-2025.pem` (ตรวจด้วย `openssl verify` กับใบรากของ certifi แล้ว) และให้ `make_ssl_context()` ใช้ร่วมกับการตรวจปกติ ไม่ปิดการตรวจใบรับรอง · เพิ่ม `certifi` (MPL-2.0 แบบรายไฟล์ ไม่กระทบ license ของเรา) เป็น dependency ตรง
- [ ] **Step 5: Commit** `feat(tmd-cap): allowlisted fetch and collection round`

### Task 9: เขียน snapshot

**Files:** Create `pipeline/src/fontokmai/publish/snapshot.py`, Test `pipeline/tests/test_snapshot.py`

- [ ] **Step 1: failing test**

```python
# file: pipeline/tests/test_snapshot.py
import hashlib
from datetime import datetime, timedelta

from fontokmai.contracts.common import SourceStatus
from fontokmai.contracts.manifest import Manifest
from fontokmai.publish.snapshot import write_snapshot
from fontokmai.state import StateStore

NOW = datetime.fromisoformat("2026-09-25T18:20:00+07:00")
BASE = {"generation_id": "20260925T112000Z-local", "now": NOW, "writer": "local", "owner_epoch": 1,
        "recovery_epoch": 1, "due": timedelta(minutes=15)}


def _status(state="ok"):
    return SourceStatus(source_id="tmd_cap", status=state, last_attempt_at=NOW, last_success_at=NOW,
                        items_seen=13, items_rejected=0)


def test_snapshot_writes_files_then_matching_manifest(tmp_path):
    out = tmp_path / "out"
    with StateStore(tmp_path / "s.db") as store:
        manifest = write_snapshot(out, {"alerts.json": b'{"a":1}'}, store, source_status=[_status()], **BASE)
    on_disk = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert on_disk == manifest
    (entry,) = on_disk.files
    assert (entry.path, entry.size, entry.revision) == ("alerts.json", 7, 1)
    assert entry.sha256 == hashlib.sha256(b'{"a":1}').hexdigest()
    assert (on_disk.generation_id, on_disk.completeness) == ("20260925T112000Z-local", "complete")
    assert on_disk.next_due_at == NOW + timedelta(minutes=15)
    assert sorted(p.name for p in out.iterdir()) == ["alerts.json", "manifest.json"]


def test_file_revision_follows_content_and_degraded_source_marks_partial(tmp_path):
    out = tmp_path / "out"
    with StateStore(tmp_path / "s.db") as store:
        write_snapshot(out, {"alerts.json": b"1"}, store, source_status=[_status()], **BASE)
        same = write_snapshot(out, {"alerts.json": b"1"}, store, source_status=[_status()], **BASE)
        changed = write_snapshot(out, {"alerts.json": b"2"}, store, source_status=[_status("degraded")], **BASE)
    assert same.files[0].revision == 1
    assert (changed.files[0].revision, changed.completeness) == (2, "partial")
```

- [ ] **Step 2: Run** `uv run pytest tests/test_snapshot.py` · Expected: FAIL (module not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/publish/snapshot.py
"""Write one complete snapshot generation: data files first, manifest.json last (design 4.4-4.5)."""

from __future__ import annotations

import hashlib
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from fontokmai.contracts.common import SourceStatus
from fontokmai.contracts.manifest import Manifest, ManifestFile
from fontokmai.state import StateStore


def atomic_write(path: Path, content: bytes) -> None:
    """Write through a temporary file in the same directory, fsync, then rename over the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_snapshot(out_dir: Path, files: dict[str, bytes], store: StateStore, *, generation_id: str,
                   now: datetime, writer: str, owner_epoch: int, recovery_epoch: int, due: timedelta,
                   source_status: list[SourceStatus]) -> Manifest:
    entries = []
    for rel in sorted(files):
        content = files[rel]
        digest = hashlib.sha256(content).hexdigest()
        atomic_write(out_dir / rel, content)
        entries.append(ManifestFile(path=rel, sha256=digest, size=len(content),
                                    revision=store.file_revision(rel, digest, now)))
    complete = all(s.status == "ok" for s in source_status)
    manifest = Manifest(generation_id=generation_id, generated_at=now, next_due_at=now + due, writer=writer,
                        owner_epoch=owner_epoch, recovery_epoch=recovery_epoch,
                        completeness="complete" if complete else "partial", files=entries,
                        source_status=source_status)
    atomic_write(out_dir / "manifest.json", manifest.model_dump_json().encode("utf-8"))
    return manifest
```

- [ ] **Step 4: Run** `uv run pytest tests/test_snapshot.py` · Expected: PASS
- [ ] **Step 5: Commit** `feat(publish): atomic snapshot writer with manifest last`

### Task 10: หนึ่งรอบของ slice, ตัวอย่างสำหรับ consumer และ CLI

**Files:** Create `pipeline/src/fontokmai/run.py`, `pipeline/src/fontokmai/examples.py`, `pipeline/src/fontokmai/cli.py`, Test `pipeline/tests/test_cli.py`, `pipeline/tests/test_examples.py`

- [ ] **Step 1: failing tests**

```python
# file: pipeline/tests/test_cli.py
import json

from fontokmai.cli import main
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
```

```python
# file: pipeline/tests/test_examples.py
import json

from fontokmai.examples import SCENARIOS, write_examples
from helpers import FIXTURES, SYNTHETIC


def _expected(out, name):
    return json.loads((out / name / "expected.json").read_text(encoding="utf-8"))


def test_examples_cover_every_scenario(tmp_path):
    write_examples(tmp_path, real=FIXTURES, synthetic=SYNTHETIC)
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(SCENARIOS)
    assert [a["lifecycle_status"] for a in _expected(tmp_path, "active")["visible_alerts"]] == ["active"] * 3
    assert "pending" in [a["lifecycle_status"] for a in _expected(tmp_path, "pending")["visible_alerts"]]
    expired = _expected(tmp_path, "expired")
    assert expired["visible_alerts"] == [] and len(expired["ended_events"]) == 9
    failed = _expected(tmp_path, "source-failed")
    assert (failed["completeness"], failed["source_status"][0]["status"]) == ("partial", "failed")
    assert failed["source_status"][0]["last_success_at"] == "2026-09-25T18:05:00+07:00"
    for name in ("cancelled", "out-of-order"):
        e = _expected(tmp_path, name)
        assert e["visible_alerts"] == []
        assert e["ended_events"] == [{"event_id": "tmd:SYN20260925100000_1", "lifecycle_status": "cancelled",
                                      "ended_at": "2026-09-25T12:00:00+07:00"}]
    assert _expected(tmp_path, "mixed-generation")["generation_match"] is False
    assert _expected(tmp_path, "active")["generation_match"] is True


def test_examples_are_reproducible(tmp_path):
    write_examples(tmp_path / "a", real=FIXTURES, synthetic=SYNTHETIC)
    write_examples(tmp_path / "b", real=FIXTURES, synthetic=SYNTHETIC)
    for path in sorted((tmp_path / "a").rglob("*.json")):
        assert path.read_bytes() == (tmp_path / "b" / path.relative_to(tmp_path / "a")).read_bytes()
```

- [ ] **Step 2: Run** `uv run pytest tests/test_cli.py tests/test_examples.py` · Expected: FAIL (modules not found)

- [ ] **Step 3: implementation**

```python
# file: pipeline/src/fontokmai/run.py
"""One snapshot round of the TMD CAP slice, shared by the CLI and the contract examples."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fontokmai.contracts.alerts import AlertsFeed
from fontokmai.contracts.common import SourceStatus
from fontokmai.contracts.manifest import Manifest
from fontokmai.feeds.alerts import assemble_alerts_feed
from fontokmai.publish.snapshot import write_snapshot
from fontokmai.sources.tmd_cap.collect import collect, load_messages
from fontokmai.sources.tmd_cap.fetch import Fetcher
from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from fontokmai.state import StateStore

SNAPSHOT_INTERVAL = timedelta(minutes=15)
LAST_SUCCESS_KEY = "tmd_cap.last_success_at"
RECOVERY_EPOCH_KEY = "recovery_epoch"


@dataclass(frozen=True)
class SnapshotResult:
    manifest: Manifest
    feed: AlertsFeed
    status: SourceStatus


def generation_id_for(now: datetime, writer: str) -> str:
    return f"{now.astimezone(UTC):%Y%m%dT%H%M%SZ}-{writer}"


def run_cap_snapshot(*, db: Path, out: Path, fetch: Fetcher, now: datetime, writer: str,
                     owner_epoch: int) -> SnapshotResult:
    if now.tzinfo is None:
        raise ValueError("now must carry a UTC offset")
    generation_id = generation_id_for(now, writer)
    with StateStore(db) as store:
        result = collect(store, fetch, now)
        if result.index_ok:
            store.set_meta(LAST_SUCCESS_KEY, now.isoformat())
        last_success = store.get_meta(LAST_SUCCESS_KEY)
        recovery_epoch = int(store.get_meta(RECOVERY_EPOCH_KEY) or "1")
        status = SourceStatus(
            source_id="tmd_cap", status=result.status, last_attempt_at=now,
            last_success_at=datetime.fromisoformat(last_success) if last_success else None,
            items_seen=result.items_seen, items_rejected=result.rejected,
            message="; ".join(result.errors[:3]) or None,
        )
        pairs = load_messages(store)
        urls = {msg.key: url for msg, url in pairs}
        candidates = alert_candidates(group_events(msg for msg, _ in pairs), urls, now)
        feed = assemble_alerts_feed(candidates, store, now=now, generation_id=generation_id,
                                    recovery_epoch=recovery_epoch, source_status=[status])
        manifest = write_snapshot(out, {"alerts.json": feed.model_dump_json().encode("utf-8")}, store,
                                  generation_id=generation_id, now=now, writer=writer,
                                  owner_epoch=owner_epoch, recovery_epoch=recovery_epoch,
                                  due=SNAPSHOT_INTERVAL, source_status=[status])
    return SnapshotResult(manifest=manifest, feed=feed, status=status)
```

```python
# file: pipeline/src/fontokmai/examples.py
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
```

```python
# file: pipeline/src/fontokmai/cli.py
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
```

- [ ] **Step 4: Run** `uv run pytest` (ทั้งชุด) และ `uv run ruff check .` · Expected: PASS ทั้งหมด, ruff ไม่มีข้อผิดพลาด
- [ ] **Step 5: ลองกับแหล่งจริงหนึ่งรอบ** `uv run fontokmai cap-snapshot --db ../state/dev.db --out ../out/data/v1` · Expected: JSON สรุปที่ `source_status` เป็น `ok` (ถ้าเว็บกรมอุตุฯ ปฏิเสธ User-Agent ให้บันทึกผลและ status code ไว้ ไม่เปลี่ยนเป็น browser UA)
- [ ] **Step 6: Commit** `feat(cli): cap-snapshot, contract examples and schema export`

### Task 11: ชุดสัญญาที่ส่งให้ Codex (`contracts/v1`)

**Files:** Create `scripts/gen-ts-types.sh`, `contracts/v1/README.md` · Generate `contracts/v1/schema/*.json`, `contracts/v1/ts/*.ts`, `contracts/v1/examples/*/`

- [ ] **Step 1: ตัวสร้าง TypeScript**

```bash
# file: scripts/gen-ts-types.sh
#!/usr/bin/env bash
# Generate TypeScript types from the JSON Schemas of the public contract. Do not edit the output by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p contracts/v1/ts
for name in alerts manifest; do
  npx --yes -p json-schema-to-typescript@16.0.0 json2ts \
    --input "contracts/v1/schema/${name}.schema.json" \
    --output "contracts/v1/ts/${name}.ts" \
    --bannerComment "/* Generated from contracts/v1/schema/${name}.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */"
done
```

- [ ] **Step 2: สร้างไฟล์ทั้งหมด**

```bash
cd pipeline
uv run fontokmai export-schemas --out ../contracts/v1/schema
uv run fontokmai contract-examples --out ../contracts/v1/examples --real-fixtures tests/fixtures/tmd_cap --synthetic-fixtures tests/fixtures/tmd_cap_synthetic
cd .. && bash scripts/gen-ts-types.sh
```
Expected: `contracts/v1/schema/{alerts,manifest}.schema.json`, `contracts/v1/ts/{alerts,manifest}.ts` และตัวอย่าง 7 ชุด ชุดละ `manifest.json`, `alerts.json`, `expected.json`

- [ ] **Step 3: เขียน `contracts/v1/README.md`** อธิบายความหมาย: data base URL และลำดับการโหลด (manifest → ไฟล์ → ตรวจ `generation_id`), stale = `now > next_due_at + 15 นาที`, complete/partial, เวลา (ISO 8601 มี offset: เวลาจาก CAP คง +07:00 เวลาที่เราสร้างเป็น UTC `Z`), geometry `[lon, lat]`, event/message/revision, `feed_sequence` กับ `recovery_epoch` (เพิ่ม epoch = ล้างสถานะแล้ว resync), pending/active/expired/cancelled, `default_24h`, ส่วนที่ยังไม่รองรับใน slice นี้ (forecast, risk, สถานี, เขื่อน = ไม่อยู่ใน manifest → แสดง “ยังไม่มีข้อมูล”) และตารางตัวอย่าง 7 ชุด
- [ ] **Step 4: Commit** `feat(contracts): v1 schema, TypeScript types, examples and consumer notes`

### Task 12: CI และ README

**Files:** Create `.github/workflows/ci.yml`, `README.md`, `pipeline/README.md`

- [ ] **Step 1: workflow**

```yaml
# file: .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  pipeline:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: pipeline
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      - run: uv sync --locked
      - run: uv run ruff check .
      - run: uv run pytest
      - name: Dependency licenses (no GPL family)
        run: uv run --with pip-licenses pip-licenses --partial-match --fail-on "GPL"
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      - name: Regenerate schema, examples and TypeScript
        run: |
          cd pipeline
          uv sync --locked
          uv run fontokmai export-schemas --out ../contracts/v1/schema
          uv run fontokmai contract-examples --out ../contracts/v1/examples --real-fixtures tests/fixtures/tmd_cap --synthetic-fixtures tests/fixtures/tmd_cap_synthetic
          cd ..
          bash scripts/gen-ts-types.sh
      - name: Generated files must be committed
        run: git diff --exit-code -- contracts/
  repo-safety:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: python3 scripts/check_repo_safety.py
```

- [ ] **Step 2: README** ภาษาไทยสั้นๆ: เว็บคืออะไร, สถานะ P0, ลิงก์เอกสาร, วิธีรันใน `pipeline/`, license (PolyForm NC + CC BY-NC, Required Notice), “ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยาหรือหน่วยงานอื่น”
- [ ] **Step 3: Run** `python scripts/check_repo_safety.py` · Expected: `repo safety: OK`
- [ ] **Step 4: Commit** `ci: lint, tests, contract drift, dependency licenses and repo safety`

### Task 13: แก้แบบตามรีวิว v6 (F1–F5 เฉพาะส่วนที่เป็นข้อความ)

- [ ] F1 → design 4.4: generation ที่เผยแพร่สำเร็จคือ high-water mark, กู้แล้วต่อค่าไม่ต่ำกว่าที่ปลายทางยอมรับ, กู้ไม่ได้ให้เพิ่ม `recovery_epoch` และรายงานข้อมูลสูญ · token ของ Cloudflare Direct Upload มีสิทธิ์ระดับบัญชี (Pages Edit) ต้องบันทึกขอบเขตจริงก่อนออก token
- [ ] F2 → design 4.9: reserve มาก่อนเกณฑ์ 80/85/90 (ไม่เริ่มงานเขียนที่จะกิน reserve และหยุดงานเขียนของ fontokmai เมื่อถึง reserve)
- [ ] F3 → design 7.5 แถวคลอง: `P > 100` = เกินตลิ่ง (`= 100` = ถึงระดับตลิ่ง) และ S ต้องครอบคลุมต้นและท้ายช่วง 2 ชม. พร้อม `actual_duration`/`sample_count`/`max_gap`
- [ ] F4 → design 7.5 นิยาม: completeness ก่อน aggregate (false ได้เมื่อครบทุกชั่วโมงเท่านั้น), t0 ไม่ตรงชั่วโมง, `freshness_unknown`, โมเดลเดียวคง `insufficient`, hysteresis ใช้เวลาจริง ≥ 30 นาที
- [ ] F5 → sources แถว ThaiWater, design 3 (P0 ลำดับที่ 5), 4.5, 6.3 และ 15: private ไม่ใช่ใบอนุญาต แยกสิทธิ์จัดเก็บ/ประมวลผล/เผยแพร่/สำรองนอกเครื่อง และ archive ทั่วประเทศที่เป็นสรุปรายวันไม่พอสำหรับตัวชี้วัดรายโมเดล/ENS
- [ ] Commit `docs(design): close v6 review details F1-F5 at design level`

### Task 14: ขึ้น GitHub

- [ ] **Step 1** `gh repo create dizconnectz/fontokmai-private --private` แล้ว push `private/` (branch `main`)
- [ ] **Step 2** รัน `python scripts/check_repo_safety.py` อีกครั้ง และตรวจ `git ls-files` ว่าไม่มี `private/`, `.env`, state หรือไฟล์ดิบขนาดใหญ่
- [ ] **Step 3** `gh repo create dizconnectz/fontokmai --public --source . --remote origin --push --description "ฝนตกไหม — Thai rain and flood tracker (noncommercial)"`
- [ ] **Step 4** `gh run watch` ให้ CI ผ่านทุก job · Expected: pipeline, contracts, repo-safety = success

### Task 15: ส่งต่องาน

- [ ] AGENTS.md: ปล่อย claim, บันทึก A6 (ทำอะไร/ไฟล์/ผลทดสอบจริง/ข้อจำกัด/ขั้นต่อไป), ย้าย A6 เก่าไป `private/handoffs/README.md`, C2 ให้ Codex เริ่ม `apps/web` ตามสัญญาใน `contracts/v1/`, D = P0-B (ติดตั้งบน VPS + เผยแพร่ + takeover/restore)
- [ ] ตรวจขนาด AGENTS.md < 32 KiB และ repo safety ผ่าน แล้ว commit + push
