# fontokmai (ฝนตกไหม)

เว็บติดตามฝน น้ำ และน้ำท่วมของประเทศไทย ใช้ฟรีและไม่แสวงหากำไร · **กำลังพัฒนา (เฟส P0)** เปิดดูรุ่นพัฒนาได้ที่ลิงก์ด้านล่าง

A free, noncommercial Thai rain and flood tracker. Work in progress (phase P0).

## เปิดเว็บ
- **หน้าเว็บ**: https://dizconnectz.github.io/fontokmai/
  - รุ่นพัฒนา P0 ตอนนี้มีประกาศเตือนภัยของกรมอุตุนิยมวิทยาบนแผนที่
  - อัปเดตเว็บอัตโนมัติเมื่อโค้ดบน `main` ผ่านการทดสอบ
- **ไฟล์ข้อมูล** (สำหรับนักพัฒนา): https://dizconnectz.github.io/fontokmai-data/data/v1/manifest.json อัปเดตทุก 15 นาทีจาก VPS
- **เปิดในเครื่อง**: ดู [apps/web/README.md](apps/web/README.md) (ต้องมี Node.js 24)

## เอกสาร
- แบบระบบ: [docs/design/fontokmai-design.md](docs/design/fontokmai-design.md)
- แหล่งข้อมูลและสิทธิ์: [docs/sources.md](docs/sources.md)
- สัญญาข้อมูลสำหรับหน้าเว็บ: [contracts/v1/README.md](contracts/v1/README.md)
- แผนงาน: [docs/superpowers/plans/](docs/superpowers/plans/)
- ข้อตกลงการทำงานของทีม (Claude + Codex): [AGENTS.md](AGENTS.md)

## ส่วนเก็บและประมวลผลข้อมูล
อยู่ใน [pipeline/](pipeline/README.md) ตอนนี้มีตัวเก็บประกาศเตือนภัยของกรมอุตุนิยมวิทยา (CAP) ที่เขียนไฟล์ `/data/v1` ได้

```bash
cd pipeline
uv sync
uv run pytest
uv run fontokmai cap-snapshot --db ../state/dev.db --out ../out/data/v1
```

## License
- **โค้ด**: PolyForm Noncommercial 1.0.0 ใช้ ศึกษา และแก้ไขได้เพื่อวัตถุประสงค์ที่ไม่ใช่เชิงพาณิชย์ และต้องส่งต่อบรรทัด Required Notice ใน [NOTICE](NOTICE) กับข้อความใน [LICENSE](LICENSE) ไปกับทุกสำเนา
- **เนื้อหาและข้อมูลที่ fontokmai สร้าง**: CC BY-NC 4.0 โดยให้เครดิต “fontokmai by Takuma”
- **ข้อมูลของหน่วยงานอื่น** ยังเป็นไปตามเงื่อนไขของแหล่งนั้น (ดู [docs/sources.md](docs/sources.md)) เช่น ข้อมูลของกรมอุตุฯ ต้องระบุ “กรมอุตุนิยมวิทยา” ทุกครั้ง

fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยาหรือหน่วยงานใด ประกาศทางการของหน่วยงานแสดงก่อนเสมอ และค่าที่ระบบคำนวณเองเป็นค่าทดลอง

fontokmai is not affiliated with or endorsed by the Thai Meteorological Department or any other agency.
