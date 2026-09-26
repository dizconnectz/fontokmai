"""BMA DXS SOAP client: the account travels only in the AuthHeader and never shows up in errors or reprs."""

import xml.etree.ElementTree as ET

import pytest

from fontokmai.sources.bma_dxs import (
    ENDPOINT,
    SOAP,
    Account,
    DxsError,
    call,
    children,
    envelope,
    load_account,
    outline,
    text,
)

ACCOUNT = Account("user<&>", "p@ss&<word>")


def answer(operation: str, inner: str) -> bytes:
    return (f'<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="{SOAP}"><soap:Body>'
            f'<{operation}Response xmlns="http://tempuri.org/">{inner}</{operation}Response>'
            f"</soap:Body></soap:Envelope>").encode()


def test_the_envelope_carries_the_escaped_account_and_the_parameters():
    root = ET.fromstring(envelope("getFloodingDailyReport", ACCOUNT, {"DailyReport": "2026-09-26"}))
    values = {el.tag.rsplit("}", 1)[-1]: el.text for el in root.iter()}
    assert values["Username"] == "user<&>" and values["Password"] == "p@ss&<word>"
    assert values["DailyReport"] == "2026-09-26"


def test_a_call_posts_soap_and_returns_the_result_element():
    sent = {}

    def post(url, body, headers):
        sent.update(url=url, headers=headers)
        return answer("GetRainInfo", "<RainInfo><Items><item><code>R01</code><name>สถานี ก</name></item>"
                                     "<item><code>R02</code></item></Items><error /></RainInfo>")

    result = call("GetRainInfo", ACCOUNT, post=post)
    assert sent["url"] == ENDPOINT and sent["headers"]["SOAPAction"] == '"http://tempuri.org/GetRainInfo"'
    items = children(children(result, "Items")[0], "item")
    assert [text(item, "code") for item in items] == ["R01", "R02"]
    assert text(items[1], "name") is None
    assert outline(result)[:3] == ["Items", "  item ×2", "    code = 'R01'"]


def test_a_soap_fault_is_an_error_without_the_account():
    fault = (f'<soap:Envelope xmlns:soap="{SOAP}"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode>'
             "<faultstring>Invalid user</faultstring></soap:Fault></soap:Body></soap:Envelope>").encode()
    with pytest.raises(DxsError) as caught:
        call("GetDam", ACCOUNT, post=lambda url, body, headers: fault)
    assert "Invalid user" in str(caught.value)
    assert "p@ss" not in str(caught.value) and "p@ss" not in repr(ACCOUNT)


def test_the_account_file_is_two_lines_and_may_start_with_a_bom(tmp_path):
    path = tmp_path / "dxs_key.txt"
    path.write_bytes("\ufeffsomeone\r\n\r\nsecret\r\n".encode())
    account = load_account(path)
    assert (account.username, account.password) == ("someone", "secret")
    path.write_text("only-one-line\n", encoding="utf-8")
    with pytest.raises(DxsError, match="two lines"):
        load_account(path)
