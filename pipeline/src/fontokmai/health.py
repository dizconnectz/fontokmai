"""How close the collector's container is to its process limit (the cgroup v2 pids controller).

On 2026-10-01 the git processes that git 2.47 leaves running after each commit (its detached auto-maintenance) were
never reaped, filled the container's 128-process limit and stopped every publish for 12 hours. The container now has
an init that reaps them (deploy/vps/compose.yaml), git is told not to start them (publish/git_pages.py), and each
round reads this so that the collector restarts itself well before the limit (cli.py, schedule.py).
"""

from __future__ import annotations

from pathlib import Path

CGROUP = Path("/sys/fs/cgroup")


def process_pressure(root: Path = CGROUP) -> tuple[int, int] | None:
    """(tasks in this container now, its limit), or None where there is no limit to read (not in a container)."""
    try:
        current = int((root / "pids.current").read_text(encoding="ascii").strip())
        limit = (root / "pids.max").read_text(encoding="ascii").strip()
        return None if limit == "max" else (current, int(limit))
    except (OSError, ValueError):
        return None
