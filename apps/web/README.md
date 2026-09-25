# เว็บ fontokmai — P0 ประกาศทางการ

Vite + React + TypeScript + MapLibre GL JS ใช้สัญญาและ types ใน [`contracts/v1`](../../contracts/v1/README.md) โดยไม่แก้ generated files

รุ่นนี้อ่านประกาศ TMD CAP จาก pipeline ที่เผยแพร่บน GitHub Pages มีแผนที่ขอบเขตประกาศ รายการ ค้นหาข้อความ/จังหวัด รายละเอียด ลิงก์ต้นฉบับ และบันทึกประกาศไว้ในเครื่อง ไม่มีบัญชีและยังไม่ส่งแจ้งเตือน

**ยังไม่มี** ฝนตรวจวัด พยากรณ์ 7 วัน น้ำท่วม ระดับน้ำ เขื่อน CCTV ข่าว gazetteer หรือหน้ารายตำบล ช่องค้นหาจึงไม่ยืนยันว่าพิกัดหนึ่งได้รับผลกระทบ พื้นที่สีเป็นขอบเขตประกาศ ไม่ใช่พื้นที่น้ำท่วม

## เปิดในเครื่อง

ใช้ Node.js 24 และ npm (ล็อก dependencies ใน `package-lock.json`)

```powershell
cd apps/web
npm ci
npm run dev
```

## ตั้งค่าแหล่งข้อมูล

แก้ `public/config.json` ตอนพัฒนา หรือ `/config.json` บน host หลัง build ไม่ต้อง rebuild JavaScript:

```json
{
  "DATA_BASE_URL": "https://dizconnectz.github.io/fontokmai-data/data/v1/",
  "DATA_MODE": "live"
}
```

ข้อมูลจาก VPS เผยแพร่ทุก 15 นาที เว็บถาม manifest ทุก 60 วินาทีเฉพาะตอนแท็บเปิด และถามเมื่อกลับเข้าแท็บ/ออนไลน์ ใช้ `cache: no-store` และ `?t=` เพื่อข้าม CDN ส่วนประกาศใช้ `?g=<generation_id>` ถ้ารุ่นและ metadata เดิมจะใช้ประกาศที่ตรวจแล้วในหน่วยความจำ ไม่ดาวน์โหลดซ้ำทุกนาที

สำหรับทดสอบในเครื่อง เปลี่ยนเป็น `DATA_BASE_URL: "/examples/active/"` และ `DATA_MODE: "example"` เว็บจะติดป้ายข้อมูลตัวอย่าง สามารถใช้ active, pending, expired, source-failed, cancelled, out-of-order และ mixed-generation ได้ Vite อ่าน/คัดลอก fixtures จากต้นทางตอน dev/build ไม่มีไฟล์ตัวอย่างอีกชุดใน source ของเว็บ และไม่มี fixture fallback อัตโนมัติเมื่อข้อมูลจริงเสีย

ข้อมูลที่ดึงจากภายนอกมีเพียง host ของ pipeline และแผนที่ฐาน OpenFreeMap เว็บไม่อ่าน ThaiWater หรือหน้าเว็บ กทม. โดยตรง (D27)

## การอ่านสัญญา

- ตรวจ JSON Schema ของ known fields, `schema_version`, `generation_id` และ `recovery_epoch` รับ field เพิ่มและไม่โหลดไฟล์ชนิดที่ยังไม่รองรับ
- ถ้าไฟล์ปนรุ่น โหลด manifest ใหม่ได้อีกหนึ่งครั้ง หากยังไม่ตรง เก็บชุดที่ตรวจแล้วไว้และขึ้น “กำลังอัปเดต” หากยังไม่มีชุดเดิมจะไม่แสดงประกาศ
- ตรวจอายุด้วยนาฬิกาเบราว์เซอร์: `now > next_due_at + 15 นาที` ไม่ใช้เวลาดาวน์โหลดแทนเวลาแหล่งข้อมูล
- feed เป็น full snapshot: เปลี่ยนทั้งชุดเมื่อ recovery epoch เพิ่ม ห้าม cursor/เวลาเผยแพร่ย้อนใน epoch เดิม เก็บ cursor ในหน่วยความจำเท่านั้น
- tombstone ชนะฉบับเก่า ไม่แสดง expired/cancelled บนแผนที่ และตรวจ effective/expires ทุก 15 วินาทีแม้ pipeline หยุด
- เวลาสิ้นสุดที่ producer ใช้ค่าตั้งต้นมีป้ายประมาณ แหล่ง failed/degraded แสดงเวลาสำเร็จล่าสุด ทุกเวลาบนเว็บเป็น Asia/Bangkok
- การบันทึกประกาศใช้ localStorage ถ้า browser ไม่อนุญาตจะบอกว่าเก็บได้เฉพาะแท็บนี้

## ทดสอบและ build

```powershell
npm test
npm run check:licenses
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

E2E เปิด **production build** ผ่าน `vite preview` ทดสอบ Chromium desktop, Chromium mobile และ WebKit mobile ด้วย fixtures และพื้นแผนที่ที่ควบคุมได้ ไม่พึ่งเครือข่ายภายนอก ใช้ axe ตรวจ WCAG A/AA การจำลอง browser ไม่แทนการทดสอบด้วย Android Chrome/iOS Safari บนอุปกรณ์จริง

MapLibre 6 ต้องตั้ง `setWorkerUrl` ด้วย `maplibre-gl-worker.mjs?worker&url` เพื่อให้ Vite bundle worker และ dependencies มาด้วย ตาม [คู่มือติดตั้ง MapLibre](https://maplibre.org/maplibre-gl-js/docs/) การทดสอบกด polygon ใน build จริงตรวจทั้ง worker และพื้นที่แสดงผลของ canvas

ตรวจข้อมูล/แผนที่จริงแยกจาก merge gate เปิดสอง terminal:

```powershell
npm run preview
# อีก terminal
npm run smoke:live
```

บันทึก screenshots ใน `test-results/live/` (ไม่ commit) พร้อม generation ที่อ่านได้ จำนวนประกาศและสถานะ request glyph/แผนที่ ผลนี้บอกว่าการเชื่อมข้อมูล/แสดงผลทำงาน ไม่ใช่การวัดความแม่นของพยากรณ์

## การเผยแพร่เว็บ

โค้ดเว็บกับข้อมูลแยกกัน Build จาก repo root ด้วย `npm --prefix apps/web ci` และ `npm --prefix apps/web run build` แล้วนำ `apps/web/dist` ไปใช้กับ static host (Cloudflare Pages ตามแบบ) ไม่ต้องมี secret ใน browser และไม่ต้องอัปโหลดเว็บใหม่ทุกครั้งที่ข้อมูลเปลี่ยน

`/sources/` และ `/method/` เป็น HTML ที่อ่านได้แม้ปิด JavaScript ลิงก์ประกาศใช้ `/?alert=<event_id>` จึงไม่ต้องตั้ง route รายประกาศ `public/_headers` เตรียม cache ของ config และ security headers สำหรับ Cloudflare Pages ต้องตรวจ headers และลิงก์บน host จริงอีกครั้งเมื่อ deploy

ยังไม่ติดตั้ง service worker เพื่อไม่ cache ประกาศเก่าข้าม session ยังไม่ได้ deploy เว็บด้วยงานนี้ การโหลด MapLibre แยก chunk ประมาณ 276 KB gzip จากหน้าแรก มีมุมมองรายการและ fallback เมื่อ WebGL/แผนที่ฐาน/ส่วนแผนที่โหลดไม่ได้

## สิทธิ์และเครดิต

โค้ดใช้ LICENSE/NOTICE ที่ราก repo ส่วนแหล่งข้อมูลยังใช้สิทธิ์ของต้นทาง เว็บแสดงเครดิตกรมอุตุนิยมวิทยาและข้อความไม่เกี่ยวข้อง/ไม่ได้รับการสนับสนุน พร้อมเครดิต OpenFreeMap / OpenMapTiles / OpenStreetMap

`check-licenses.mjs` ตรวจทุก package ใน lockfile ไม่ยอมรับตระกูล GPL และหยุดเมื่อพบ license ที่ยังไม่ตรวจ สำหรับข้อยกเว้นที่ตรวจแล้ว:

- Noto Sans Thai ใช้ OFL-1.1 แจกฟอนต์เดิมพร้อมใบอนุญาต แยกสิทธิ์จากโค้ดโครงการ
- axe-core และ Lightning CSS ใช้ MPL-2.0 เป็นเครื่องมือ dev/test ไม่ได้ส่ง source ของเครื่องมือไปกับเว็บ ไม่แก้ไฟล์ของเครื่องมือ
- MIT license ของ murmurhash-js อยู่ท้าย README ของแพ็กเกจ จึงดึงส่วนนั้นมาเก็บใน notices

ขั้น build สร้าง `THIRD-PARTY-NOTICES.txt`, คัดลอก FONT-LICENSE, LICENSE และ NOTICE ไปกับเว็บไซต์ ก่อน push ต้องรัน `python scripts/check_repo_safety.py` **จาก repo root หลัง stage ไฟล์ใหม่** เพื่อให้ scanner เห็นทุกไฟล์ที่กำลังจะ commit

fontokmai by Takuma · fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยา
