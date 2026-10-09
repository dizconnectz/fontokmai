# บันทึกที่ย้ายออกจาก AGENTS.md

AGENTS.md ต้องไม่เกิน 32 KiB จึงย้ายส่วนที่ไม่ได้ใช้งานแล้วมาเก็บที่นี่แบบไม่ตัดทอน (ห้ามลบประวัติ) · ใหม่สุดอยู่บน
ควรย้ายไป `private/handoffs/` เมื่อมีคนเข้าถึง private repo ได้ (Claude ในเครื่อง cloud เข้าไม่ได้)

## 2026-10-09 (Claude: ย้าย A6 เก่าสุดเพื่อให้ AGENTS.md ไม่เกิน 32 KiB)

#### 2026-10-05 10:20 ICT — ทวนคลอง v6, deploy VPS, แก้ smoke M62 (Codex)
- M62: `live-smoke.mjs` รอ `.source-times` ที่ UX เอาออกแล้ว; เปลี่ยนเป็นรอแถบข้อมูลพ้นสถานะโหลด · production smoke ผ่าน desktop+มือถือ generation `20261005T031800Z-vps`, แผนที่พร้อม, ไม่มี request ล้มเหลวหรือ JS error
- ทดสอบ: `uv run pytest -q`, `uv run ruff check .`, `npm test -- --run` (167), `npm run build`, `npm audit --omit=dev` (0 ช่องโหว่) ผ่าน · `npm run test:e2e`: Chromium desktop/มือถือ 110 ผ่าน; WebKit 55 กรณีเปิด context ไม่ได้บน Windows นี้ และทดสอบ WebKit เปล่าก็ปิดก่อนสร้างหน้า · GitHub `web` workflow ที่ `8790b50` ผ่านรวม WebKit · Prettier บนเครื่องเจอไฟล์ `.cls` นอก Git; workflow ผ่าน
- deploy ด้วย `deploy/vps/deploy.sh` ถึง `8790b50`; รอบ `03:18Z` `ok=true`, เผยแพร่ generation ด้านบน · คลอง `canals-v6`: 56 เส้น, เฝ้าดู 3, ต่ำกว่าเกณฑ์ทดลอง 53, ข้อมูลไม่พอ 0 · container UID 1001, RAM 33/512 MiB, 2 PIDs, restart 0 · ดิสก์ 72% เหลือ 23 GB · ไม่แตะ container งานอื่น; พบ one-off `fontokmai-flood-freq` จบ `exit 0` แล้ว ปล่อยไว้
- สูตรคลองยังเป็นคะแนนปัจจัยทดลอง ไม่ใช่แบบจำลองไฮดรอลิก/ขอบเขตน้ำท่วมและยังไม่ backtest · ปั๊มนับจำนวนที่เดิน ไม่ได้วัดอัตราระบาย; DXS ไม่มีระดับตลิ่ง · C.35 JSON อนุญาตแล้วตาม D37 แต่ข้อมูลสำรองจะเปลี่ยนเมื่อผู้ใช้รัน `bkk-fetch` จากเครื่องในไทยเท่านั้น
- ข้อสังเกต: build ยังเตือน bundle `index` 606 KB + MapLibre 1,063 KB (gzip 176 + 286 KB); container ไม่ root และมีเพดานทรัพยากร ไม่มี port เปิด แต่ rootfs ยังเขียนได้และไม่ได้ drop capabilities — เป็น hardening ที่ทำเพิ่มได้ · รายละเอียดก่อนหน้าอยู่ใน `docs/agents-archive.md`

- **C.35 JSON/VPS**: อนุญาตใช้ตัวเลขที่หน้าเผยแพร่แสดงภายใต้ D35/D37 พร้อมเครดิตและลิงก์; `bkk-fetch` อ่านตอนผู้ใช้กดอัปเดตจากเครื่องในไทย ไม่มีการดึงอัตโนมัติ · VPS ใช้ไฟล์สำเนาล่าสุดถ้ายังไม่เกิน 36 ชั่วโมง · ตรวจระบบ/อัปเดต VPS แล้ว 2026-10-05 (ดู A6)
    // Wait for the current data chip to leave its loading state; the old `.source-times` element was removed when
    // the header was simplified (Codex M62).
    await expect(page.locator('.data-chip')).not.toContainText('กำลังโหลด…', { timeout: 30_000 });

## 2026-10-08 13:50 (Claude: ย้าย A6 เพื่อให้ AGENTS.md ไม่เกิน 32 KiB)

#### 2026-10-04 21:15 ICT — คลอง กทม. + ลิงก์ Longdo Water (Claude, ผู้ใช้ให้อำนาจทำแทน Codex)
- `ref/canals.json` +50 คลอง กทม. (`bkk-*`, คลองที่มีสถานี DXS ≥2 · เส้น OSM จาก BBBike + OSM API ฝั่งตะวันออก, Overpass ใช้ไม่ได้จาก cloud) สร้างด้วย `ref_data/build_canals_bkk.py` (รันมือ) · canals-v6 เพิ่มปัจจัย `pumps` (สูบครบทุกเครื่อง +1) · ลิงก์ "ดูระยะถึงตลิ่งที่ Longdo Water ↗" ในหมุดระดับน้ำ กทม. และการ์ดหมุด (`longdo.ts`, ไม่ใส่ SDK เพราะเรียก API ThaiWater D27)
- ทดสอบ pytest/ruff/vitest167/tsc/prettier ผ่าน · consumer `test_archive_edges` ล้มในเครื่องทั้งบน main เดิม (สภาพเครื่อง) · ยังไม่ได้เห็นหน้าจอจริง (แผนที่ฐานไม่โหลดในเครื่อง cloud) · ต้อง deploy VPS เพื่อให้คลองขึ้นเว็บ
- **PC ผู้ใช้**: สคริปต์อัปเดต กทม. รันจาก clone แยก `~/.fontokmai/app` (pull ตาม main ทุกรอบ ห้ามแก้โค้ดในนั้น) · C.35 สำรอง D37 · ประวัติเต็ม `docs/agents-archive.md`
- ข้อจำกัด: DXS ไม่มีตลิ่ง คะแนนบอก "แรงกดดัน" ไม่ใช่ล้นจริง · คลองชื่อไม่ตรง OSM ไม่วาด (พระยาราชมนตรี คูน้ำวิภาวดี ฯลฯ)

#### 2026-10-04 19:54 ICT — กรองค่า C.35 และปิดรอบเว็บ/รีวิว (M61) (Codex)
- พบแถว Q ติดลบล่าสุดที่ไม่มีระดับน้ำอาจบังชั่วโมงเก่าที่ยังใช้ได้ · ปฏิเสธ Q ติดลบ/ไม่จำกัด/เกินช่วง float ก่อนเลือกชั่วโมง พร้อม regression tests · ยังไม่เรียก `bkk-fetch` ระหว่างรอผู้ใช้ตัดสินสิทธิ์ source (D27/D35)
- push `424844f`; CI `37202691126`, web `37202691149` (รวม WebKit/consumer E2E), Pages `37203235680` ผ่าน · production ไม่มี JS errors
- pipeline 324 tests, Vitest 166, Chromium regression 4 ผ่าน; `npm audit --omit=dev` 0 ช่องโหว่ · CLS production desktop แกว่ง 0.13–0.20, มือถือเครือข่ายช้า 0.042; main bundle 605 KB + MapLibre 1,063 KB
- VPS รอภายหลังตามผู้ใช้; ความแม่นยังไม่มี backtest · สิทธิ์ C.35 JSON ยังรอผู้ใช้ตัดสิน (C1)

#### 2026-10-04 18:56 ICT — แถบสรุป/CLS (M59–M60) (Codex)
- เว็บจริงก่อน M60: CLS desktop 0.277, มือถือ 0.083; แถบ 7 สถานะตัดบรรทัด และ feed ว่างถอดส่วนสูง 227 px · พับสถานะรองไว้ใต้ “ดูอีก N สถานะ”; ประกาศว่างยืนยันในพื้นที่คงที่ 84 px ไม่มีการ์ดซ้ำ
- M60 push `53e7843`; CI `37200918213`/web `37200918221`/Pages `37201527767` ผ่าน · พับสถานะรองแล้ว; M61 ปรับสถานะไม่มีประกาศเป็น 2 บรรทัดขั้นต่ำ 84 px และบอกขอบเขตข้อมูล ไม่สื่อว่าปลอดภัย
- ไม่เปลี่ยนสูตร; ความแม่นยังไม่มี backtest · รายละเอียด `private/handoffs/2026-10-04-codex-cls-m59.md`


## 2026-10-04 21:15 (Claude: ย้าย A6 เพื่อให้ AGENTS.md ไม่เกิน 32 KiB)

#### 2026-10-04 18:45 ICT — GISTDA, M55, กล้อง DWR, C.35 ตัวเลขสำรอง (Claude)
- merged PR #3–#11: M55 สีนอกแถบสีไม่นับเป็นฝน · กล้อง DWR 128 ตัว `cctv/mjpeg/{code}` · GISTDA `floods/satellite.json` (สัญญา28) + ชั้นแผนที่ + การ์ดหมุด + "ที่ของฉัน" + overview `satellite_flood` · ท่วมซ้ำ `ref/flood_freq.json` (สัญญา29, `flood-freq` รันมือ) · คู่มือ `docs/apis/gistda.md` · DXS วันที่ พ.ศ. 29 ก.พ. · key GISTDA อยู่ VPS เท่านั้น
- C.35 ตัวเลขสำรอง: `bkk-fetch` ถามบริการ JSON ของหน้าศูนย์อุทกวิทยาฯ (ตอบเฉพาะในไทย, ต้องเปิดหน้าก่อนเพื่อคุกกี้ ไม่งั้น 401) → `bkk/rid_hydro.json` → `flow_backup_at` เมื่อรายงานไม่มีเลข (ดู `docs/sources.md`)
- **PC ผู้ใช้**: สคริปต์อัปเดต กทม. รันจาก clone แยก `~/.fontokmai/app` (`git pull --ff-only` ตาม main ทุกรอบ) ห้ามแก้โค้ดในนั้น · งานต่อ `docs/handoff-claude-2026-10-04.md`

## 2026-10-04 20:40 (Claude: ย้าย A6 เก่าสุดเพื่อให้ AGENTS.md ไม่เกิน 32 KiB)

#### 2026-10-04 11:47 ICT — ทวนสูตรและทยอยแก้ M52–M54 (Codex)
- M48/M49 เดิมแก้แล้ว; พบต่อ M52: ขึ้น9.6ซม.ถูกปัดเป็น10ก่อนให้คะแนน และไม่มีคู่ค่าวัดยังassessed=true → canals-v3 ใช้ค่าจริง/คู่เวลาเรียงถูก; testใหม่9กรณี ชุดคลอง17ผ่าน+ruff; สัญญา27/วิธีคิด/designแก้ตรงกัน ไม่เปลี่ยนschema
- M52 push446d766/CIผ่าน; M53 canals-v4 เพิ่มgapเมื่อข้อมูลบางส่วน/เวลาอนาคต ชุดคลอง21ผ่าน pushbfae8f5 · M54 ตรวจหน่วย/แกนเวลา/percentile ก่อนเผยแพร่ ทดสอบจำลอง13กรณี; รายงาน private/handoffs/2026-10-03-codex-formula-recheck.md (เก็บA6 21:32เดิม) · ความแม่นยังไม่ผ่านbacktest · รอCI/deploy

## 2026-10-04 (Claude ตามที่ผู้ใช้สั่ง: "ย้ายเฉพาะที่ไม่ได้ใช้งานแล้วจริงๆ")

### A6 บันทึก 2026-10-03 23:10 (Claude) งานเสร็จแล้ว ฉบับเต็มอยู่ใน private/handoffs/2026-10-03-claude-gates.md

#### 2026-10-03 23:10 ICT — ประตูน้ำ/คลอง D35 และปิดรีวิว M40–M51 (Claude)
- D35 9d9a6a8 + M48–M51 34d92e6 + 95103af (ฉบับเต็ม private/handoffs/2026-10-03-claude-gates.md) · M45 60d66e7 เรดาร์ล้มไม่ซ่อนประกาศ · M40 0120995 แถบสรุปไม่เขียวเมื่ออ่านสรุปไม่ได้ · M44 62ef3dd อำเภอจากกรอบ `areas.py` · M46 0b401e1 · M47 76c35bb sha/size (live) · M42 ef7d0b9 · M41 182282a CLS มือถือ 0.127→0.026
- **ทดสอบ** pytest/ruff, vitest161, consumer64/57, E2E108, consumer browser64 ผ่าน · CI ผ่าน · **Deploy** VPS 76c35bb, Pages · ทวนตามเกณฑ์: private/handoffs/2026-10-03-claude-review-fixes.md (M44 ไม่ตัดจุดใกล้เส้น มีเหตุผล)

### C2 ข้อ 1–15 รีวิว/งานที่ปิดแล้ว (M13–M39 และทวนงาน 1–2 ต.ค.)

- **ทำแล้ว 2026-09-27**: รีวิว DXS/หมุด/GloFAS/ภาษา/SEO/กล้อง/สิทธิ์ → M13–M22 (แก้แล้ว) · รายงาน `private/handoffs/2026-09-27-codex-*.md`
- **2026-09-28 ข้อ 1–5 รีวิวแล้ว** (สรุป เกณฑ์ สสน. M17–M22 การเข้าถึง แผนวัดความแม่น) → M23–M28 Claude แก้แล้ว `9d9d5d0` · รายงาน `private/handoffs/2026-09-28-codex-overview-review.md`
6–9. **ปิด M23–M34 ตามเกณฑ์เดิมแล้ว 30 ก.ย.** เครื่องสูบ/เรดาร์/restore/retention/backup/มือถือผ่าน ดูรายงาน29–30ก.ย.; งบรวมเพิ่มเติม M36 แก้แล้ว 1 ต.ค.
10. **รีวิวระบายน้ำ fdc301a แล้ว** เพิ่ม consumer ตรวจ baseline/เกณฑ์/null/วันที่/schema/summary/UI ผ่าน; เทียบรายวันตามรอบผู้ใช้กด ไม่ใช่แผนระบายหรือเวลาน้ำถึง
11. **M35 Codexแก้ตามD34** ถอด expected-failureแล้ว · **M36 Codexแก้ตามD34** งบรวมคลัง ผ่าน260tests; CCTV/ข้อมูลเส้นท้ายน้ำยังตามแผนใน `private/handoffs/2026-09-30-codex-review.md`, `docs/sources.md` §14

12. **M37 แก้แล้ว 1 ต.ค.** `live-smoke.mjs` ใช้ `map-surface` และรอ `aria-busy=false`; รันกับเว็บจริงdesktop/Pixel7ผ่าน
13. **ทวนงาน 1 ต.ค.**: กันข้อมูลค้าง (`950994a`, `8305881`: init, git ไม่ทำงานเบื้องหลัง, restart เมื่อ publish ล้ม 3 รอบ/pids ≥ 80%) · ลบข้อมูลเองตามขั้นดิสก์ 80/85/90% (`ebb9802`) · ตัดการ์ดสองใบ (`96a2673`) · M38 ที่ Claude commit แทนพร้อมแก้ test 2 จุด (`0f7e971`)

14. **ปิด M38/M39 แล้ว 1 ต.ค.** ทวน0f7e971/d016f56/d07ddbfและเพิ่มกันชุดเดิมว่าง/บางส่วน/วันที่สับสน; ผลโค้ด/ข้อมูลจริง/PagesในA6และhandoffเขื่อน

15. **ทวนงาน 1–2 ต.ค.** `04ba201`…`b392ff9`: สัญญาข้อ 20 (`kind`), 21 (`area_code`, `earlier`), 22 (`ref/boundaries.json`), 23 (`ref/river_lines.json`) · ที่ของฉันบรรทัดเดียวไม่บอก “ปลอดภัย” · ป้าย “ใหม่”/เพิ่ม-ลด นับจากที่การ์ดแสดง · หมุดร้ายแรงนอกกลุ่ม (popup/คีย์บอร์ด) · consumer specs ที่ Claude แก้ตามคำขอผู้ใช้

### C1 บรรทัดประวัติที่ทำแล้ว 2026-09-28

- ทำแล้ว 2026-09-28: Search Console/Bing ยืนยันและส่ง sitemap · กรมอุตุฯ ไม่ให้ token NWP (ตัดออกจากแผน)

### C1 ข้อความเดิมก่อนแก้ (GISTDA สมัครแล้ว)

- **เลือกสมัครเพิ่มได้ (Codex ตรวจ 2026-09-26)**: [Google Flood Forecasting API](https://developers.google.com/flood-forecasting) มีลิงก์ waitlist ทางการ ฟรี/CC BY 4.0 สำหรับพยากรณ์น้ำท่วมแม่น้ำรวมไทย; หรือ [GISTDA API Gateway](https://api-gateway.gistda.or.th) สำหรับ Disaster Platform (ต้องตรวจสิทธิ์เผยแพร่ที่อนุมัติ และไม่ถือว่าได้เช็คน้ำด้วย) · รายละเอียด `docs/sources.md` ข้อ 10.4–10.5; ผู้ใช้ตัดสินและสมัครเอง ไม่ผูกบริการเสียเงิน/บัตรตาม D12

### D ข้อที่เสร็จแล้ว

1. (เสร็จ) เว็บแผนที่เป็นหลักพร้อมประกาศ เรดาร์ กล้อง หมุด ค้นถนน และค้นหาสถานที่ (D29)

### D ข้อที่เสร็จแล้ว

2. (เสร็จ รอ Codex ทวน) แก้ M1–M3 และแถบเลื่อนเวลา + พยากรณ์ฝน 72 ชม./7 วัน (Open-Meteo)

### D ข้อที่เสร็จแล้ว (GISTDA ทำแล้ว 2026-10-04 PR #4–#6)

3. Claude: ชั้นพื้นที่น้ำท่วมจากดาวเทียม GISTDA ถ้าผู้ใช้สมัคร key
