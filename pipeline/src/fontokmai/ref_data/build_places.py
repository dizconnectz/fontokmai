"""Build ref_data/places.json from the DOPA subdistrict points (กรมการปกครอง, data.go.th, CC BY).

Run by hand when DOPA publishes a new file:
    uv run python -m fontokmai.ref_data.build_places tambon.xlsx
The XLSX is read with the standard library (zip + XML), so the package needs no spreadsheet dependency.
"""

from __future__ import annotations

import re
import sys
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path
from xml.etree import ElementTree

from fontokmai.contracts.places import Place, PlaceGazetteer

SOURCE_URL = "https://data.go.th/dataset/5370f16a-b553-45ca-929d-7db9a6fc5043"
DATASET_DATE = date(2021, 10, 31)  # "modified" date of the tambon.xlsx resource
CREDIT_TH = "กรมการปกครอง (ข้อมูลเปิด data.go.th, CC BY)"
NOTES_TH = [
    "จุดของตำบลเป็นจุดอ้างอิงจากกรมการปกครอง ไม่ใช่ขอบเขตพื้นที่",
    "จุดของอำเภอและจังหวัดเป็นค่าเฉลี่ยของจุดตำบลในพื้นที่ ใช้เพื่อซูมแผนที่ไปหาเท่านั้น",
    "ข้อมูลปี 2564 ตำบลที่ตั้งหรือเปลี่ยนชื่อหลังจากนั้นอาจยังไม่มี",
]
KINDS = {2: "province", 4: "district", 6: "subdistrict"}
COLUMNS = {6: "TAMBON_T", 4: "AMPHOE_T", 2: "CHANGWAT_T"}
# Thai name column → the prefixes DOPA writes before the name
PREFIXES = {"TAMBON_T": r"ต\.|แขวง", "AMPHOE_T": r"อ\.|เขต", "CHANGWAT_T": r"จ\."}
# Rows whose Thai name is an editor's note in the 2021 file; the name follows the code (and TAMBON_E)
NAME_FIXES = {"520101": "เวียงเหนือ", "800901": "ปากแพรก"}
_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def xlsx_rows(path: Path) -> list[dict[str, str]]:
    """Rows of the first sheet as {header: value}; enough for a plain table of text and numbers."""
    with zipfile.ZipFile(path) as book:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ElementTree.fromstring(book.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in item.iter(f"{_NS}t")) for item in root.iter(f"{_NS}si")]
        sheet = min(name for name in book.namelist() if name.startswith("xl/worksheets/sheet"))
        table: list[dict[str, str]] = []
        for row in ElementTree.fromstring(book.read(sheet)).iter(f"{_NS}row"):
            cells: dict[str, str] = {}
            for cell in row.iter(f"{_NS}c"):
                value = cell.find(f"{_NS}v")
                if value is None or value.text is None:
                    continue
                column = re.sub(r"\d", "", cell.get("r", ""))
                cells[column] = shared[int(value.text)] if cell.get("t") == "s" else value.text
            table.append(cells)
    header, *body = table
    return [{header[column]: value for column, value in row.items() if column in header} for row in body]


def bare_name(name: str, column: str) -> str:
    """'ต. คลองหนึ่ง' → 'คลองหนึ่ง'; also a repeated prefix ('ต. ต.หนองบัว') and a note in brackets."""
    text = re.sub(rf"^(?:(?:{PREFIXES[column]})\s*)+", "", " ".join(name.split()))
    return re.sub(r"\s*\([^)]*\)", "", text).strip()


def _label(code: str, names: dict[str, str]) -> str:
    """ต.คลองสอง อ.คลองหลวง จ.ปทุมธานี, or แขวง… เขต… กรุงเทพมหานคร in Bangkok (code 10)."""
    prefixes = {6: "แขวง", 4: "เขต", 2: ""} if code.startswith("10") else {6: "ต.", 4: "อ.", 2: "จ."}
    return " ".join(prefixes[n] + names[code[:n]] for n in (6, 4, 2) if n <= len(code))


def _mean(points: list[list[float]]) -> list[float]:
    return [round(sum(p[0] for p in points) / len(points), 4), round(sum(p[1] for p in points) / len(points), 4)]


def build(rows: list[dict[str, str]]) -> PlaceGazetteer:
    points: dict[str, list[list[float]]] = defaultdict(list)
    names: dict[str, str] = {}  # code of any level → bare name
    for row in rows:
        code = (row.get("TA_ID") or "").strip()
        if not re.fullmatch(r"\d{6}", code) or not row.get("LAT") or not row.get("LONG"):
            continue
        # DOPA lists some subdistricts more than once (several points); they are averaged below
        points[code].append([float(row["LONG"]), float(row["LAT"])])
        for size, column in COLUMNS.items():
            if row.get(column):
                names[code[:size]] = bare_name(row[column], column)
    names |= NAME_FIXES
    locations = {code: _mean(found) for code, found in points.items()}
    parents: dict[str, list[list[float]]] = defaultdict(list)
    for code, location in locations.items():
        parents[code[:4]].append(location)
        parents[code[:2]].append(location)
    locations |= {code: _mean(found) for code, found in parents.items()}
    places = [Place(kind=KINDS[len(code)], code=code, name=names[code], label=_label(code, names),
                    location=locations[code])
              for code in sorted(locations, key=lambda code: (len(code), code))]
    return PlaceGazetteer(updated=DATASET_DATE, credit_th=CREDIT_TH, license="CC BY", source_url=SOURCE_URL,
                          places=places, notes_th=NOTES_TH)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m fontokmai.ref_data.build_places tambon.xlsx", file=sys.stderr)
        return 2
    gazetteer = build(xlsx_rows(Path(argv[1])))
    target = Path(__file__).with_name("places.json")
    target.write_text(gazetteer.model_dump_json() + "\n", encoding="utf-8", newline="\n")
    counts = {kind: sum(p.kind == kind for p in gazetteer.places) for kind in KINDS.values()}
    print(target, counts, target.stat().st_size, "bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
