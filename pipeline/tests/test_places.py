import zipfile
from collections import Counter
from datetime import UTC, datetime
from importlib import resources

import pytest

from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.examples import write_places_example
from fontokmai.ref_data.build_places import bare_name, build, xlsx_rows
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES


def _shipped_bytes() -> bytes:
    return resources.files("fontokmai.ref_data").joinpath("places.json").read_bytes()


def _row(code: str, tambon: str, amphoe: str, changwat: str, lon: float, lat: float) -> dict[str, str]:
    return {"TA_ID": code, "TAMBON_T": tambon, "AMPHOE_T": amphoe, "CHANGWAT_T": changwat,
            "LONG": str(lon), "LAT": str(lat)}


def test_names_lose_prefixes_repeats_and_notes():
    assert bare_name("ต. คลองหนึ่ง", "TAMBON_T") == "คลองหนึ่ง"
    assert bare_name("ต. ต.หนองบัว", "TAMBON_T") == "หนองบัว"
    assert bare_name("ต. จ.ป.ร.", "TAMBON_T") == "จ.ป.ร."  # a real name that starts like a province prefix
    assert bare_name("ต. ท่าเรือ (เทศบาลเมืองพระแท่น)", "TAMBON_T") == "ท่าเรือ"
    assert bare_name("แขวง  บางนาเหนือ", "TAMBON_T") == "บางนาเหนือ"
    assert bare_name("เขต บางนา", "AMPHOE_T") == "บางนา"
    assert bare_name("กรุงเทพมหานคร", "CHANGWAT_T") == "กรุงเทพมหานคร"


def test_build_averages_repeated_points_and_labels_bangkok_its_own_way():
    rows = [
        _row("130101", "ต. บางปรอก", "อ. เมืองปทุมธานี", "จ. ปทุมธานี", 100.52, 14.01),
        _row("130202", "ต. คลองสอง", "อ. คลองหลวง", "จ. ปทุมธานี", 100.64, 14.07),
        _row("130202", "ต. คลองสอง", "", "จ. ปทุมธานี", 100.66, 14.09),  # a second point, district name missing
        _row("104701", "แขวง บางนาเหนือ", "เขต บางนา", "กรุงเทพมหานคร", 100.61, 13.68),
        _row("TA_ID", "ต. หัวตาราง", "อ. -", "จ. -", 100.0, 14.0),  # not a subdistrict code
    ]
    gazetteer = build(rows)
    places = {p.code: p for p in gazetteer.places}
    assert list(places) == ["10", "13", "1047", "1301", "1302", "104701", "130101", "130202"]
    assert [places[c].kind for c in ("13", "1302", "130202")] == ["province", "district", "subdistrict"]
    assert places["130202"].label == "ต.คลองสอง อ.คลองหลวง จ.ปทุมธานี"
    assert places["130202"].location == pytest.approx([100.65, 14.08])
    assert places["1302"].label == "อ.คลองหลวง จ.ปทุมธานี" and places["13"].label == "จ.ปทุมธานี"
    assert places["13"].location == pytest.approx([100.585, 14.045])  # mean of its subdistrict points
    assert places["104701"].label == "แขวงบางนาเหนือ เขตบางนา กรุงเทพมหานคร"
    assert places["1047"].label == "เขตบางนา กรุงเทพมหานคร" and places["10"].label == "กรุงเทพมหานคร"
    assert gazetteer.license == "CC BY" and gazetteer.notes_th


def test_xlsx_reader_reads_shared_strings_and_numbers(tmp_path):
    path = tmp_path / "tambon.xlsx"
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with zipfile.ZipFile(path, "w") as book:
        book.writestr("xl/sharedStrings.xml", f"<sst {ns}><si><t>TA_ID</t></si><si><t>TAMBON_T</t></si>"
                                              "<si><t>ต. คลองสอง</t></si></sst>")
        book.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData>"
                      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
                      '<row r="2"><c r="A2"><v>130202</v></c><c r="B2" t="s"><v>2</v></c><c r="C2"/></row>'
                      "</sheetData></worksheet>")
    assert xlsx_rows(path) == [{"TA_ID": "130202", "TAMBON_T": "ต. คลองสอง"}]


def test_shipped_gazetteer_covers_thailand_without_gaps():
    places = PlaceGazetteer.model_validate_json(_shipped_bytes()).places
    codes = [p.code for p in places]
    assert codes == sorted(codes, key=lambda code: (len(code), code)) and len(codes) == len(set(codes))
    kinds = Counter(p.kind for p in places)
    assert kinds["province"] == 77 and kinds["district"] >= 900 and kinds["subdistrict"] >= 7000
    known = set(codes)
    # a name may itself start with เขต (เขตการปกครองพิเศษพัทยา) or จ. (จ.ป.ร.), but not with its own level's prefix
    prefixes = {"subdistrict": ("ต.", "แขวง"), "district": ("อ.", "เขต"), "province": ("จ.",)}
    for place in places:
        lon, lat = place.location
        assert 97 <= lon <= 106 and 5 <= lat <= 21, place
        assert all(place.code[:n] in known for n in (2, 4) if n < len(place.code)), place
        assert place.name and not place.name.startswith(prefixes[place.kind]) and "(" not in place.name, place


def test_snapshot_publishes_the_gazetteer(tmp_path):
    out = tmp_path / "v1"
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                     now=datetime(2026, 9, 25, 11, 20, tzinfo=UTC), writer="t", owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert "ref/places.json" in [f.path for f in manifest.files]
    assert (out / "ref" / "places.json").read_bytes() == _shipped_bytes()


def test_places_example_is_a_valid_cut_of_the_shipped_file(tmp_path):
    [path] = write_places_example(tmp_path)
    example = PlaceGazetteer.model_validate_json(path.read_bytes())
    assert {p.code[:2] for p in example.places} == {"10", "13"}
    shipped = {p.code: p for p in PlaceGazetteer.model_validate_json(_shipped_bytes()).places}
    assert all(shipped[p.code] == p for p in example.places)
