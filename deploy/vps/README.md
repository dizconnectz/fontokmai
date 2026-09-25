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
