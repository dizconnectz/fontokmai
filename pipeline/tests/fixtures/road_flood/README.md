# Fixtures: road flood history

- `bma_package.json`: trimmed CKAN `package_show` answer of data.bangkok.go.th dataset `frd_dds` (4 of its 6 files)
- `bma_2022.csv`, `bma_2024.csv`, `bma_2025.csv`: real rows cut from the yearly files (สำนักการระบายน้ำ กรุงเทพมหานคร, CC BY), kept byte for byte (UTF-8 BOM, CRLF, month-first dates)
- `bma_legacy.csv`: first rows of the older combined export in TIS-620 with day-first dates; the collector must skip it
- `itic_2024.csv`, `itic_2025.csv`: **synthetic** rows in the column layout of `event.longdo.com/feed/YYYY` (titles modelled on real iTIC/Longdo reports, CC BY 4.0); the 2025 file starts with two byte-order marks like the real 2026 file
