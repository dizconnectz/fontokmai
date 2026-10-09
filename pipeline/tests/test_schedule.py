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


def test_a_round_starts_early_once_new_data_is_ready_and_the_slot_after_it_is_skipped():
    """User 2026-10-09: TMD posts a radar frame about 12 minutes after its time; the round should not wait for the
    next slot. Here the frame of 12:00 is ready at 12:12 and the one of 12:15 at 12:27."""
    clock = FakeClock(T("2026-09-25T12:05:00+00:00"))
    calls, logs, asked = [], [], []
    ready_at = [T("2026-09-25T12:12:00+00:00"), T("2026-09-25T12:27:00+00:00")]

    def ready(now):
        asked.append(now)
        return any(at <= now and not any(c >= at for c in calls) for at in ready_at)

    run_forever(lambda started: calls.append(started) or {}, clock=clock, sleep=clock.sleep, log=logs.append,
                max_rounds=3, ready=ready)
    # 12:12 early, the 12:18 slot skipped (6 minutes after it), 12:27 early, the 12:33 slot skipped, then 12:48
    assert calls == [T("2026-09-25T12:12:00+00:00"), T("2026-09-25T12:27:00+00:00"),
                     T("2026-09-25T12:48:00+00:00")]
    assert '"early"' in logs[0] and '"slot": "2026-09-25T12:12:00+00:00"' in logs[0]
    assert '"early"' not in logs[2] and '"slot": "2026-09-25T12:48:00+00:00"' in logs[2]
    # asked once a minute, and never within 10 minutes of a round's start
    assert all(not T("2026-09-25T12:12:00+00:00") < at < T("2026-09-25T12:22:00+00:00") for at in asked)


def _rounds_with(ready) -> list[datetime]:
    clock = FakeClock(T("2026-09-25T12:00:00+00:00"))
    calls: list[datetime] = []
    run_forever(lambda started: calls.append(started) or {}, clock=clock, sleep=clock.sleep, log=lambda line: None,
                max_rounds=2, ready=ready)
    return calls


def test_a_check_that_says_nothing_or_fails_leaves_the_grid_as_it_was():
    def down(now):
        raise OSError("TMD down")

    for ready in (lambda now: False, down):
        assert _rounds_with(ready) == [T("2026-09-25T12:03:00+00:00"), T("2026-09-25T12:18:00+00:00")]


def test_a_clock_that_does_not_move_still_reaches_the_slot_with_a_check_given():
    """The wait also counts what it slept: a frozen clock (as in the scheduled-job tests) cannot keep it going."""
    start = T("2026-09-25T11:19:59+00:00")
    calls = []
    run_forever(lambda started: calls.append(started) or {}, clock=lambda: start, sleep=lambda seconds: None,
                log=lambda line: None, max_rounds=1, ready=lambda now: False)
    assert calls == [start]
