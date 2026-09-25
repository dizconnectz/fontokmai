import httpx
import pytest

from fontokmai.sources.tmd_cap.fetch import FetchError, LiveFetcher, get_bytes, is_allowed_cap_url, make_ssl_context

INDEX = "https://www.tmd.go.th/api/xml/CAP"


@pytest.mark.parametrize(("url", "ok"), [
    ("https://www.tmd.go.th/uploads/CAP/CAPTMD20260925163420_2.xml", True),
    ("https://tmd.go.th/uploads/CAP/x.xml", True),
    ("http://www.tmd.go.th/uploads/CAP/x.xml", False),
    ("https://evil.example/uploads/CAP/x.xml", False),
    ("https://www.tmd.go.th/other/x.xml", False),
    ("https://www.tmd.go.th/uploads/CAP/x.html", False),
])
def test_cap_url_allowlist(url, ok):
    assert is_allowed_cap_url(url) is ok


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_live_fetcher_returns_body_and_identifies_itself():
    seen = {}

    def handler(request):
        seen["ua"] = request.headers.get("user-agent")
        return httpx.Response(200, content=b"<rss/>")

    fetch = LiveFetcher(transport=httpx.MockTransport(handler))
    try:
        assert fetch(INDEX) == b"<rss/>"
    finally:
        fetch.close()
    assert seen["ua"].startswith("fontokmai/")


def test_http_errors_and_oversized_bodies_raise():
    with _client(lambda r: httpx.Response(404)) as client:
        with pytest.raises(FetchError, match="HTTP 404"):
            get_bytes(client, INDEX)
    with _client(lambda r: httpx.Response(200, content=b"x" * 11)) as client:
        with pytest.raises(FetchError, match="larger than 10"):
            get_bytes(client, INDEX, max_bytes=10)


def test_transport_errors_become_fetch_errors():
    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    with _client(handler) as client:
        with pytest.raises(FetchError, match="ConnectError"):
            get_bytes(client, INDEX)


def test_ssl_context_adds_the_intermediate_that_the_tmd_server_does_not_send():
    ctx = make_ssl_context()
    names = [dict(part[0] for part in cert["subject"]).get("commonName") for cert in ctx.get_ca_certs()]
    assert "GlobalSign GCC R6 AlphaSSL CA 2025" in names
    assert "GlobalSign" in names  # the root still has to be trusted on its own
    assert ctx.verify_mode.name == "CERT_REQUIRED" and ctx.check_hostname
