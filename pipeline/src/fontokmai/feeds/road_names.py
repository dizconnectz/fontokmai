"""Road, soi and tunnel names: display form, search key and names found in short report titles.

The web repeats search_key() in TypeScript; contracts/v1/README.md section 8 lists the same rules and
contracts/v1/examples/road-flood-history/expected.json checks both sides.
"""

from __future__ import annotations

import re
import unicodedata

THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
_PARENS = re.compile(r"\([^)]*\)")
_SPACES = re.compile(r"\s+")
_ROAD_PREFIX = re.compile(r"^(?:ถนน|ถ\.|ถ\s)\s*")
_SOI_PREFIX = re.compile(r"^(?:ซอย|ซ\.)\s*")
_PLACE = re.compile(r"(ถนน|ถ\.|ซอย|ซ\.|อุโมงค์)\s*([^\s,()/]+(?:\s\d+(?:/\d+)?)?)")
_EDGE = " -–,.:;"


def _plain(text: str) -> str:
    text = unicodedata.normalize("NFC", text).translate(THAI_DIGITS).replace("*", " ")
    return _SPACES.sub(" ", _PARENS.sub(" ", text)).strip()


def clean_name(raw: str) -> str:
    """Display form: NFC, Arabic digits, no notes in parentheses, single spaces, no ถนน/ถ. prefix, ซ. as ซอย."""
    text = _plain(raw).strip(_EDGE)
    text = _SOI_PREFIX.sub("ซอย", _ROAD_PREFIX.sub("", text))
    return text.strip(_EDGE)


_KEY_DROP = str.maketrans("", "", " -–—")


def search_key(text: str) -> str:
    """The key both sides of a search compare: clean_name() without spaces or dashes, case-folded.

    Dashes go too because sources write the same road both ways (รังสิต-นครนายก and รังสิตนครนายก).
    """
    return clean_name(text).translate(_KEY_DROP).casefold()


def kind_of(key: str) -> str:
    if key.startswith("ซอย"):
        return "soi"
    if key.startswith("อุโมงค์"):
        return "tunnel"
    return "road"


def names_in_text(text: str) -> list[str]:
    """Roads, sois and tunnels named in a short report title, in order and without duplicates.

    A soi given only by number (ซ.69) is skipped because it does not say which road it belongs to.
    """
    found: list[str] = []
    seen: set[str] = set()
    for marker, raw in _PLACE.findall(_plain(text)):
        name = raw.strip(_EDGE)
        if marker in ("ซอย", "ซ."):
            if name.replace(" ", "").replace("/", "").isdigit():
                continue
            name = "ซอย" + name
        elif marker == "อุโมงค์":
            name = "อุโมงค์" + name
        key = search_key(name)
        if key and key not in seen:
            seen.add(key)
            found.append(clean_name(name))
    return found
