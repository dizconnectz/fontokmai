from datetime import UTC, datetime
from importlib import resources

from fontokmai.contracts.boundaries import Boundaries
from fontokmai.contracts.manifest import Manifest
from fontokmai.contracts.places import PlaceGazetteer
from fontokmai.examples import write_boundaries_example
from fontokmai.run import run_cap_snapshot
from fontokmai.sources.tmd_cap.fetch import fixture_fetcher
from helpers import FIXTURES


def _shipped(name: str) -> bytes:
    return resources.files("fontokmai.ref_data").joinpath(name).read_bytes()


def test_shipped_outlines_cover_every_province_and_district_once():
    boundaries = Boundaries.model_validate_json(_shipped("boundaries.json"))
    codes = [area.code for area in boundaries.areas]
    places = PlaceGazetteer.model_validate_json(_shipped("places.json")).places
    # the codes the summary names (ref/places.json), provinces then districts, each sorted
    assert codes == [p.code for p in places if p.kind in ("province", "district")]
    for area in boundaries.areas:
        for polygon in area.outline.coordinates:
            for ring in polygon:
                assert ring[0] == ring[-1] and len(ring) >= 4, area.code
                assert all(97 <= lon <= 106 and 5 <= lat <= 21 for lon, lat in ring), area.code
    assert boundaries.license == "CC BY 3.0 IGO" and "กรมแผนที่ทหาร" in boundaries.credit_th


def test_a_district_outline_holds_its_subdistrict_points():
    """The codes were paired from the DOPA points; nearly all of them fall inside the simplified line."""
    outlines = {area.code: area.outline.coordinates
                for area in Boundaries.model_validate_json(_shipped("boundaries.json")).areas}

    def inside(point, outline) -> bool:
        x, y = point
        hit = False
        for polygon in outline:
            for ring in polygon:
                for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
                    if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                        hit = not hit
        return hit

    points = [p for p in PlaceGazetteer.model_validate_json(_shipped("places.json")).places if p.kind == "subdistrict"]
    inside_district = sum(inside(p.location, outlines[p.code[:4]]) for p in points)
    assert inside_district / len(points) > 0.99  # the rest are on islands too small to draw, or in the sea
    rangsit, khlong_luang = [100.632, 13.987], [100.6847, 14.0967]  # ต.ประชาธิปัตย์ อ.ธัญบุรี, อ.คลองหลวง
    assert inside(rangsit, outlines["1303"]) and not inside(rangsit, outlines["1302"])
    assert inside(khlong_luang, outlines["1302"]) and inside(khlong_luang, outlines["13"])


def test_snapshot_publishes_the_outlines(tmp_path):
    out = tmp_path / "v1"
    run_cap_snapshot(db=tmp_path / "s.db", out=out, fetch=fixture_fetcher(FIXTURES),
                     now=datetime(2026, 9, 25, 11, 20, tzinfo=UTC), writer="t", owner_epoch=1)
    manifest = Manifest.model_validate_json((out / "manifest.json").read_bytes())
    assert "ref/boundaries.json" in [f.path for f in manifest.files]
    assert (out / "ref" / "boundaries.json").read_bytes() == _shipped("boundaries.json")


def test_boundaries_example_is_a_valid_cut_of_the_shipped_file(tmp_path):
    [path] = write_boundaries_example(tmp_path)
    example = Boundaries.model_validate_json(path.read_bytes())
    assert {area.code[:2] for area in example.areas} == {"10", "11", "12", "13"}
    shipped = {area.code: area for area in Boundaries.model_validate_json(_shipped("boundaries.json")).areas}
    assert all(shipped[area.code] == area for area in example.areas)
