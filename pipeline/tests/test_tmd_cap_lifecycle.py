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
