# ติดตั้ง fontokmai บน VPS (runbook)

ใช้กับ VPS ที่ใช้ร่วมกับงานเดิมของผู้ใช้ (design 4.3, 4.9)
- **ห้ามแตะ**: container, ไฟล์ หรือตารางเวลาของงานเดิม
- **แยกทุกอย่างไว้ใต้ `~/fontokmai`** และใน compose project ชื่อ `fontokmai`
- **ไม่ต้องใช้ sudo**: ผู้ใช้ต้องอยู่ในกลุ่ม docker

| path บน VPS | ใช้ทำอะไร |
|---|---|
| `~/fontokmai/app` | clone ของ repo นี้ |
| `~/fontokmai/var/state` | SQLite state (checkpoint) |
| `~/fontokmai/var/out/data/v1` | snapshot ล่าสุด |
| `~/fontokmai/var/pages` | พื้นที่ชั่วคราวของ commit ที่จะเผยแพร่ |
| `~/fontokmai/secrets/deploy_key` | deploy key ที่เขียนได้เฉพาะ repo ข้อมูล (สิทธิ์ 600 ไม่อยู่ใน repo) |
| `~/fontokmai/secrets/dxs_account` | บัญชี DXS ของ กทม. สองบรรทัด ชื่อผู้ใช้ แล้วรหัสผ่าน (สิทธิ์ 600 ไม่อยู่ใน repo ห้ามเปิดอ่านหรือพิมพ์ออก) · ตั้ง `DXS_ACCOUNT` ใน `.env` · ดูรูปคำตอบของบริการด้วย `docker compose run --rm cap-collector dxs-probe GetWaterLastData --account /run/secrets/dxs_account` · ตอนนี้ DXS ไม่ตอบ IP ของ VPS นี้ จึงยังไม่ตั้ง `DXS_ACCOUNT` (ไฟล์บัญชีเก็บไว้แล้ว) |
| `app/deploy/vps/.env` | ค่าของเครื่องนี้ (ไม่อยู่ใน repo) |

## ติดตั้งครั้งแรก
```bash
mkdir -p ~/fontokmai/var/state ~/fontokmai/var/out ~/fontokmai/var/pages ~/fontokmai/secrets
git clone https://github.com/dizconnectz/fontokmai.git ~/fontokmai/app
ssh-keygen -t ed25519 -N "" -C "fontokmai-vps-publisher" -f ~/fontokmai/secrets/deploy_key
cd ~/fontokmai/app/deploy/vps
cp .env.example .env
```
จากนั้นแก้ `.env`:
- `FONTOKMAI_UID` และ `FONTOKMAI_GID` = ค่าจาก `id -u` และ `id -g`
- path ของ `FONTOKMAI_VAR` และ `DEPLOY_KEY`
- เว้น `PUBLISH_REMOTE` ว่างไว้ถ้าจะเก็บอย่างเดียว

แล้ว build และลองหนึ่งรอบ:
```bash
docker compose build
docker compose run --rm cap-collector cap-snapshot --db /var/lib/fontokmai/state/fontokmai.db --out /var/lib/fontokmai/out/data/v1 --writer vps
docker compose up -d
```

## เปิดการเผยแพร่ (dev host = GitHub Pages ของ `dizconnectz/fontokmai-data`)
1. เพิ่ม `~/fontokmai/secrets/deploy_key.pub` เป็น deploy key แบบ **allow write** ของ repo ข้อมูลเท่านั้น
2. ตั้ง `PUBLISH_REMOTE=git@github.com:dizconnectz/fontokmai-data.git` ใน `.env` แล้วรัน `docker compose up -d`
3. เปิด GitHub Pages ของ repo ข้อมูลจาก branch `gh-pages` แล้วตรวจ `https://dizconnectz.github.io/fontokmai-data/data/v1/manifest.json`

## ใช้งานประจำ
```bash
cd ~/fontokmai/app && git pull && cd deploy/vps && docker compose up -d --build   # อัปเดต
docker compose logs --tail 20 cap-collector                                        # ดูผลแต่ละรอบ (JSON หนึ่งบรรทัดต่อรอบ)
docker compose stop                                                                # หยุด (ข้อมูลใน var/ ยังอยู่)
```

## ข้อมูลอยู่ที่ไหนและโตแค่ไหน (วัด 2026-09-25)
| ที่เก็บ | มีอะไร | ขนาดและการโต |
|---|---|---|
| `var/state/fontokmai.db` (SQLite ไฟล์เดียว ไม่มี database server) | ประกาศ CAP ดิบแบบบีบอัด, revision ของเหตุ/ไฟล์, ค่า meta | ~0.5 MB · โตราว 40 KB ต่อประกาศ (ประมาณ 70–150 MB ต่อปี) · **ยังไม่มีงานลบและสำเนานอกเครื่อง** |
| `var/out/data/v1` | snapshot ล่าสุด (`manifest.json`, `alerts.json`) | ~0.5 MB เขียนทับทุกรอบ |
| `var/pages` | ไฟล์ที่ประกอบเป็น commit เผยแพร่ | ~1 MB สร้างใหม่ทุกรอบ |
| repo `fontokmai-data` (GitHub Pages) | สำเนาสาธารณะของ snapshot | force-push commit เดียวต่อรอบ จึงมีแค่รุ่นล่าสุด |
| log ของ container | JSON หนึ่งบรรทัดต่อรอบ | หมุนที่ 10 MB × 3 |
| `var/state/cache/itic_flood_YYYY.json` | เหตุน้ำท่วมของ iTIC/Longdo ปีที่จบแล้ว เฉพาะกรอบ กทม.–ปริมณฑล | ไม่กี่ร้อย KB ต่อปี ไม่เก็บไฟล์ดิบ (อ่านแบบ stream) |
| `var/out/data/v1/ref/road_flood_history.json` | ประวัติน้ำท่วมถนน (สัญญาข้อ 8) | สร้างใหม่สัปดาห์ละครั้ง เขียนทับ |
| image `fontokmai-pipeline:local` | Python + โค้ด | ~450 MB · build ใหม่แต่ละครั้งทิ้ง image เก่าและ build cache ไว้ |

- ตัวคุมงบดิสก์, retention และสำรองนอกเครื่องตาม design 4.9 เป็นงาน P0-B2 และต้องเสร็จก่อนเพิ่มแหล่งที่ดึงข้อมูลจำนวนมาก
- เครื่องนี้ใช้ร่วมกับงานเดิม: `docker image prune` และ `docker builder prune` กระทบของงานเดิมด้วย จึงต้องถามผู้ใช้ก่อนล้าง

## ประวัติน้ำท่วมถนน (ครั้งแรกต้องสั่งเอง)
ตัวตั้งเวลาสร้าง `ref/road_flood_history.json` ใหม่สัปดาห์ละครั้ง แต่จะไม่โหลดเหตุการณ์ย้อนหลังทั้งชุดเอง (ปีละ 20–50 MB) จึงต้องสั่งครั้งแรกนอกรอบ 15 นาที:
```bash
cd ~/fontokmai/app/deploy/vps
docker compose run --rm cap-collector road-flood-history --out /var/lib/fontokmai/out/data/v1 --cache /var/lib/fontokmai/state/cache
```
- อ่านแบบ stream ไม่เก็บไฟล์ดิบ เก็บเฉพาะเหตุน้ำท่วมในกรอบนำร่องเป็น cache รายปี
- ถ้า cache หาย รอบอัตโนมัติจะรายงาน `BackfillNeeded` ใน log แทนการโหลดเองทั้งชุด

## ความปลอดภัยและขอบเขต
- **container**:
  - รันด้วย uid ของผู้ใช้ (ไม่ใช่ root)
  - จำกัด CPU 0.5 core, RAM 512 MB (ไม่มี swap เพิ่ม) และ 128 process
  - log หมุนที่ 10 MB × 3
- **git**: ใช้เฉพาะ deploy key ของ repo ข้อมูล และ host key ของ GitHub ที่ปักไว้ใน `github_known_hosts`
  - ได้จาก `gh api meta` และตรวจ fingerprint กับค่าที่ GitHub ประกาศแล้ว
  - ED25519 `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`
- **ถอนสิทธิ์เผยแพร่**: ลบ deploy key ในหน้า Settings → Deploy keys ของ repo ข้อมูล แล้ว `docker compose stop`
- **ช่วงห้ามรันของงานเดิม** (ตั้งใน `.env` ของเครื่อง): ตัวเก็บนี้เป็นงานเบาที่ทำงานต่อได้ตามข้อ 4.3 · งานหนักในอนาคตต้องมี admission cutoff
- **ยังไม่รองรับ (P0-B2)**:
  - takeover/failback ไปที่ GitHub Actions
  - restore จากสำเนา
  - ตัวตรวจจากนอกเครื่อง
  - systemd slice สำหรับงบรวม
