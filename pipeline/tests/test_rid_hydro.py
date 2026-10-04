from datetime import UTC, datetime, timedelta
from pathlib import Path

from fontokmai.contracts.flows import RidFlows
from fontokmai.sources import rid_hydro, rid_report

NOW = datetime(2026, 10, 4, 10, 0, tzinfo=UTC)  # 17:00 in Thailand

# the shape of the hydrology centre's page as the user's screenshot shows it (2026-10-04 16:00): per station a blue
# level and a green flow above its box, the box says the station and its capacity
SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
  <text x="300" y="40">รายงานสถานการณ์น้ำ แม่น้ำเจ้าพระยา</text>
  <text x="330" y="60">วันที่ 04 ตุลาคม 2569 เวลา 16:00 น.</text>
  <text x="130" y="110">22.99</text><text x="130" y="150">2,092.00</text>
  <text x="430" y="110">15.93</text><text x="430" y="150">2,500.00</text>
  <text x="560" y="120">12.48</text><text x="560" y="160">2,587.00</text>
  <text x="680" y="130">9.12</text><text x="680" y="170">2,481.00</text>
  <text x="790" y="130">5.41</text><text x="790" y="170">1,486.00</text>
  <text x="340" y="160">17.60</text>
  <text x="120" y="420">สถานี C.2</text><text x="420" y="420">สถานี C.13</text>
  <text x="550" y="420">สถานี C.3</text><text x="670" y="420">สถานี C.7A</text>
  <text x="780" y="420"><tspan>สถานี C.35</tspan></text>
  <text x="780" y="480">ความจุฯ 1,159.00 ลบ.ม./วิ</text>
</svg>"""


def test_the_page_is_read_by_columns_and_the_capacity_is_not_a_flow():
    hydro = rid_hydro.parse(SVG.encode(), NOW)
    by_code = {s.code: s for s in hydro.stations}
    assert hydro.observed_at == datetime(2026, 10, 4, 9, 0, tzinfo=UTC)  # 16:00 ICT
    assert (by_code["C.35"].flow_cms, by_code["C.35"].level_m) == (1486.0, 5.41)
    assert (by_code["C.2"].flow_cms, by_code["C.7A"].flow_cms) == (2092.0, 2481.0)
    assert rid_hydro.parse(b"<svg xmlns='http://www.w3.org/2000/svg'><text x='1' y='1'>x</text></svg>", NOW) is None


def test_collect_reads_an_svg_the_page_loads():
    page = b"<html><body><object data='hydro5.svg'></object></body></html>"
    files = {rid_hydro.PAGE_URL: page, "https://hyd-app-db.rid.go.th/SVG/hydro5.svg": SVG.encode()}
    hydro = rid_hydro.collect(NOW, get=lambda url: files[url])
    assert hydro is not None and any(s.code == "C.35" for s in hydro.stations)


def _flows():
    text = (Path(__file__).parent / "fixtures" / "rid" / "report-2026-10-03.txt").read_text(encoding="utf-8")
    return rid_report.build(rid_report.parse_report(text), {"c35": "flood"}, rid_report.report_day(text),
                            NOW, None, [])


def test_the_backup_fills_only_what_the_report_lacks_while_it_is_recent():
    flows = _flows()
    hydro = rid_hydro.parse(SVG.encode(), NOW)
    merged = rid_hydro.with_backup(flows, hydro, NOW)
    points = {p.id: p for p in merged.points}
    assert points["c35"].flow_cms == 1486.0 and points["c35"].flow_backup_at == hydro.observed_at
    assert points["c35"].level_m == 5.41 and points["c35"].state == "flood"
    # the report's own figures stay the report's, even where the backup has another
    assert points["c2"].flow_cms == 2245.0 and points["c2"].flow_backup_at is None
    assert merged.backup_url == rid_hydro.PAGE_URL
    RidFlows.model_validate_json(merged.model_dump_json())
    # too old, or none: nothing changes
    assert rid_hydro.with_backup(flows, hydro, NOW + timedelta(hours=37)) == flows
    assert rid_hydro.with_backup(flows, None, NOW) == flows
