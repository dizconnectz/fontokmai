from types import SimpleNamespace

from fontokmai.overview_build import Gazetteer, downstream_table, downstream_th
from fontokmai.ref_data.build_downstream import Reach, districts_along, downstream_path, start_reach

# three reaches in a line, flowing east along 14°N: 1 → 2 → 3 → the sea
REACHES = {
    1: Reach(2, 900.0, [(100.00, 14.0), (100.01, 14.0), (100.02, 14.0)]),
    2: Reach(3, 1200.0, [(100.02, 14.0), (100.05, 14.0), (100.08, 14.0)]),
    3: Reach(0, 1500.0, [(100.08, 14.0), (100.20, 14.0)]),
    9: Reach(1, 50.0, [(99.99, 14.05), (100.00, 14.0)]),  # a small stream that joins reach 1
    5: Reach(0, 99999.0, [(100.0, 14.2), (100.1, 14.2)]),  # a large river of its own, 22 km away
}


def test_the_dam_starts_on_the_largest_river_near_it_and_the_water_goes_down_to_the_sea():
    # the dam's own river, perhaps a little below it; neither the small stream nor the large river 22 km away
    assert start_reach(REACHES, [100.005, 14.01])[0] in (1, 2)
    path, end = downstream_path(REACHES, 1, 0)
    assert end == "sea"
    assert path[0][:2] == (100.0, 14.0) and path[-1][:2] == (100.2, 14.0)  # every point about a km apart or more
    assert path[-1][2] == 21.6  # km along the river from the dam


def test_districts_come_in_the_order_the_water_reaches_them_and_leaving_thailand_ends_the_list():
    def place(code):
        return SimpleNamespace(code=code)

    path = [(100.0 + k * 0.01, 14.0, float(k)) for k in range(60)]
    # a border river: two districts by turns, then one further down, then 30 km with no Thai subdistrict near
    names = {0: "260101", 3: "240901", 5: "260101", 8: "240901", 12: "240201"}

    def nearest(location):
        k = round((location[0] - 100.0) / 0.01)
        if k >= 20:
            return None
        return place(names[max(i for i in names if i <= k)])

    districts, end = districts_along(path, nearest)
    assert districts == [["2601", 0.0], ["2409", 3.0], ["2402", 12.0]] and end == "abroad"


def test_the_summary_line_names_the_provinces_below_a_dam_and_where_it_meets_the_sea():
    g = Gazetteer.load()
    # Nakhon Nayok's districts, then บางน้ำเปรี้ยว and บ้านสร้าง by turns (the river is the border), then down to บางปะกง
    khun_dan = {"end": "sea", "districts": [["2601", 0.0], ["2603", 12.0], ["2604", 30.0], ["2403", 43.0],
                                             ["2506", 44.0], ["2402", 58.0], ["2401", 80.0], ["2404", 110.0]]}
    # the river is a border between Prachin Buri and Chachoengsao for a while: provinces go by their middle distance
    assert downstream_th(g, khun_dan) == (
        "ท้ายน้ำ: นครนายก → ปราจีนบุรี → ฉะเชิงเทรา · ออกทะเลที่ อ.บางปะกง จ.ฉะเชิงเทรา")
    assert downstream_th(g, None) is None and downstream_th(g, {"districts": []}) is None
    # the table built from HydroRIVERS lists the dams with a place, each with its districts
    table = downstream_table()
    assert len(table) >= 30 and all(entry["districts"] and entry["end"] in ("sea", "abroad")
                                    for entry in table.values())
