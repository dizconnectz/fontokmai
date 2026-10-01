"""A stuck publish heals itself (2026-10-01: git's leftover processes filled the container and the site stayed 12 hours
at the same data): git starts nothing in the background and cannot hang a round, and the collector restarts itself
after failed publishes in a row or near its process limit."""

import json
import subprocess
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from fontokmai import cli
from fontokmai.health import process_pressure
from fontokmai.publish import git_pages
from fontokmai.schedule import RESTART_EXIT, run_forever

NOW = datetime(2026, 10, 1, 3, 48, tzinfo=UTC)


def test_git_starts_no_background_maintenance_and_cannot_hang_a_round(tmp_path, monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs.get("timeout")))
        return SimpleNamespace(returncode=0, stdout="abc\n", stderr="")

    monkeypatch.setattr(git_pages.subprocess, "run", fake_run)
    assert git_pages._git(tmp_path, "commit", "-m", "x") == "abc"
    (command, timeout), = calls
    assert command[:5] == ["git", "-c", "maintenance.auto=false", "-c", "gc.auto=0"] and command[5] == "commit"
    assert timeout == git_pages.GIT_TIMEOUT_S

    def hang(command, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(git_pages.subprocess, "run", hang)
    with pytest.raises(git_pages.PublishError, match="push did not finish in 300 s"):
        git_pages._git(tmp_path, "push", "origin")


def test_the_process_limit_is_read_from_the_containers_cgroup(tmp_path):
    (tmp_path / "pids.current").write_text("103\n", encoding="ascii")
    (tmp_path / "pids.max").write_text("128\n", encoding="ascii")
    assert process_pressure(tmp_path) == (103, 128)
    (tmp_path / "pids.max").write_text("max\n", encoding="ascii")
    assert process_pressure(tmp_path) is None  # no limit to come near
    assert process_pressure(tmp_path / "missing") is None  # not in a container


def test_a_round_that_asks_for_a_restart_is_logged_and_ends_the_process():
    logged = []
    start = datetime(2026, 10, 1, 3, 47, 59, tzinfo=UTC)
    with pytest.raises(SystemExit) as stop:
        run_forever(lambda now: {"restart": "publishing failed 3 rounds in a row"}, clock=lambda: start,
                    sleep=lambda s: None, log=logged.append, max_rounds=5)
    assert stop.value.code == RESTART_EXIT
    (record,) = [json.loads(line) for line in logged]  # one round, logged before the process ends
    assert record["ok"] is True and record["restart"] == "publishing failed 3 rounds in a row"

    def failing(now):
        error = OSError("git host unreachable")
        error.round_summary = {"restart": "publishing failed 3 rounds in a row"}
        raise error

    logged.clear()
    with pytest.raises(SystemExit):
        run_forever(failing, clock=lambda: start, sleep=lambda s: None, log=logged.append, max_rounds=5)
    (record,) = [json.loads(line) for line in logged]
    assert record["ok"] is False and record["error"] == "OSError: git host unreachable" and record["restart"]


def _job(tmp_path, monkeypatch, publish, pressure=None):
    """The scheduled job with the snapshot, housekeeping and the process limit replaced: only publishing runs."""
    monkeypatch.setattr(cli, "LiveFetcher", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(cli, "run_cap_snapshot", lambda **kwargs: SimpleNamespace(
        manifest=SimpleNamespace(generation_id="g")))
    monkeypatch.setattr(cli, "_summary", lambda result: {"generation_id": "g"})
    monkeypatch.setattr(cli, "housekeeping", lambda *args, **kwargs: {"done": ""})
    monkeypatch.setattr(cli, "process_pressure", lambda: pressure)
    monkeypatch.setattr(cli, "publish_snapshot", publish)
    args = cli._parse_args(["schedule", "--db", str(tmp_path / "s.db"), "--out", str(tmp_path / "v1"),
                            "--publish-remote", "git@example.test:data.git", "--publish-work", str(tmp_path / "p")])
    return cli._scheduled_job(args)


def test_three_failed_publishes_in_a_row_ask_for_a_restart_and_a_success_starts_the_count_again(tmp_path,
                                                                                               monkeypatch):
    results = ["fail", "fail", "ok", "fail", "fail", "fail"]

    def publish(*args, **kwargs):
        if results.pop(0) == "fail":
            raise OSError("cannot fork()")
        return "0123456789abcdef"

    job = _job(tmp_path, monkeypatch, publish)
    restarts = []
    for _ in range(6):
        try:
            restarts.append(job(NOW).get("restart"))
        except OSError as error:
            restarts.append(error.round_summary.get("restart"))
    assert restarts == [None, None, None, None, None, "publishing failed 3 rounds in a row"]


def test_a_container_near_its_process_limit_asks_for_a_restart(tmp_path, monkeypatch):
    summary = _job(tmp_path, monkeypatch, lambda *a, **k: "0123456789abcdef", pressure=(103, 128))(NOW)
    assert summary["published"] == "0123456789ab" and summary["processes"] == "103/128"
    assert summary["restart"] == "103 of the container's 128 processes in use"
    calm = _job(tmp_path, monkeypatch, lambda *a, **k: "0123456789abcdef", pressure=(3, 128))(NOW)
    assert calm["processes"] == "3/128" and "restart" not in calm
