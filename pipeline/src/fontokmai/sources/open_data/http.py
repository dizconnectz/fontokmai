"""Streaming HTTPS reads for open-data files: verified TLS, nothing written to disk, size limits."""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from typing import Any, BinaryIO

from fontokmai.sources.tmd_cap.fetch import USER_AGENT, make_ssl_context

TIMEOUT_S = 120
SMALL_LIMIT = 10_000_000  # JSON and the yearly BMA CSVs are far below this

Opener = Callable[[str], AbstractContextManager[BinaryIO]]


class OpenDataError(RuntimeError):
    """An open-data file could not be read."""


@contextmanager
def open_url(url: str) -> Iterator[BinaryIO]:
    if not url.startswith("https://"):
        raise OpenDataError(f"refusing a non-HTTPS URL: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=make_ssl_context()) as response:
            yield response
    except OSError as exc:  # URLError, HTTPError and timeouts
        raise OpenDataError(f"{url}: {exc}") from exc


def read_bytes(opener: Opener, url: str, limit: int = SMALL_LIMIT) -> bytes:
    with opener(url) as fh:
        data = fh.read(limit + 1)
    if len(data) > limit:
        raise OpenDataError(f"{url}: larger than {limit} bytes")
    return data


def read_json(opener: Opener, url: str) -> Any:
    try:
        return json.loads(read_bytes(opener, url))
    except ValueError as exc:
        raise OpenDataError(f"{url}: not JSON ({exc})") from exc


def fixture_opener(files: dict[str, Path]) -> Opener:
    """Serve local files for known URLs (tests and contract examples); unknown URLs fail like the network."""

    @contextmanager
    def opener(url: str) -> Iterator[BinaryIO]:
        path = files.get(url)
        if path is None:
            raise OpenDataError(f"{url}: no fixture")
        with path.open("rb") as fh:
            yield fh

    return opener
