# GISTDA Disaster API: คู่มือสำหรับ agent

สรุปจากคู่มือของ GISTDA, หน้า "บริการข้อมูล" ที่ผู้ใช้คัดลอกมา (2026-10-04) และ**ผลที่ผู้ใช้รันบน VPS จริง** (2026-10-04)
ใครจะเพิ่มการใช้งานใหม่ อ่านไฟล์นี้ก่อน แล้วลงทะเบียนสิ่งที่จะใช้ใน `docs/sources.md` แถว GISTDA

- หน้าเว็บ: https://disaster.gistda.or.th/ (แผนที่) · คู่มือการขอ key: https://disaster.gistda.or.th/manual_api.pdf
- ฐาน API: `https://api-gateway.gistda.or.th/api/2.0/resources`
- สิทธิ์: ข้อมูลเปิดภาครัฐ (Open Government Data) · ผู้ใช้ยืนยัน 2026-10-04 ว่าตอนสมัคร key ไม่มีข้อห้ามเผยแพร่ต่อ · ต้องให้เครดิต GISTDA
- ใช้อยู่แล้ว: `features/flood/3days` → `floods/satellite.json` (สัญญาข้อ 28, `pipeline/src/fontokmai/sources/gistda.py`)

## Key: อ่านก่อนแตะ

- key เป็นของบัญชีผู้ใช้ เก็บไว้ที่ **VPS เท่านั้น**: `~/fontokmai/secrets/gistda_key` (สิทธิ์ 600) และ `GISTDA_KEY=` ใน `deploy/vps/.env` → container เห็นเป็น `/run/secrets/gistda_key`
- **ห้ามใส่ key ใน repo, ในหน้าเว็บ, ใน URL, ใน log หรือข้อความ error** (ผู้ใช้สั่ง 2026-10-04) จึงห้ามเรียก WMS/WMTS/TMS จากเบราว์เซอร์ของผู้ชมโดยตรง เพราะต้องแนบ key
- ส่ง key ทาง header `API-Key: <key>` (ทดสอบแล้วได้ 200)
- **ลิงก์ในคำตอบของ API มี `api_key=` ติดมา** (`links[].href`) ห้ามเก็บหรือเผยแพร่ลิงก์จากคำตอบ
- Claude ในเครื่อง cloud ไม่มี key: การทดลองกับ API จริงต้องให้ผู้ใช้หรือ Codex รันบน VPS (ดูหัวข้อ "ทดลองบน VPS" ท้ายไฟล์)

## ข้อมูลที่มี (endpoint)

ทุก endpoint เป็น `GET` ใต้ฐาน API ข้างบน

| กลุ่ม | path | ข้อมูล | ผลทดลอง 2026-10-04 |
|---|---|---|---|
| พื้นที่น้ำท่วม | `/features/flood/1day` | พื้นที่น้ำท่วม 1 วัน (ย้อนหลัง 1 วัน) | 0 รายการ (วันนั้นไม่มีภาพใหม่) |
| | `/features/flood/3days` | พื้นที่น้ำท่วมในรอบ 3 วันล่าสุด | 82,962 รายการ · **ใช้อยู่** |
| | `/features/flood/7days` | ในรอบ 7 วันล่าสุด | 92,998 รายการ |
| | `/features/flood/30days` | ในรอบ 30 วันล่าสุด | 144,336 รายการ (มีช่อง `cassava_area` เพิ่ม) |
| น้ำท่วมซ้ำซาก | `/features/flood-freq` | สรุปพื้นที่น้ำท่วมซ้ำซาก | 7,874,656 รายการ (ใหญ่มาก ห้ามดึงทั้งชุด) · bbox กทม.–ปริมณฑล 132,541 · ปทุมธานี 9,111 · สร้างเมื่อ 2025-06-17 (สถิติ ไม่เปลี่ยนบ่อย) · **ใช้แล้ว** สรุปรายตำบลของจังหวัดนำร่อง → `ref/flood_freq.json` (คำสั่ง `fontokmai flood-freq` รันด้วยมือ) |
| สิ่งกีดขวางทางน้ำ | `/features/water_hyacinth` | พื้นที่ผักตบชวา | ยังไม่ได้ลอง |
| Maps API (WMS) | `/maps/flood/{1day,3days,7days,30days}/wms`, `/maps/flood-freq/wms` | ภาพแผนที่แบบ WMS | ยังไม่ได้ลอง |
| Maps API (WMTS) | `/maps/flood/{1day,3days,7days,30days}/wmts`, `/maps/flood-freq/wmts` | ภาพแผนที่แบบ WMTS | ยังไม่ได้ลอง |
| Maps API (TMS) | `/maps/flood/{1day,3days,7days,30days}/tms/{z}/{x}/{y}`, `/maps/flood-freq/tms/{z}/{x}/{y}` | แผ่นภาพแบบ TMS | ยังไม่ได้ลอง |

หน้า "บริการข้อมูล" ของ GISTDA มีหมวด ไฟป่า และ ภัยแล้ง ด้วย แต่ผู้ใช้คัดลอกมาเฉพาะหมวดน้ำท่วม ถ้าจะใช้หมวดอื่นให้ขอรายการ endpoint จากผู้ใช้ก่อน

## รูปแบบคำตอบของ `/features/...`

GeoJSON ตามมาตรฐาน OGC API Features (`type: FeatureCollection`) มีช่อง `numberMatched` (ทั้งหมด), `numberReturned` (ในหน้านี้), `timeStamp` และ `links` (`self`, `alternate`, `next`)

แต่ละ feature มี `geometry` เป็น MultiPolygon (พิกัด lon/lat) และ `properties` ดังนี้ (ของชุด flood/1day–30days):

| ช่อง | ความหมาย (ตีความจากค่าที่เห็น) |
|---|---|
| `ap_idn` | รหัสอำเภอ DOPA 4 หลัก (ตรงกับ `ref/places.json`) · `ap_tn`/`ap_en` ชื่ออำเภอ |
| `pv_idn`, `pv_tn`, `pv_en` | จังหวัด · `tb_idn`, `tb_tn`, `tb_en` ตำบล · `re_royin`, `re_royin_2` ภาค |
| `h3_address` | ช่อง H3 ความละเอียด 9 (ราว 0.12 ตร.กม.) · `h3_area` พื้นที่ช่อง ม.² |
| `f_area` | พื้นที่น้ำท่วมในช่องนั้น **ม.²** (เท่ากับ `_area`) |
| `population`, `building`, `hospital`, `school` | ประชากร/อาคาร/โรงพยาบาล/โรงเรียนในช่อง (ค่าประมาณ ประชากรเป็นทศนิยมได้) |
| `length_road` | ความยาวถนนในช่อง (หน่วยยังไม่ยืนยัน น่าจะเป็นเมตร **ยังไม่ใช้**) |
| `rice_area` | พื้นที่นาข้าว (หน่วยยังไม่ยืนยัน) |
| `file_name` | ภาพดาวเทียมที่ใช้ คั่นด้วย `, ` รูปแบบ `<ดาวเทียม>_<YYYYMMDD>_<HHMM>` เช่น `S1D_20261002_0609` (Sentinel-1), `rd2_...`, `cg2_...` |
| `_createdAt`, `_updatedAt`, `_id`, `mongo_id`, `objectid` | ข้อมูลภายในระบบของ GISTDA · `_createdAt` ใช้ดูว่าชุดข้อมูลเปลี่ยน |

การสรุปน้ำท่วมของ fontokmai บวก `f_area` ทุกชิ้นพื้นที่ แต่ `population`/`building` เป็นค่าของ H3 cell จึงนับหนึ่งครั้งต่อ cell ที่มี `h3_address`; ถ้าค่าในชิ้นของ cell เดียวกันขัดกัน หรือไม่มีรหัส cell ที่ใช้รวมได้ จะไม่แสดงยอดประชากร/อาคารของอำเภอนั้นแทนการเดา

ชุด `flood-freq` ช่องต่างออกไป: `freq` (จำนวนครั้งที่ท่วม), `area_rai`, `pv_code`/`ap_code`/`tb_code`, `com_tn` (ชุมชน), `re_nesdb`, `shape_area`, `shape_length`

## พารามิเตอร์ที่ทดลองแล้ว

| พารามิเตอร์ | ผล |
|---|---|
| `limit=1000` | ได้ · หน้าละราว 3.3 MB ตอบในราว 1 วินาที |
| `offset=N` | ได้ (ใช้แบ่งหน้า) |
| `pv_idn=13` (หรือ `pv_code=13`) | ได้ · กรองจังหวัด เช่น flood-freq ปทุมธานี 9,111 รายการ ตอบใน 1–6 วินาที (`bbox` ช้ากว่า 11–21 วินาที) |
| `limit=5000` | flood-freq ได้ 504 (หมดเวลา 60 วินาที) ใช้ 1,000 |
| `bbox=west,south,east,north` | ได้ · เช่น `100.3,13.5,100.9,14.3` (กทม.และรอบๆ) ได้ 9,022 รายการจาก 82,962 |
| `skipGeometry=true` | **ไม่ทำงาน** (ได้ 0 รายการ) |
| `properties=...` | **ไม่ทำงาน** (ได้ 0 รายการ) |

API ส่งรูปร่างมาทุกครั้ง ชุด 3 วันทั้งชุดจึงราว 280 MB ห้ามเขียนข้อมูลดิบลงดิสก์ VPS (AGENTS.md: ดิสก์ VPS) ให้อ่านทีละหน้าแล้วเก็บเฉพาะที่ต้องใช้แบบที่ `sources/gistda.py` ทำ หรือจำกัดพื้นที่ด้วย `bbox`

ยังไม่ได้ลอง: `limit` สูงสุดเท่าไร, ตัวกรองตามช่อง (เช่น `pv_idn=...`), `datetime`

## ความถี่ที่ข้อมูลเปลี่ยน

`_createdAt` ของชุด 3 วันเป็นเวลาราว 01:54 น. (ไทย) และชุด 7 วันราว 08:03 น. ของวันเดียวกัน จึงน่าจะอัปเดตวันละ 1–2 ครั้งตามภาพดาวเทียมที่เข้ามา · `sources/gistda.py` ขอหน้าแรกขนาด 1 รายการทุก 3 ชม. แล้วเทียบ `numberMatched` กับ `_createdAt` ของรายการแรก ถ้าไม่เปลี่ยนจะไม่อ่านทั้งชุด

## ไอเดียที่ยังไม่ได้ทำ

- ท่วมซ้ำซากทั้งประเทศ: `fontokmai flood-freq --provinces all` (ผู้ใช้ขอ 2026-10-04) อ่านทีละจังหวัด เว้น 0.5 วินาทีต่อหน้า ลองใหม่ 3 ครั้งเมื่อ 504/หลุด เขียนผลหลังจบแต่ละจังหวัด สั่งซ้ำทำต่อจากที่ค้าง
- หกเหลี่ยม H3 บนแผนที่ (ละเอียดกว่าระดับอำเภอ) ในพื้นที่นำร่องด้วย `bbox` หรือ h3-js (Apache-2.0) ฝั่งเว็บ
- ชุด 7/30 วันใช้ดูว่าน้ำขยายหรือลด เทียบกับ 3 วัน
- ผักตบชวา (`water_hyacinth`) อาจช่วยประเมินคลองที่ระบายน้ำไม่ดีในคะแนนคลอง (ต้องลองดูข้อมูลจริงก่อน)
- (ทำแล้ว) การ์ดสรุป (overview) นับอำเภอที่มีน้ำจากดาวเทียม เหตุผลชนิด `satellite_flood`

## ทดลองบน VPS (ให้ผู้ใช้หรือ Codex รัน)

ใช้รูปแบบนี้ key จะไม่ขึ้นบนจอ เปลี่ยน `P` และพารามิเตอร์ตามที่ต้องการ แล้วให้ส่งผลกลับมา:

```
K="$(tr -d '[:space:]' < ~/fontokmai/secrets/gistda_key)"; B=https://api-gateway.gistda.or.th/api/2.0/resources
P="features/water_hyacinth?limit=3"
curl -sS -m 120 -o /tmp/gp.json -w 'HTTP %{http_code}, %{size_download} bytes\n' -H "API-Key: $K" "$B/$P"; unset K
python3 -c '
import json
d = json.load(open("/tmp/gp.json"))
print("matched", d.get("numberMatched"), "returned", d.get("numberReturned"))
for f in d.get("features", [])[:2]:
    print(" geometry", (f.get("geometry") or {}).get("type"))
    print(" props", json.dumps(f.get("properties"), ensure_ascii=False)[:600])
'
rm -f /tmp/gp.json
```

อย่าใช้ `read` แล้ววางหลายบรรทัดพร้อมกัน เพราะบรรทัดถัดไปจะถูกอ่านแทน key (เกิดขึ้นแล้ว 2026-10-04)
