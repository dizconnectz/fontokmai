"""M10: the Open-Meteo call budget holds across failed runs, retries and restarts (fake clock and opener)."""

import io
import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from fontokmai.contracts.forecast import ForecastLattice
from fontokmai.forecast_build import refresh_rain_forecast
from fontokmai.sources.call_budget import BudgetExceeded, CallBudget
from fontokmai.sources.open_data.http import OpenDataError
from fontokmai.state import StateStore

T0 = datetime.fromisoformat("2026-09-26T06:00:00+07:00")
# 250 points: batches of 100, 100 and 50
LATTICE = (ForecastLattice(west=100.0, south=13.0, step=0.25), [[c, r] for r in range(10) for c in range(25)])


def failing_last_batch(requests: list[str]):
    """Answers every batch except the last one of a run, like a service that keeps failing late."""

    @contextmanager
    def opener(url):
        requests.append(url)
        points = len(parse_qs(urlparse(url).query)["latitude"][0].split(","))
        if points < 100:
            raise OpenDataError(f"{url}: HTTP 500")
        yield io.BytesIO(json.dumps([{}] * points).encode())

    return opener


def test_the_budget_rolls_over_24_hours_and_survives_a_restart(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        budget = CallBudget(store, "calls", 1_000)
        budget.spend(T0, 600)
        assert budget.allows(T0, 400) and not budget.allows(T0, 401)
        with pytest.raises(BudgetExceeded):
            budget.spend(T0 + timedelta(hours=1), 401)
    with StateStore(tmp_path / "s.db") as store:  # the service restarted
        budget = CallBudget(store, "calls", 1_000)
        assert budget.used(T0 + timedelta(hours=23)) == 600
        assert budget.used(T0 + timedelta(hours=24)) == 0


def test_an_unreadable_count_waits_a_day_rather_than_risk_going_over(tmp_path):
    with StateStore(tmp_path / "s.db") as store:
        store.set_meta("calls", "not json")
        budget = CallBudget(store, "calls", 1_000)
        assert not budget.allows(T0, 1)


def test_failing_runs_retry_every_two_hours_but_never_go_over_the_daily_budget(tmp_path):
    requests: list[str] = []
    opener = failing_last_batch(requests)
    log = []
    for step in range(24):  # every hour for a day
        now = T0 + timedelta(hours=step)
        log.append(refresh_rain_forecast(tmp_path / "out", tmp_path / "s.db", now, opener=opener,
                                         lattice=LATTICE, pause=0, limit=1_000))
    attempts = [line for line in log if line and line.startswith("error:")]
    # 250 calls per run (the failed batch counts): 4 runs fit in 1,000, the 5th waits for the window
    assert len(attempts) == 4
    assert all("Open-Meteo batch 3/3" in line for line in attempts)
    assert any(line.startswith("waiting for the Open-Meteo budget: 1000 of 1000") for line in log)
    points = sum(len(parse_qs(urlparse(url).query)["latitude"][0].split(",")) for url in requests)
    assert points == 1_000
    with StateStore(tmp_path / "s.db") as store:
        assert CallBudget(store, "open_meteo_calls", 1_000).used(T0 + timedelta(hours=23)) == 1_000


def test_a_restart_does_not_retry_before_two_hours(tmp_path):
    requests: list[str] = []
    opener = failing_last_batch(requests)
    first = refresh_rain_forecast(tmp_path / "out", tmp_path / "s.db", T0, opener=opener, lattice=LATTICE,
                                  pause=0, limit=10_000)
    assert first and first.startswith("error:")
    # a new process (nothing kept in memory) half an hour later
    again = refresh_rain_forecast(tmp_path / "out", tmp_path / "s.db", T0 + timedelta(minutes=30),
                                  opener=opener, lattice=LATTICE, pause=0, limit=10_000)
    assert again == "waiting to retry"
    assert len(requests) == 3


def test_a_run_stops_at_the_batch_that_would_go_over(tmp_path):
    requests: list[str] = []
    with StateStore(tmp_path / "s.db") as store:
        CallBudget(store, "open_meteo_calls", 1_000).spend(T0 - timedelta(hours=1), 820)
    # 180 left: the run is refused up front, before any request
    line = refresh_rain_forecast(tmp_path / "out", tmp_path / "s.db", T0, opener=failing_last_batch(requests),
                                 lattice=LATTICE, pause=0, limit=1_000)
    assert line == "waiting for the Open-Meteo budget: 820 of 1000 calls used in 24 hours"
    assert requests == []
