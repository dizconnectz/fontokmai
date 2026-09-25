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
