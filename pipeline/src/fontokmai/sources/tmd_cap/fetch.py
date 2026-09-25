"""HTTP access for the TMD CAP feed: allowlisted links, size limit and clear errors."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

import httpx

INDEX_URL = "https://www.tmd.go.th/api/xml/CAP"
ALLOWED_HOSTS = frozenset({"www.tmd.go.th", "tmd.go.th"})
CAP_PATH_PREFIX = "/uploads/CAP/"
MAX_BYTES = 5_000_000
USER_AGENT = "fontokmai/0.1 (+https://github.com/dizconnectz/fontokmai)"

Fetcher = Callable[[str], bytes]


class FetchError(RuntimeError):
    """A source document could not be fetched."""


def is_allowed_cap_url(url: str) -> bool:
    parts = urlsplit(url)
    return (parts.scheme == "https" and parts.hostname in ALLOWED_HOSTS
            and parts.path.startswith(CAP_PATH_PREFIX) and parts.path.endswith(".xml"))


def get_bytes(client: httpx.Client, url: str, max_bytes: int = MAX_BYTES) -> bytes:
    chunks: list[bytes] = []
    try:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise FetchError(f"{url}: HTTP {resp.status_code}")
            total = 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise FetchError(f"{url}: larger than {max_bytes} bytes")
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise FetchError(f"{url}: {exc.__class__.__name__}: {exc}") from exc
    return b"".join(chunks)


class LiveFetcher:
    """Fetch over HTTPS without following redirects to other hosts."""

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(30.0),
                                    transport=transport)

    def __call__(self, url: str) -> bytes:
        return get_bytes(self._client, url)

    def close(self) -> None:
        self._client.close()


def fixture_fetcher(directory: Path, index_name: str = "index.xml") -> Fetcher:
    """Serve the index and CAP documents from a local directory (tests, examples and replay)."""

    def fetch(url: str) -> bytes:
        name = index_name if url == INDEX_URL else urlsplit(url).path.rsplit("/", 1)[-1]
        path = directory / name
        if not path.is_file():
            raise FetchError(f"{url}: not in fixtures")
        return path.read_bytes()

    return fetch
