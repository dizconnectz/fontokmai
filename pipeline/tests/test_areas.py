"""Which district a point is in, by the district outlines (Codex M44; the policy is in fontokmai/areas.py)."""

from fontokmai.areas import Area, DistrictIndex, district_index


def square(code: str, west: float, south: float, size: float, holes=(), slack: float = 0.001) -> Area:
    def ring(w, s, n):
        return ((w, s), (w + n, s), (w + n, s + n), (w, s + n), (w, s))
    rings = (ring(west, south, size), *(ring(*hole) for hole in holes))
    return Area(code, (west, south, west + size, south + size), rings, slack)


def test_points_well_inside_khlong_luang_are_in_khlong_luang_not_their_nearest_subdistricts_district():
    # Codex's points: the nearest subdistrict point is of Thanyaburi and of Wang Noi
    index = district_index()
    assert index.district(100.68, 14.04) == "1302"
    assert index.district(100.66, 14.14) == "1302"
    assert index.district(100.632, 13.987) == "1303"  # Rangsit, Thanyaburi, as before
    assert index.district(100.5, 11.5) is None  # the middle of the Gulf of Thailand


def test_the_policy_for_lines_holes_overlaps_and_the_sea():
    a = square("1001", 100.0, 13.0, 0.1, holes=[(100.04, 13.04, 0.02)])
    b = square("1002", 100.1, 13.0, 0.1)
    enclave = square("1003", 100.04, 13.04, 0.02)
    overlap = square("1004", 100.15, 13.05, 0.1)
    index = DistrictIndex([a, b, enclave, overlap])
    assert index.district(100.05, 13.02) == "1001"
    assert index.district(100.0995, 13.02) == "1001"  # near the line, inside one outline: that district
    assert index.district(100.05, 13.05) == "1003"  # in the hole of 1001: the enclave
    assert index.district(100.17, 13.07) is None  # in two outlines that overlap: unsure
    assert index.district(100.05, 12.9995) == "1001"  # just off a simplified edge, one district there
    assert index.district(100.1, 12.9995) is None  # just off the corner of two: never forced into one
    assert index.district(100.05, 12.9) is None  # at sea
