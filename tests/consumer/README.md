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
