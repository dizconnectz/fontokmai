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
