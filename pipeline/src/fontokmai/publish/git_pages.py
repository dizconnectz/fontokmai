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
