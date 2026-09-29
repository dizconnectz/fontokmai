# ติดตั้ง fontokmai บน VPS (runbook)

ใช้กับ VPS ที่ใช้ร่วมกับงานเดิมของผู้ใช้ (design 4.3, 4.9)
- **ห้ามแตะ**: container, ไฟล์ หรือตารางเวลาของงานเดิม
- **แยกทุกอย่างไว้ใต้ `~/fontokmai`** และใน compose project ชื่อ `fontokmai`
- **ไม่ต้องใช้ sudo**: ผู้ใช้ต้องอยู่ในกลุ่ม docker

| path บน VPS | ใช้ทำอะไร |
|---|---|
| `~/fontokmai/app` | clone ของ repo นี้ |
| `~/fontokmai/var/state` | SQLite state (checkpoint) |
| `~/fontokmai/var/state/backups` | สำรองฐานข้อมูลวันละครั้ง `fontokmai-YYYYMMDD.db.gz` (เก็บ 7 วันล่าสุด) |
| `~/fontokmai/var/state/archive/eval` | คลังไว้ตรวจความแม่นภายหลัง (`docs/design/accuracy-evaluation.md` §6) |
| `~/fontokmai/var/out/data/v1` | snapshot ล่าสุด |
| `~/fontokmai/var/pages` | พื้นที่ชั่วคราวของ commit ที่จะเผยแพร่ |
| `~/fontokmai/secrets/deploy_key` | deploy key ที่เขียนได้เฉพาะ repo ข้อมูล (สิทธิ์ 600 ไม่อยู่ใน repo) |
| `~/fontokmai/secrets/dxs_account` | บัญชี DXS ของ กทม. สองบรรทัด ชื่อผู้ใช้ แล้วรหัสผ่าน (สิทธิ์ 600 ไม่อยู่ใน repo ห้ามเปิดอ่านหรือพิมพ์ออก) · ตั้ง `DXS_ACCOUNT` ใน `.env` · ดูรูปคำตอบของบริการด้วย `docker compose run --rm cap-collector dxs-probe GetWaterLastData --account /run/secrets/dxs_account` · DXS ไม่ตอบ IP ของ VPS นี้ จึงไม่ตั้ง `DXS_ACCOUNT` และใช้การดึงเป็นครั้งๆ: บนเครื่องในไทยรัน `uv run fontokmai bkk-fetch --account <ไฟล์บัญชี> --out <โฟลเดอร์>` แล้วคัดลอก `bkk/*.json` ไปที่ `~/fontokmai/var/out/data/v1/bkk/` (คัดลอกเป็นชื่อชั่วคราวแล้ว `mv` ทับ) รอบถัดไปจะเผยแพร่ให้ภายใน 24 ชม. |
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
~/fontokmai/app/deploy/vps/deploy.sh                                               # อัปเดต: pull, build, เริ่มใหม่ แล้วลบ cache/image เก่าของ fontokmai เท่านั้น
docker compose logs --tail 20 cap-collector                                        # ดูผลแต่ละรอบ (JSON หนึ่งบรรทัดต่อรอบ)
docker compose stop                                                                # หยุด (ข้อมูลใน var/ ยังอยู่)
```

## ข้อมูลอยู่ที่ไหนและโตแค่ไหน (วัด 2026-09-29: ของ fontokmai รวมราว 0.7 GB จากดิสก์ 86 GB ที่ว่าง 25 GB)
| ที่เก็บ | มีอะไร | ขนาดและการโต |
|---|---|---|
| `var/state/fontokmai.db` (SQLite ไฟล์เดียว ไม่มี database server) | ประกาศ CAP ดิบแบบบีบอัด, revision ของเหตุ/ไฟล์, ค่า meta | 1.1 MB · โตราว 0.3 MB ต่อวัน · ลบประกาศที่ออกเกิน 180 วันวันละครั้ง (ฟีดใช้แค่ 7 วัน) จึงไม่เกินราว 50 MB |
| `var/state/backups` | สำรองฐานข้อมูลวันละครั้ง (SQLite online backup → ตรวจ `integrity_check` → gzip) | 7 ไฟล์ล่าสุด ไฟล์ละไม่ถึง 1 MB ตอนนี้ · สคริปต์อัปเดต กทม. บนเครื่องผู้ใช้คัดลอกไฟล์ล่าสุดไปเก็บที่ `~/.fontokmai/backups` (14 ไฟล์) |
| `var/state/archive/eval` | คลังตรวจความแม่น: รอบละบรรทัด (`rounds/`), ไฟล์ที่กฎอ่านทุกรุ่นที่เปลี่ยน (`versions/`), รายงานน้ำท่วมเมื่อเห็นครั้งแรก/เปลี่ยน/หายจากฟีด (`floods/`) | วันละไฟล์ต่อชนิด ประมาณ 0.5 MB ต่อวัน · เก็บ 90 วัน และไม่เกิน 300 MB (ลบวันเก่าสุดก่อน) · สคริปต์อัปเดต กทม. คัดลอกวันที่จบแล้วไปเก็บถาวรที่ `~/.fontokmai/archive` |
| `var/out/data/v1` | snapshot ล่าสุด | ราว 4 MB เขียนทับทุกรอบ |
| `var/pages` | ไฟล์ที่ประกอบเป็น commit เผยแพร่ | ~1 MB สร้างใหม่ทุกรอบ |
| repo `fontokmai-data` (GitHub Pages) | สำเนาสาธารณะของ snapshot | force-push commit เดียวต่อรอบ จึงมีแค่รุ่นล่าสุด |
| log ของ container | JSON หนึ่งบรรทัดต่อรอบ | หมุนที่ 10 MB × 3 |
| `var/state/cache/itic_flood_YYYY.json` | เหตุน้ำท่วมของ iTIC/Longdo ปีที่จบแล้ว เฉพาะกรอบ กทม.–ปริมณฑล | ไม่กี่ร้อย KB ต่อปี ไม่เก็บไฟล์ดิบ (อ่านแบบ stream) |
| `var/out/data/v1/ref/road_flood_history.json` | ประวัติน้ำท่วมถนน (สัญญาข้อ 8) | สร้างใหม่สัปดาห์ละครั้ง เขียนทับ |
| image `fontokmai-pipeline:local` | Python + โค้ด | 376 MB (29 ก.ย.) · แยก stage แล้วไม่มี uv และ cache ของมันในภาพ · `deploy.sh` ลบ build cache ที่ build ล่าสุดไม่ได้ใช้และ image เก่าของ fontokmai ทุกครั้ง (วัด 28 ก.ย.: cache ของเรา 317 MB ลบได้ 219 MB) |
| `var/state/archive/dxs/*.tgz` | สำเนาข้อมูล DXS ทุกครั้งที่ผู้ใช้กดอัปเดต (ประวัติ) | ~25 KB ต่อครั้ง · สคริปต์อัปเดตลบที่เก่ากว่า 365 วัน |

- **ตัวคุมดิสก์ (design 4.9)**: ท้ายทุกรอบ (`fontokmai/housekeeping.py`) ถ้าดิสก์ที่ใช้ร่วมกับงานอื่นว่างน้อยกว่า 15% (reserve) จะไม่เขียนคลังตรวจความแม่น (`keep.skipped`) แต่ยังสำรองรายวัน เพราะไฟล์ใหม่แทนไฟล์เก่าสุด ขนาดรวมไม่โต · ใช้ถึง 80% log บอก `keep.warning` (ยังไม่มีช่องทางแจ้งผู้ใช้อัตโนมัติ) · log ของรอบบอก `keep.disk_free_gb` ทุกรอบ และ `keep.archive_mb` วันละครั้ง
- ยังต้องมีงบรวมและ retention ของแหล่งใหม่ก่อนเพิ่มแหล่งที่ดึงข้อมูลจำนวนมาก (design 4.9)
- **เครื่องนี้ใช้ร่วมกับงานอื่น ห้ามแตะของงานอื่นเลย** (ผู้ใช้สั่ง 2026-09-28): ห้าม `docker image prune`, `docker builder prune` หรือ `docker system prune` แบบไม่กรอง · ของเราใช้ `prune_own_cache.py` ซึ่งเลือกเฉพาะ build cache ที่คำอธิบายมีคำว่า fontokmai (ชื่อ stage และท้าย RUN ใน `pipeline/Dockerfile`) หรือสร้างต่อจากรายการนั้น และ image ค้างที่ entrypoint เป็น `fontokmai` · ลองก่อนด้วย `--dry-run`

## สำรองและกู้คืนฐานข้อมูล
- สำรองอัตโนมัติรอบแรกหลังเที่ยงคืน (เวลาไทย) ของทุกวัน ไม่ต้องสั่ง · ถ้าตรวจแล้วไฟล์เสียจะไม่เก็บและบอกใน log
- กู้คืน (ตัวเก็บต้องหยุดก่อน):
```bash
cd ~/fontokmai/app/deploy/vps
docker compose stop cap-collector
docker compose run --rm cap-collector restore-db --backup /var/lib/fontokmai/state/backups/fontokmai-YYYYMMDD.db.gz --db /var/lib/fontokmai/state/fontokmai.db --manifest /var/lib/fontokmai/out/data/v1/manifest.json
docker compose start cap-collector
```
- `restore-db` คลายไฟล์ ตรวจ `integrity_check` ก่อน แล้วจึงแทนที่ (ไฟล์เสียจะไม่แทนที่ของเดิม) และเพิ่ม `recovery_epoch` ให้สูงกว่าที่เผยแพร่อยู่ เว็บจะล้างสถานะแล้วอ่านฟีดใหม่ (design 4.4 ข้อ 14) · ซ้อมโดยไม่แตะของจริง: ใส่ `--db /tmp/drill.db` แทน
- จากสำเนาบนเครื่องผู้ใช้: `scp` ไฟล์จาก `~/.fontokmai/backups` ขึ้นไปที่ `~/fontokmai/var/state/backups/` แล้วทำตามข้างบน
- สิ่งที่หายได้เมื่อกู้คืน: ประกาศที่เข้ามาหลังเวลาสำรอง (รอบถัดไปดึงใหม่เฉพาะที่ยังอยู่ในฟีดกรมอุตุฯ) · ยังไม่มีเทสต์กรณีประกาศยกเลิก/แก้ไขที่ออกระหว่างเวลาสำรองกับรอบล่าสุด (design 4.4 ข้อ 14) หลังกู้คืนให้เทียบ `alerts.json` กับหน้ากรมอุตุฯ

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
  - systemd slice สำหรับงบรวม
  - ตัวตรวจเว็บล่มจากนอกเครื่อง: ผู้ใช้ตัดสินไม่ทำ (2026-09-29)
