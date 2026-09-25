# สัญญาข้อมูล v1 — slice แรก: ประกาศทางการจาก TMD CAP

สิ่งที่ Claude ส่งให้ Codex เริ่มหน้าเว็บ (D24) ตามหัวข้อ 3 ของรีวิว v6 · ต้นทางของสัญญาคือ Pydantic ใน `pipeline/src/fontokmai/contracts/`

| ส่วน | ที่อยู่ | หมายเหตุ |
|---|---|---|
| JSON Schema | `schema/alerts.schema.json`, `schema/manifest.schema.json` | generated ห้ามแก้ด้วยมือ |
| TypeScript types | `ts/alerts.ts`, `ts/manifest.ts` | generated ด้วย `scripts/gen-ts-types.sh` (json-schema-to-typescript 16.0.0) ห้ามแก้ด้วยมือ |
| ตัวอย่าง | `examples/<กรณี>/manifest.json`, `alerts.json`, `expected.json` | สองไฟล์แรกคือสิ่งที่ producer เขียนจริงทุกไบต์ ส่วน `expected.json` คือผลที่ consumer ต้องได้ |

สร้างใหม่ทั้งหมด (CI ตรวจว่าไฟล์ที่ commit ตรงกับที่สร้างได้):
```bash
cd pipeline
uv run fontokmai export-schemas --out ../contracts/v1/schema
uv run fontokmai contract-examples --out ../contracts/v1/examples --real-fixtures tests/fixtures/tmd_cap --synthetic-fixtures tests/fixtures/tmd_cap_synthetic
cd .. && bash scripts/gen-ts-types.sh
```

## 1. Data base URL และลำดับการโหลด
- ไฟล์ข้อมูลอยู่ใต้ `DATA_BASE_URL` ซึ่งเป็น config ของเว็บ และเปลี่ยน host ได้โดยไม่ rebuild
  - **ช่วงพัฒนา (ใช้งานได้แล้ว)**: `https://dizconnectz.github.io/fontokmai-data/data/v1/` อัปเดตจาก VPS ทุก 15 นาที (รอบ :03/:18/:33/:48) และ GitHub Pages อาจใช้เวลาอีก 1–3 นาทีหลังอัปโหลด
  - host นี้ส่ง `Access-Control-Allow-Origin: *` และ `Cache-Control: max-age=600` จึงต้องต่อท้าย `manifest.json?t=<เวลาปัจจุบัน>` เพื่อข้าม cache ของ CDN
  - ผู้ใช้เลือก GitHub Pages เป็น host (D28) · ถ้าย้ายไป Cloudflare Pages ภายหลัง ให้เปลี่ยนค่านี้อย่างเดียว
- ลำดับ:
  1. โหลด `manifest.json` แบบไม่ใช้ cache และตรวจ `schema_version === "1"`
  2. โหลดไฟล์ตาม `files[].path` (ต่อท้าย `?g=<generation_id>` เพื่อกัน cache เก่า)
  3. ตรวจว่า `generation_id` ในไฟล์ข้อมูลตรงกับ manifest
- ถ้าไม่ตรงกัน แปลว่าไฟล์ปนรุ่น:
  - โหลด manifest ใหม่ 1 ครั้ง
  - ถ้ายังไม่ตรง ให้แสดงชุดก่อนหน้าที่ครบพร้อมข้อความ “กำลังอัปเดต”
  - ห้ามรวมไฟล์ต่างรุ่น (ดู `examples/mixed-generation`)
- ตรวจ `sha256` กับ `size` เพิ่มเองได้ แต่ไม่บังคับ

## 2. ความสด ความครบ และสถานะแหล่ง
- **stale** เมื่อ `now > next_due_at + 15 นาที` โดยใช้นาฬิกาของเครื่องผู้ใช้ เพราะถ้าระบบหยุดทั้งชุด ไฟล์เก่าจะยังบอกว่าปกติ → แสดง “ข้อมูลไม่อัปเดต ตั้งแต่ …”
- **completeness**:
  - `complete` = ทุกแหล่งใน `source_status` เป็น `ok`
  - `partial` = มีบางแหล่งเป็น `degraded` หรือ `failed`
- **source_status[].status**:
  - `ok`
  - `degraded` = ดึงบางฉบับไม่ได้
  - `failed` = ดึงหน้ารวมไม่ได้ แต่ยังแสดงประกาศที่เก็บไว้แล้ว พร้อม `last_success_at` (ดู `examples/source-failed`)

## 3. เวลา null หน่วย และพิกัด
- เวลาเป็น ISO 8601 ที่มี offset เสมอ:
  - เวลาจาก CAP คง `+07:00` ตามต้นฉบับ
  - เวลาที่ระบบสร้าง (`generated_at`, `feed_generated_at`, `last_attempt_at`) เป็น UTC (`Z`)
  - แสดงผลเป็นเวลา `Asia/Bangkok` และห้ามเดา timezone เอง
- `null` = ต้นฉบับไม่มีค่า ไม่ได้แปลว่าศูนย์หรือ “ไม่มีภัย”
- `geometry` เป็น GeoJSON `MultiPolygon` ลำดับ `[longitude, latitude]` (WGS84) หรือ `null` · ประกาศของกรมอุตุฯ มี 16–164 polygon ต่อฉบับ
- `targets[]` เป็นรหัสจังหวัด ISO 3166-2 (เช่น `TH-10` = กรุงเทพมหานคร, `TH-13` = ปทุมธานี)

## 4. ประกาศ: message, event และ revision
- **event**: หนึ่งประกาศบนเว็บคือหนึ่ง event (`event_id` เช่น `tmd:TMD20260925071317_2`) ซึ่งรวม message ที่อ้างถึงกัน (Alert → Update → Cancel)
  - `source_message_id` = ฉบับล่าสุดที่ใช้แสดง
  - `supersedes` = ฉบับที่ฉบับนี้อ้างถึง
- **revision** ของ event เพิ่มเมื่อเนื้อหาที่แสดงเปลี่ยน รวมถึงเปลี่ยนสถานะ เช่น pending → active แต่ไม่เพิ่มเพียงเพราะดึงข้อมูลรอบใหม่
- **lifecycle_status**:
  - `pending` = ยังไม่ถึง `effective` แสดงล่วงหน้าได้พร้อมเวลาเริ่ม
  - `active` = มีผลอยู่ (`is_effective` เป็น true เฉพาะสถานะนี้)
  - `expired` และ `cancelled` อยู่ใน `tombstones` ไม่ใช่ประกาศที่มีผล
- **expires_policy**:
  - `source` = ใช้ `expires` ของต้นฉบับ
  - `default_24h` = 24 ชม. หลังเวลาที่ช้ากว่าระหว่าง `sent` กับ `effective` ใช้เมื่อต้นฉบับไม่มี `expires` หรือ `expires` ไม่ช้ากว่า `effective` โดย `qc_flags` บอกเหตุ (`missing_expires` หรือ `expires_not_after_effective`) → UI ควรบอกว่า “เวลาสิ้นสุดเป็นค่าประมาณ”
  - ข้อมูลจริงมีกรณีนี้แล้ว: TMD20260925163148_2 ระบุ `expires` 06:00 ก่อน `effective` 08:00
- ไฟล์มีเฉพาะฉบับ `status=Actual` และ `scope=Public` · ฉบับ Test/Exercise/System ไม่อยู่ในไฟล์
- เหตุที่ถูก Cancel แล้วจะไม่กลับเป็น active แม้ฉบับเก่ามาถึงทีหลัง (ดู `examples/out-of-order`)
- `notify_eligible` เป็น false ทั้งหมดใน P0/P1 เพราะยังไม่มีระบบแจ้งเตือน
- **เครดิต**: แสดง `credit_th` (“กรมอุตุนิยมวิทยา”) และลิงก์ `source_url` ทุกครั้ง พร้อมข้อความว่า fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยา

## 5. feed_sequence, recovery_epoch และ cursor
- `feed_sequence` เพิ่มเมื่อ `alerts` หรือ `tombstones` เปลี่ยน ใช้เป็น cursor ให้ consumer ที่เก็บสถานะไว้ (เช่นแท็บที่เปิดค้าง) อัปเดตเมื่อค่าเพิ่ม
- `recovery_epoch` เปลี่ยนเมื่อระบบกู้สถานะที่เคยเผยแพร่ไม่ได้ (design 4.4 และ F1 ในรีวิว v6) → consumer ล้างสถานะที่เก็บไว้แล้วอ่าน feed ใหม่ทั้งชุด และไม่เทียบ `feed_sequence` ข้าม epoch
- `tombstones` มีเหตุที่จบภายใน 7 วันล่าสุด (`history_since`)
- `owner_epoch` ใน manifest เป็นหมายเลขผู้เผยแพร่ปัจจุบัน (เพิ่มเมื่อ takeover หรือ failback) ใช้ตรวจสอบย้อนหลัง consumer ไม่ต้องตัดสินใจจากค่านี้

## 6. ยังไม่รองรับใน slice นี้
- ยังไม่มีข้อมูลเหล่านี้ใน manifest: พยากรณ์, โซนเสี่ยงน้ำท่วม, สถานีฝนและระดับน้ำ, เขื่อน, CCTV และข่าว
  - UI ต้องแสดง “ยังไม่มีข้อมูล” ห้ามแสดงศูนย์หรือข้อมูลจำลองเหมือนข้อมูลจริง
  - ต้องรองรับไฟล์ใหม่ใน `files[]` ในอนาคตโดยไม่พัง
- ยังไม่มี host และการ deploy จริง (P0-B)

## 7. ตัวอย่าง
| กรณี | สิ่งที่ครอบคลุม |
|---|---|
| `active` | ประกาศจริง 2026-09-25 ที่ 18:20: active 3 เหตุ (1 เหตุเป็น `default_24h` + qc flag) และ tombstones 6 |
| `pending` | ชุดเดียวกันที่ 17:30: TMD20260925163420_2 เป็น pending (มีผล 18:01) |
| `expired` | 2026-09-26 18:00: ไม่มีประกาศที่มีผล เหลือ tombstones 9 |
| `source-failed` | ดึงหน้ารวมไม่ได้: `partial` + ยังแสดงของเดิม + `last_success_at` |
| `cancelled` | ข้อมูลสังเคราะห์: Alert แล้วตามด้วย Cancel |
| `out-of-order` | ข้อมูลสังเคราะห์: Cancel มาก่อน Alert ต้นฉบับ |
| `mixed-generation` | `generation_id` ของ manifest กับ alerts ไม่ตรงกัน → ห้ามรวม |

`expected.json` มี field ดังนี้:
- `generation_match`
- `completeness`
- `stale_after`
- `recovery_epoch`
- `feed_sequence`
- `visible_alerts[]`: event, สถานะ, revision, effective/expires, policy, qc_flags
- `ended_events[]`
- `source_status[]`

ข้อมูลสังเคราะห์ระบุชัดในหัวข้อว่าไม่ใช่ประกาศจริง
