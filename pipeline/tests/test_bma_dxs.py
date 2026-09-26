"""BMA DXS SOAP client: the account travels only in the AuthHeader and never shows up in errors or reprs."""

import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from fontokmai.run import run_cap_snapshot
from fontokmai.sources.bma_dxs import (
    ENDPOINT,
    FLOODING_PATH,
    RAIN_PATH,
    SOAP,
    WATER_PATH,
    Account,
    DxsError,
    call,
    children,
    collect_bkk,
    collect_extras,
    envelope,
    fixture_poster,
    load_account,
    outline,
    text,
)
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES

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


# ---------- water levels and rain from the synthetic answers (tests/fixtures/bma_dxs) ----------


DXS = Path(__file__).parent / "fixtures" / "bma_dxs"
AT = datetime.fromisoformat("2026-09-26T17:20:00+07:00")


def test_water_levels_keep_readings_with_their_station_and_drop_impossible_values(tmp_path):
    result = collect_bkk(ACCOUNT, tmp_path, AT, post=fixture_poster(DXS))
    assert result.ok and result.message is None
    stations = {s.code: s for s in result.water.stations}
    assert (stations["S001"].level_in_m, stations["S001"].level_out_m, stations["S001"].pumps) == (1.78, 0.95, 4)
    assert stations["S001"].observed_at.isoformat() == "2026-09-26T17:15:00+07:00"  # no offset = Thai time
    assert stations["S002"].observed_at.year == 2026  # a Buddhist-era year is converted
    assert stations["S002"].level_out_m is None  # "-" is no value
    assert stations["S003"].location is None  # latitude and longitude swapped
    assert stations["S003"].level_in_m is None  # -999 is a missing reading, not a level
    assert stations["S004"].observed_at is None and stations["S004"].location is None
    gauges = {g.code: g for g in result.rain.gauges}
    assert (gauges["R01"].rain_1h_mm, gauges["R01"].rain_24h_mm) == (12, 35)
    assert gauges["R03"].observed_at is None and gauges["R03"].rain_1h_mm is None


def test_a_failed_part_keeps_its_last_good_file_and_says_what_failed(tmp_path):
    good = collect_bkk(ACCOUNT, tmp_path, AT, post=fixture_poster(DXS))
    (tmp_path / "bkk").mkdir()
    (tmp_path / RAIN_PATH).write_text(good.rain.model_dump_json(), encoding="utf-8")
    broken = tmp_path / "answers"
    broken.mkdir()
    for name in ("GetWaterInfo.xml", "GetWaterLastData.xml", "GetRainInfo.xml"):
        (broken / name).write_bytes((DXS / name).read_bytes())
    later = collect_bkk(ACCOUNT, tmp_path, AT.replace(minute=35), post=fixture_poster(broken))
    assert not later.ok and later.message.startswith("rain: ")
    assert later.water.fetched_at.minute == 35
    assert later.rain.fetched_at == good.rain.fetched_at  # the old file, whose time shows its age
    assert "p@ss" not in later.message


def test_a_round_publishes_the_bangkok_files_with_their_own_source_status(tmp_path):
    result = run_cap_snapshot(db=tmp_path / "s.db", out=tmp_path / "out", fetch=fixture_fetcher(FIXTURES),
                              now=AT, writer="test", owner_epoch=1, dxs_account=ACCOUNT,
                              dxs_post=fixture_poster(DXS))
    listed = {f.path for f in result.manifest.files}
    assert {WATER_PATH, RAIN_PATH, FLOODING_PATH} <= listed
    [status] = [s for s in result.manifest.source_status if s.source_id == "bma_dxs"]
    assert (status.status, status.items_seen) == ("ok", 10)  # 4 stations, 3 gauges, 3 road reports
    water = json.loads((tmp_path / "out" / WATER_PATH).read_text(encoding="utf-8"))
    assert water["credit_th"] == "สำนักการระบายน้ำ กรุงเทพมหานคร (ผ่านระบบ DXS)"
    # without an account the round does not call DXS: the recent files stay listed, with no source status
    later = run_cap_snapshot(db=tmp_path / "s.db", out=tmp_path / "out", fetch=fixture_fetcher(FIXTURES),
                             now=AT.replace(minute=35), writer="test", owner_epoch=1)
    assert WATER_PATH in {f.path for f in later.manifest.files}
    assert "bma_dxs" not in {s.source_id for s in later.manifest.source_status}


def test_the_road_report_puts_roads_still_flooded_first_and_reads_both_date_styles(tmp_path):
    result = collect_bkk(ACCOUNT, tmp_path, AT, post=fixture_poster(DXS))
    flooding = result.flooding
    assert flooding.report_date.isoformat() == "2026-09-26"
    assert flooding.updated_at.isoformat() == "2026-09-26T17:10:00+07:00"
    first, dry, overnight = flooding.reports
    assert (first.road_th, first.dry_at, first.depth_cm, first.lanes_th) == ("ถนนทดสอบหนึ่ง", None, 20, "เต็มผิว")
    assert dry.dry_at.isoformat() == "2026-09-26T17:15:00+07:00"
    assert overnight.flood_start.isoformat() == "2026-09-25T22:10:00+07:00"  # 25/09/2569 22.10
    assert overnight.area_th == "จุดวัดทดสอบ" and overnight.depth_cm == 10


def test_a_road_report_for_another_day_is_refused(tmp_path):
    answers = tmp_path / "answers"
    answers.mkdir()
    for path in DXS.glob("*.xml"):
        text_ = path.read_text(encoding="utf-8")
        answers.joinpath(path.name).write_text(text_.replace("<DailyReport>2026-09-26", "<DailyReport>2026-09-20"),
                                               encoding="utf-8")
    result = collect_bkk(ACCOUNT, tmp_path, AT, post=fixture_poster(answers))
    assert not result.ok and "instead of 2026-09-26" in result.message
    assert result.flooding is None  # nothing older to keep in this empty folder


def test_without_dxs_a_round_lists_the_files_a_manual_run_delivered_for_a_month(tmp_path):
    """DXS answers only Thai addresses: a computer in Thailand fetches once and copies the files to the VPS."""
    out = tmp_path / "out"
    delivered = collect_bkk(ACCOUNT, out, AT, post=fixture_poster(DXS))
    for rel, model in ((WATER_PATH, delivered.water), (RAIN_PATH, delivered.rain),
                       (FLOODING_PATH, delivered.flooding)):
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        (out / rel).write_text(model.model_dump_json(), encoding="utf-8")
    (out / "bkk" / "notes.txt").write_text("not part of the contract", encoding="utf-8")
    later = run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                             now=AT + timedelta(hours=3), writer="test", owner_epoch=1)
    listed = {f.path for f in later.manifest.files}
    assert {WATER_PATH, RAIN_PATH, FLOODING_PATH} <= listed and "bkk/notes.txt" not in listed
    # no source status: the round did not call DXS, the files say when they were fetched
    assert "bma_dxs" not in {s.source_id for s in later.manifest.source_status}
    # listed for a month (the web says how old it is), then dropped
    next_day = run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                                now=AT + timedelta(hours=25), writer="test", owner_epoch=1)
    assert WATER_PATH in {f.path for f in next_day.manifest.files}
    next_month = run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                                  now=AT + timedelta(days=31), writer="test", owner_epoch=1)
    assert not ({WATER_PATH, RAIN_PATH, FLOODING_PATH} & {f.path for f in next_month.manifest.files})


def test_the_situation_text_dams_and_weather_stations(tmp_path):
    extras, problems = collect_extras(ACCOUNT, AT, post=fixture_poster(DXS))
    assert problems == []
    news = extras["bkk/news.json"]
    # the HTML message becomes plain text; nothing of the markup is kept
    assert news.text_th.split("\n") == ["วันที่ 26 กันยายน 2569 เวลา 17.00 น.", "ฝนเล็กน้อย & ลมแรง", "ระดับน้ำ ปกติ"]
    assert news.updated_at.isoformat() == "2026-09-26T17:05:00+07:00"
    dams = {d.id: d for d in extras["water/dams.json"].dams}
    assert dams["200101"].location == [98.97217, 17.24191] and dams["200101"].location_kind == "dam"
    assert (dams["200101"].percent, dams["200101"].volume_mcm, dams["200101"].outflow_mcm) == (62.68, 8437.68, 3)
    assert dams["999999"].location is None and dams["999999"].outflow_mcm is None
    stations = {s.wmo: s for s in extras["weather/today.json"].stations}
    assert stations["48455"].rain_mm == 52.8 and stations["48455"].location == [100.56034, 13.72627]
    assert stations["48455"].observed_at.isoformat() == "2026-09-26T07:00:00+07:00"
    assert stations["48000"].location is None and stations["48000"].temperature_c is None

