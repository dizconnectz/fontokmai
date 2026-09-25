"""Parse CAP 1.2 documents published by TMD (design 9.2)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime

CAP_NS = "urn:oasis:names:tc:emergency:cap:1.2"
_NS = {"cap": CAP_NS}


class CapParseError(ValueError):
    """The document is not a usable CAP 1.2 alert."""


@dataclass(frozen=True)
class CapReference:
    sender: str
    identifier: str
    sent: datetime


@dataclass(frozen=True)
class CapArea:
    area_desc: str
    polygons: tuple[tuple[tuple[float, float], ...], ...]  # closed rings of (lon, lat)
    geocodes: tuple[tuple[str, str], ...]  # (valueName, value)


@dataclass(frozen=True)
class CapInfo:
    language: str
    event: str
    urgency: str
    severity: str
    certainty: str
    effective: datetime | None
    onset: datetime | None
    expires: datetime | None
    sender_name: str | None
    headline: str | None
    description: str | None
    instruction: str | None
    web: str | None
    areas: tuple[CapArea, ...]


@dataclass(frozen=True)
class CapMessage:
    identifier: str
    sender: str
    sent: datetime
    status: str
    msg_type: str
    scope: str
    references: tuple[CapReference, ...]
    infos: tuple[CapInfo, ...]

    @property
    def key(self) -> str:
        """Message identity per CAP: (sender, identifier, sent)."""
        return f"{self.sender}|{self.identifier}|{self.sent.isoformat()}"


def _text(el: ET.Element, path: str) -> str | None:
    value = el.findtext(path, namespaces=_NS)
    if value is None or not value.strip():
        return None
    return value.strip()


def _required(el: ET.Element, path: str) -> str:
    value = _text(el, path)
    if value is None:
        raise CapParseError(f"missing <{path}>")
    return value


def _time(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise CapParseError(f"invalid time: {value}") from exc
    if parsed.tzinfo is None:
        raise CapParseError(f"time without UTC offset: {value}")
    return parsed


def _polygon(text: str) -> tuple[tuple[float, float], ...]:
    """CAP polygons are space-separated "lat,lon" pairs; GeoJSON positions are (lon, lat)."""
    try:
        ring = [(float(lon), float(lat)) for lat, lon in (pair.split(",") for pair in text.split())]
    except ValueError as exc:
        raise CapParseError(f"invalid polygon: {exc}") from exc
    if len(ring) < 3:
        raise CapParseError("polygon needs at least 3 points")
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return tuple(ring)


def _references(text: str | None) -> tuple[CapReference, ...]:
    if not text:
        return ()
    refs = []
    for triple in text.split():
        parts = triple.split(",")
        if len(parts) != 3:
            raise CapParseError(f"invalid reference: {triple}")
        sender, identifier, sent = parts
        refs.append(CapReference(sender=sender, identifier=identifier, sent=_time(sent)))
    return tuple(refs)


def _area(area: ET.Element) -> CapArea:
    polygons = tuple(_polygon(p.text) for p in area.findall("cap:polygon", _NS) if p.text and p.text.strip())
    geocodes = tuple((_required(g, "cap:valueName"), _required(g, "cap:value"))
                     for g in area.findall("cap:geocode", _NS))
    return CapArea(area_desc=_text(area, "cap:areaDesc") or "", polygons=polygons, geocodes=geocodes)


def _info(info: ET.Element) -> CapInfo:
    return CapInfo(
        language=_text(info, "cap:language") or "en-US",
        event=_required(info, "cap:event"),
        urgency=_required(info, "cap:urgency"),
        severity=_required(info, "cap:severity"),
        certainty=_required(info, "cap:certainty"),
        effective=_time(_text(info, "cap:effective")),
        onset=_time(_text(info, "cap:onset")),
        expires=_time(_text(info, "cap:expires")),
        sender_name=_text(info, "cap:senderName"),
        headline=_text(info, "cap:headline"),
        description=_text(info, "cap:description"),
        instruction=_text(info, "cap:instruction"),
        web=_text(info, "cap:web"),
        areas=tuple(_area(a) for a in info.findall("cap:area", _NS)),
    )


def parse_cap(raw: bytes) -> CapMessage:
    try:
        root = ET.fromstring(raw.removeprefix(b"\xef\xbb\xbf"))
    except ET.ParseError as exc:
        raise CapParseError(f"invalid XML: {exc}") from exc
    if root.tag != f"{{{CAP_NS}}}alert":
        raise CapParseError(f"not a CAP 1.2 alert: {root.tag}")
    return CapMessage(
        identifier=_required(root, "cap:identifier"),
        sender=_required(root, "cap:sender"),
        sent=_time(_required(root, "cap:sent")),
        status=_required(root, "cap:status"),
        msg_type=_required(root, "cap:msgType"),
        scope=_required(root, "cap:scope"),
        references=_references(_text(root, "cap:references")),
        infos=tuple(_info(i) for i in root.findall("cap:info", _NS)),
    )
