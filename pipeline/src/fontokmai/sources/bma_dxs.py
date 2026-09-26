"""BMA DXS, the data exchange of the Drainage and Sewerage Department (สำนักการระบายน้ำ กทม.).

SOAP 1.1 calls to the services approved for the user's account (request RQX256909000023, purpose "นำไปให้บริการ
เผยแพร่ข้อมูลต่อ"). Every call carries the account in an AuthHeader. The account is read from a file outside the
repository (two lines: user name, then password); it is never logged, printed or written anywhere else.
Terms (docs/requests/2026-09-26-bma-dxs.md): use only for the approved purpose, no other access path, text credit
without the department's logo, no links into DXS pages.
"""

from __future__ import annotations

import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from fontokmai.sources.tmd_cap.fetch import USER_AGENT, make_ssl_context

ENDPOINT = "https://dxg-api.dds.bangkok.go.th/WSS_DDSDXS.asmx"
NAMESPACE = "http://tempuri.org/"
SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
TIMEOUT_S = 60
LIMIT = 20_000_000

# (url, body, headers) -> response body
Poster = Callable[[str, bytes, dict[str, str]], bytes]


class DxsError(RuntimeError):
    """A DXS call failed; the message never contains the account."""


@dataclass(frozen=True)
class Account:
    username: str = field(repr=False)
    password: str = field(repr=False)


def load_account(path: Path) -> Account:
    try:
        lines = [line.strip() for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    except OSError as exc:
        raise DxsError(f"cannot read the DXS account file: {type(exc).__name__}") from None
    if len(lines) < 2:
        raise DxsError("the DXS account file needs two lines: the user name, then the password")
    return Account(lines[0], lines[1])


def envelope(operation: str, account: Account, params: dict[str, str] | None = None) -> bytes:
    ET.register_namespace("soap", SOAP)
    root = ET.Element(f"{{{SOAP}}}Envelope")
    header = ET.SubElement(ET.SubElement(root, f"{{{SOAP}}}Header"), f"{{{NAMESPACE}}}AuthHeader")
    ET.SubElement(header, f"{{{NAMESPACE}}}Username").text = account.username
    ET.SubElement(header, f"{{{NAMESPACE}}}Password").text = account.password
    call = ET.SubElement(ET.SubElement(root, f"{{{SOAP}}}Body"), f"{{{NAMESPACE}}}{operation}")
    for name, value in (params or {}).items():
        ET.SubElement(call, f"{{{NAMESPACE}}}{name}").text = value
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def https_post(url: str, body: bytes, headers: dict[str, str]) -> bytes:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=make_ssl_context()) as response:
            data = response.read(LIMIT + 1)
    except urllib.error.HTTPError as exc:
        # a SOAP fault comes back as HTTP 500 with an XML body worth reading
        data = exc.read(LIMIT + 1)
        if b"Fault" not in data:
            raise DxsError(f"HTTP {exc.code}") from None
    except OSError as exc:
        raise DxsError(f"{type(exc).__name__}: {exc}") from None
    if len(data) > LIMIT:
        raise DxsError(f"answer larger than {LIMIT} bytes")
    return data


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def call(operation: str, account: Account, params: dict[str, str] | None = None, *,
         post: Poster = https_post) -> ET.Element:
    """The element the operation returns (its …Result or named result), namespaces kept."""
    headers = {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": f'"{NAMESPACE}{operation}"',
               "User-Agent": USER_AGENT}
    raw = post(ENDPOINT, envelope(operation, account, params), headers)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise DxsError(f"{operation}: answer is not XML ({exc})") from None
    fault = root.find(f".//{{{SOAP}}}Fault")
    if fault is not None:
        reason = next((c.text for c in fault.iter() if local(c.tag) == "faultstring"), None) or "SOAP fault"
        raise DxsError(f"{operation}: {reason.strip()[:200]}")
    body = root.find(f"{{{SOAP}}}Body")
    response = body[0] if body is not None and len(body) else None
    if response is None or local(response.tag) != f"{operation}Response" or not len(response):
        raise DxsError(f"{operation}: no result in the answer")
    return response[0]


def child(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    return next((c for c in element if local(c.tag) == name), None)


def children(element: ET.Element | None, name: str) -> list[ET.Element]:
    return [] if element is None else [c for c in element if local(c.tag) == name]


def text(element: ET.Element | None, name: str) -> str | None:
    found = child(element, name)
    value = (found.text or "").strip() if found is not None else ""
    return value or None


def outline(element: ET.Element, depth: int = 0, limit: int = 6) -> list[str]:
    """A short picture of an answer for development: tags, how often they repeat, and the first values."""
    lines: list[str] = []
    seen: dict[str, int] = {}
    for item in element:
        seen[local(item.tag)] = seen.get(local(item.tag), 0) + 1
    shown: set[str] = set()
    for item in element:
        name = local(item.tag)
        if name in shown:
            continue
        shown.add(name)
        count = f" ×{seen[name]}" if seen[name] > 1 else ""
        if len(item):
            lines.append(f"{'  ' * depth}{name}{count}")
            if depth < limit:
                lines += outline(item, depth + 1, limit)
        else:
            lines.append(f"{'  ' * depth}{name}{count} = {(item.text or '').strip()[:80]!r}")
    return lines
