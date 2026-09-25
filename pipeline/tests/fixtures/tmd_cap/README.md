# TMD CAP fixtures (ข้อมูลจริง)

- ดาวน์โหลดเมื่อ 2026-09-25 ประมาณ 18:16 ICT จาก `https://www.tmd.go.th/api/xml/CAP` (RSS index) และไฟล์ CAP XML ทั้ง 13 ฉบับที่ index ลิงก์ไป (`https://www.tmd.go.th/uploads/CAP/...`)
- ที่มา: กรมอุตุนิยมวิทยา · channel ของ RSS ระบุ `public domain` (ใช้ได้เฉพาะ CAP channel นี้ ดู `docs/sources.md`) · fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยา
- เก็บไว้ทุกไบต์ตามต้นฉบับ (BOM, CRLF, ลายเซ็นดิจิทัล) ผ่าน `.gitattributes` เพื่อใช้เป็นชุดทดสอบถดถอย
- ข้อสังเกตจากข้อมูลจริง:
  - ทุกไฟล์ CAP ขึ้นต้นด้วย BOM และมี `<Signature>` แนบมา
  - RSS `pubDate` เป็นเวลา UTC แต่ติด `+0700` (เช่น 09:34 +0700 ขณะที่ CAP `sent` คือ 16:34 +07:00)
  - `CAPTMD20260925163148_2.xml` (Update) มี `expires` 06:00 ก่อน `effective` 08:00 → ระบบใช้ expiry ตั้งต้นและติด `qc_flags`
- ชุด `../tmd_cap_synthetic/` เป็นข้อมูลสังเคราะห์สำหรับกรณีที่ข้อมูลจริงไม่มี (Cancel, มาสลับลำดับ) ไม่ใช่ประกาศจริง
