import dataclasses
from datetime import datetime

from fontokmai.run import _valid_candidates
from fontokmai.sources.tmd_cap.lifecycle import alert_candidates, group_events
from helpers import real_messages

T = datetime.fromisoformat


def test_an_alert_that_breaks_the_contract_is_left_out_not_the_whole_round():
    pairs = real_messages()
    urls = {m.key: url for m, url in pairs}
    candidates = alert_candidates(group_events(m for m, _ in pairs), urls, T("2026-09-25T18:20:00+07:00"))
    live = next(c for c in candidates if c.payload["lifecycle_status"] == "active")
    bad = dataclasses.replace(live, payload={**live.payload, "targets": [{"kind": "province", "code": "R-04"}]})
    others = [c for c in candidates if c.event_id != live.event_id]
    valid, broken = _valid_candidates([bad, *others])
    assert valid == others
    assert broken == [f"{live.event_id}: targets.0.code String should match pattern '^TH-[0-9A-Z]{{1,2}}$'"]
