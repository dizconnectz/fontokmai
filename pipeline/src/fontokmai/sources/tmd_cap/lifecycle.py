"""Group TMD CAP messages into event lineages and derive alert payloads (design 9.1-9.2)."""

from __future__ import annotations

import re
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


# Thai provinces in ISO 3166-2 (TH-10 … TH-96, TH-S). TMD has also sent region codes such as "R-04" under the
# ISO3166-2 name; they are not provinces, so they are left out of targets and the alert gets a qc flag.
_PROVINCE_CODE = re.compile(r"^TH-[0-9A-Z]{1,2}$")


def _targets(info: CapInfo) -> tuple[list[dict[str, str]], list[str]]:
    codes: list[str] = []
    flags: list[str] = []
    for area in info.areas:
        for name, value in area.geocodes:
            if name.upper() != "ISO3166-2" or value in codes:
                continue
            if _PROVINCE_CODE.match(value):
                codes.append(value)
            elif "geocode_not_a_province" not in flags:
                flags.append("geocode_not_a_province")
    return [{"kind": "province", "code": code} for code in codes], flags


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
        targets, target_flags = _targets(info)
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
            "qc_flags": flags + target_flags,
            "targets": targets,
            "geometry": _geometry(info),
            "source_url": urls[current.key],
            "credit_th": CREDIT_TH,
            "notify_eligible": False,
        }
        candidates.append(AlertCandidate(lineage.event_id, payload, ended_at=ended_at))
    return candidates
