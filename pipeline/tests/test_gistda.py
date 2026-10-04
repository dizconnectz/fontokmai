import io
import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest

from fontokmai.contracts.satellite import SatelliteFloods
from fontokmai.sources import gistda
from fontokmai.sources.open_data.http import OpenDataError

NOW = datetime(2026, 10, 4, 6, 0, tzinfo=UTC)


def _feature(code, area, h3, scenes="S1D_20261002_0609", population=0, building=0, created="2026-10-03T18:54:50Z"):
    return {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": []},
            "properties": {"ap_idn": code, "f_area": area, "h3_address": h3, "file_name": scenes,
                           "population": population, "building": building, "_createdAt": created}}


def _api(features, *, change_after=None, calls=None):
    """GISTDA's API over a list of features: limit/offset pages; the count moves after `change_after` requests."""
    def opener_for(key):
        assert key == "secret-key"

        @contextmanager
        def opener(url):
            assert url.startswith(gistda.API_URL) and "secret-key" not in url  # the key never goes in a URL
            if calls is not None:
                calls.append(url)
            q = parse_qs(urlsplit(url).query)
            limit, offset = int(q["limit"][0]), int(q.get("offset", ["0"])[0])
            matched = len(features) + (1 if change_after is not None and len(calls or []) > change_after else 0)
            page = {"type": "FeatureCollection", "features": features[offset:offset + limit],
                    "numberMatched": matched, "numberReturned": len(features[offset:offset + limit]),
                    "links": [{"rel": "self", "href": url + "&api_key=1"}]}
            yield io.BytesIO(json.dumps(page).encode())
        return opener
    return opener_for


FEATURES = [
    _feature(6403, 54392.6, "a", population=10.4, building=2),
    _feature(6403, 942.6, "a"),  # a second piece of water in the same cell
    _feature(3804, 105520.3, "b", scenes="S1C_20260928_0550, S1D_20261002_0609, rd2_20260926_0613"),
    _feature(None, 5000.0, "c"),  # no district: left out, never guessed
    _feature(3804, -1, "d"),  # no area
]


def test_summarize_sums_by_district_and_names_the_scenes():
    floods = gistda.summarize(iter(FEATURES), NOW)
    by_code = {d.code: d for d in floods.districts}
    assert [d.code for d in floods.districts] == ["3804", "6403"]  # the largest first
    assert by_code["6403"].area_km2 == pytest.approx(0.055, abs=0.001) and by_code["6403"].cells == 1
    assert by_code["6403"].population == 10 and by_code["6403"].buildings == 2
    assert floods.scenes[0] == "S1D_20261002_0609" and floods.latest_scene_day == date(2026, 10, 2)
    assert floods.total_km2 == pytest.approx(0.161, abs=0.001)
    SatelliteFloods.model_validate_json(floods.model_dump_json())


def test_refresh_pages_through_the_layer_and_keeps_the_key_out(tmp_path, monkeypatch):
    key = tmp_path / "gistda_key"
    key.write_text(" secret-key\n")
    monkeypatch.setattr(gistda, "PAGE", 2)
    features = [_feature(1001 + i, 1000.0, f"h{i}") for i in range(5)]
    calls: list[str] = []
    line = gistda.refresh(tmp_path / "out", tmp_path / "s.db", NOW, key, opener_for=_api(features, calls=calls))
    assert line.startswith("built 5 districts")
    text = (tmp_path / "out" / gistda.PATH).read_text(encoding="utf-8")
    assert "secret-key" not in text and "api_key" not in text and "api-gateway" not in text
    assert len(calls) == 1 + 3  # the signature, then three pages of two
    # within REFRESH nothing is asked; after it, an unchanged layer is only checked and its time moved on
    assert gistda.refresh(tmp_path / "out", tmp_path / "s.db", NOW + timedelta(hours=1), key,
                          opener_for=_api(features)) is None
    later = NOW + timedelta(hours=4)
    calls.clear()
    assert gistda.refresh(tmp_path / "out", tmp_path / "s.db", later, key,
                          opener_for=_api(features, calls=calls)) == "unchanged"
    assert len(calls) == 1
    assert SatelliteFloods.model_validate_json((tmp_path / "out" / gistda.PATH).read_bytes()).fetched_at == later


def test_refresh_without_a_key_does_nothing(tmp_path):
    assert gistda.refresh(tmp_path, tmp_path / "s.db", NOW, None) is None
    empty = tmp_path / "gistda_key"
    empty.write_text("")
    assert gistda.refresh(tmp_path, tmp_path / "s.db", NOW, empty) is None


def test_a_layer_that_changes_while_read_is_not_published(tmp_path, monkeypatch):
    monkeypatch.setattr(gistda, "PAGE", 2)
    features = [_feature(1001 + i, 1000.0, f"h{i}") for i in range(5)]
    calls: list[str] = []
    with pytest.raises(OpenDataError, match="changed"):
        gistda.collect(_api(features, change_after=1, calls=calls)("secret-key"), NOW, page=2)


def test_the_opener_never_puts_the_key_in_an_error():
    opener = gistda.keyed_opener("secret-key")
    with pytest.raises(OpenDataError) as caught, opener("https://example.com/"):
        pass
    assert "secret-key" not in str(caught.value)


def _freq_api(by_province, calls=None, fail=()):
    def opener_for(key):
        @contextmanager
        def opener(url):
            assert url.startswith(gistda.FREQ_URL) and key not in url
            if calls is not None:
                calls.append(url)
            if len(calls or []) in fail:
                raise OpenDataError(f"{url}: HTTPError: 504")
            q = parse_qs(urlsplit(url).query)
            rows = by_province.get(q["pv_idn"][0], [])
            limit, offset = int(q["limit"][0]), int(q["offset"][0])
            page = {"type": "FeatureCollection", "features": rows[offset:offset + limit], "numberMatched": len(rows)}
            yield io.BytesIO(json.dumps(page).encode())
        return opener
    return opener_for


def _piece(pv, ap, tb, freq, rai):
    return {"type": "Feature", "geometry": None, "properties": {
        "pv_code": pv, "ap_code": ap, "tb_code": tb, "freq": freq, "area_rai": rai,
        "_createdAt": "2025-06-17T17:49:22.78Z"}}


def test_flood_frequency_is_summed_by_subdistrict(tmp_path, monkeypatch):
    monkeypatch.setattr(gistda, "PAGE", 2)
    key = tmp_path / "gistda_key"
    key.write_text("secret-key")
    rows = {"13": [_piece("13", "01", "01", 1, 9.5), _piece("13", "01", "01", 3, 2.0),
                   _piece("13", "01", "02", 2, 4.0), _piece("13", "99", "99", 2, 1.0),  # no such subdistrict
                   _piece("13", "01", "02", None, 1.0)]}  # no count
    freq = gistda.build_freq(tmp_path, NOW, key, ("13",), opener_for=_freq_api(rows), sleep=lambda s: None,
                             log=lambda line: None)
    by_code = {s.code: s for s in freq.subdistricts}
    assert set(by_code) == {"130101", "130102"}
    assert by_code["130101"].max_freq == 3 and by_code["130101"].rai_by_freq == [9.5, 0.0, 2.0]
    assert by_code["130101"].area_rai == 11.5 and by_code["130101"].name_th.startswith("ต.บางปรอก")
    assert freq.data_created == date(2025, 6, 17) and freq.provinces == ["13"]
    text = (tmp_path / gistda.FREQ_PATH).read_text(encoding="utf-8")
    assert "secret-key" not in text and "api-gateway" not in text


def test_flood_frequency_resumes_province_by_province_and_retries(tmp_path, monkeypatch):
    monkeypatch.setattr(gistda, "PAGE", 2)
    key = tmp_path / "gistda_key"
    key.write_text("secret-key")
    rows = {"13": [_piece("13", "01", "01", 1, 1.0)], "12": [_piece("12", "01", "01", 2, 3.0)]}
    quiet = {"sleep": lambda s: None, "log": lambda line: None}
    gistda.build_freq(tmp_path, NOW, key, ("13",), opener_for=_freq_api(rows), **quiet)
    calls: list[str] = []
    # a dropped page is asked again; the province already in the file is not read again
    freq = gistda.build_freq(tmp_path, NOW, key, ("13", "12"), opener_for=_freq_api(rows, calls, fail={1}), **quiet)
    assert freq.provinces == ["12", "13"] and [s.code for s in freq.subdistricts] == ["120101", "130101"]
    assert all("pv_idn=12" in url for url in calls) and len(calls) == 2
    # a server that keeps failing stops the run; what was read stays in the file
    with pytest.raises(OpenDataError):
        gistda.build_freq(tmp_path, NOW, key, ("11",), opener_for=_freq_api({"11": []}, [], fail={1, 2, 3, 4}),
                          **quiet)
    kept = gistda.FloodFrequency.model_validate_json((tmp_path / gistda.FREQ_PATH).read_bytes())
    assert kept.provinces == ["12", "13"]
    assert len(gistda.all_provinces()) == 77
