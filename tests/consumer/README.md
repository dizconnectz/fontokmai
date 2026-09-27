# การทดสอบฝั่งรับข้อมูล

ชุดนี้อยู่แยกจาก `apps/web` ตาม D29 แต่เรียกโค้ดที่เว็บใช้จริงและตัวอย่างใน `contracts/v1/examples` โดยตรง ใช้ dependency จาก `apps/web/package-lock.json` ไม่ติดตั้งอีกชุด

รันจากราก repo:

```sh
npm --prefix apps/web ci
node apps/web/node_modules/vitest/vitest.mjs run --config tests/consumer/vitest.config.mts
npm --prefix apps/web run build
node apps/web/node_modules/@playwright/test/cli.js install chromium
node apps/web/node_modules/@playwright/test/cli.js test --config tests/consumer/playwright.config.mjs
```

CI `web` รันทั้งสองชุดด้วย Chromium; ชุดหลักของเว็บยังตรวจ Chromium desktop/mobile และ WebKit ตามเดิม ชุด browser นี้เปิด preview แยกที่พอร์ต 4180 และจำลองข้อมูล/แผนที่/Photon เพื่อไม่เรียกแหล่งจริงหรือใช้โควตา API

ครอบคลุมการค้นสถานที่และความเป็นส่วนตัวของคำค้น, พิกัดเรดาร์เทียบ MapLibre, หน่วย/null ของพยากรณ์, พื้นที่ vector `forecastAreas` เทียบค่าที่หมุดในละติจูดต่างกัน, การเปลี่ยนรุ่นและการถอดไฟล์จาก manifest, อายุ/ระยะของรายงานน้ำท่วม และกรณีถดถอย M4–M7 ไม่เรียก `forecastFrame` แล้ว

ผลผ่านยืนยันพฤติกรรมของ consumer ตามกรณีทดสอบ ไม่ได้ยืนยันสิทธิ์เผยแพร่ของแหล่งข้อมูล ความแม่นของพยากรณ์ หรือสถานะ deploy

รีวิว 2026-09-27 เพิ่ม `rivers.test.ts` และ `rivers-browser.spec.mjs` สำหรับสัญญาข้อ 20, ความหมายค่าฝน/ระดับน้ำ และ popup ที่เปิดค้าง ชุดเก่า M13–M16 ไม่มี expected-failure แล้ว แต่พบส่วนที่ M14 ยังตกหล่นและตั้งเป็น M17 (popup เกิน 12 ชม. เมื่อยังมีรายงานอื่น)

ปัญหาใหม่ที่ทำซ้ำบน `8aed643` และยังรอ Claude แก้: M17/M20/M21 ใช้ `test.fail` เฉพาะหลังขั้นเตรียมข้อมูลและเปิด popup สำเร็จ ส่วน M18/M19 ใช้ `it.fails` เพื่อให้ CI ตรวจปัญหาที่ทราบโดยไม่ขัดขวางงานอื่น **ไม่ใช่การยืนยันว่าพฤติกรรมนั้นถูกต้อง** เมื่อแก้แล้วต้องถอดเครื่องหมายเหล่านี้ มิฉะนั้นการผ่านโดยไม่คาดหมายจะทำให้ CI ล้ม ดูวิธีทำซ้ำและเกณฑ์ปิดใน A6 ของ `AGENTS.md` (รายละเอียดยาวอยู่ใน private handoff)
