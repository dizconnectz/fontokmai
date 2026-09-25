# fontokmai pipeline

ตัวเก็บข้อมูล สัญญาข้อมูล และตัวเขียน snapshot ของ fontokmai (Python 3.13 + uv)

```bash
uv sync                     # ติดตั้ง
uv run pytest               # tests
uv run ruff check .         # ตรวจรูปแบบโค้ด
uv run fontokmai cap-snapshot --db ../state/dev.db --out ../out/data/v1   # เก็บประกาศ TMD CAP หนึ่งรอบจากเว็บจริง
uv run fontokmai cap-snapshot --db ../state/dev.db --out ../out/data/v1 \
    --fixtures tests/fixtures/tmd_cap --now 2026-09-25T18:20:00+07:00  # เล่นซ้ำจาก fixtures
```

| โมดูล | หน้าที่ |
|---|---|
| `fontokmai/contracts/` | สัญญาข้อมูล `/data/v1` (ต้นทางของ JSON Schema และ TypeScript ใน `contracts/v1/`) |
| `fontokmai/sources/tmd_cap/` | RSS index → CAP XML รายฉบับ → event lineage และ lifecycle |
| `fontokmai/state.py` | SQLite: เอกสารดิบ, revision ที่เพิ่มเฉพาะเมื่อเนื้อหาเปลี่ยน, meta |
| `fontokmai/feeds/alerts.py` | ประกอบ `alerts.json` |
| `fontokmai/publish/snapshot.py` | เขียนไฟล์ข้อมูลก่อนแล้วเขียน `manifest.json` ท้ายสุดแบบ atomic |
| `fontokmai/run.py`, `cli.py`, `examples.py` | หนึ่งรอบของ slice, คำสั่ง CLI และตัวอย่างสำหรับ consumer |

หมายเหตุ: `www.tmd.go.th` ส่งใบรับรอง TLS มาไม่ครบสาย จึงแนบใบกลางสาธารณะของ GlobalSign ไว้ที่ `sources/tmd_cap/certs/` (ยังตรวจใบรับรองเต็มรูปแบบ) และต้องตรวจซ้ำหลังกรมอุตุฯ ต่ออายุใบรับรอง (ใบปัจจุบันหมดอายุ 2026-10-09)
