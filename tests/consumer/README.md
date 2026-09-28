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

รีวิว 2026-09-27–28: สัญญา DXS/GloFAS และ M13–M22 ไม่มี expected-failure แล้ว ชุดใหม่ `overview.test.ts`, `overview-browser.spec.mjs`, `test_overview_delivery.py` ตรวจสรุปข้อ 21, วัน/อายุ/ประกาศ, เพดาน 40/ชื่อ ทช., axe และคีย์บอร์ดบน desktop/mobile ส่วน `evaluation.ts` + `evaluation.test.ts` เป็นตัวคำนวณอ้างอิงสำหรับ [แผนวัดความแม่น](../../docs/design/accuracy-evaluation.md) ไม่ใช่โค้ดที่เว็บใช้งานจริง

รัน consumer ฝั่ง Python จากราก repo (CI `ci` รันชุดนี้ทั้งหมดแล้ว):

```sh
uv run --project pipeline pytest tests/consumer -o addopts='' -q
```

ปัญหาใหม่ M23–M28 บน `d418cc2`: **strict expected-failure 4 Python + 3 browser** สำหรับที่มาเกณฑ์ สสน., พื้นที่ฝนที่สรุปเกินจริง (สองกรณี), วันรายงานเขื่อนเก่า, popup ย้าย focus สรุปรายงานที่หมดอายุ และคอนทราสต์ปุ่มโหมดมืด เครื่องหมายเหล่านี้บันทึกบั๊กที่ทำซ้ำได้ ไม่ใช่การยืนยันว่าถูกต้อง; เมื่อ Claude แก้ให้ถอดทันที (unexpected pass ทำให้ CI ล้ม) browser ทำเครื่องหมายหลังขั้นเตรียม/ตรวจผลระหว่างทางสำเร็จแล้ว รายละเอียดและเกณฑ์ปิดอยู่ A6 และ private handoff 2026-09-28

ดู assertion ที่กำลังล้มจริงใน Python ได้ด้วย `--runxfail` (จะจบด้วย exit 1 ตามบั๊กที่ยังเปิดอยู่) การผ่านเทสต์ค่าคณิตศาสตร์/เวลาไม่ยืนยันความแม่นพยากรณ์ในพื้นที่จริง
