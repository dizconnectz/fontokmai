import type { CanalLevels, CanalStation } from '../../../contracts/v1/ts/bkk_water';
import type { RainGauge, RainGauges } from '../../../contracts/v1/ts/bkk_rain';
import type { RoadFloodingDaily, RoadFloodingReport } from '../../../contracts/v1/ts/bkk_flooding';
import type { SituationReport } from '../../../contracts/v1/ts/bkk_news';
import type { Dam, DamReport } from '../../../contracts/v1/ts/dams';
import type { WeatherStation, WeatherToday } from '../../../contracts/v1/ts/weather_today';
import { distanceM } from './roads';

// Bangkok readings of the Drainage and Sewerage Department through DXS (contract sections 14 and 15)
export type { CanalLevels, CanalStation, RainGauge, RainGauges };

/** A reading older than this is the past, not the situation now: its pin turns grey. */
export const READING_OLD_MS = 2 * 3_600_000;
/** The file itself is refreshed every 15 minutes; older than this means the source stopped. */
export const BKK_STALE_MS = 45 * 60_000;
export const WATER_RADIUS_M = 3_000;
export const RAIN_RADIUS_M = 5_000;

export function isRecent(observedAt: string | null, now: number): boolean {
  return !!observedAt && now - Date.parse(observedAt) <= READING_OLD_MS;
}

/** Pin picture of a canal station: grey without a recent reading. */
export function waterPin(station: CanalStation, now: number): string {
  const hasLevel = station.level_in_m !== null || station.level_out_m !== null;
  return hasLevel && isRecent(station.observed_at, now) ? 'pin-water' : 'pin-water-old';
}

/** Rain in the last hour, in the classes the rain pins and their key use (mm). */
export const RAIN_HOUR_CLASSES = [
  { pin: 'pin-rain-0', label: 'ไม่มีฝน', color: '#78909c' },
  { pin: 'pin-rain-1', label: 'ต่ำกว่า 5', color: '#29b6f6' },
  { pin: 'pin-rain-2', label: '5–20', color: '#1e6fd9' },
  { pin: 'pin-rain-3', label: '20–40', color: '#6a3fc1' },
  { pin: 'pin-rain-4', label: '40 ขึ้นไป', color: '#c2185b' },
];
export const RAIN_OLD_COLOR = '#b0bec5';

/** Pin picture of a rain gauge by its rain in the last hour; grey without a recent reading. */
export function rainPin(gauge: RainGauge, now: number): string {
  const mm = gauge.rain_1h_mm;
  if (mm === null || !isRecent(gauge.observed_at, now)) return 'pin-rain-old';
  const index = mm <= 0 ? 0 : mm < 5 ? 1 : mm < 20 ? 2 : mm < 40 ? 3 : 4;
  return RAIN_HOUR_CLASSES[index].pin;
}

/** "1.78 ม.รทก." or "ไม่มีค่า" */
export function levelText(metres: number | null): string {
  return metres === null ? 'ไม่มีค่า' : `${metres.toFixed(2)} ม.รทก.`;
}

/** "12.5 มม.", "0 มม." or "–" */
export function mmText(mm: number | null): string {
  return mm === null ? '–' : `${Math.round(mm * 10) / 10} มม.`;
}

export interface Near<T> {
  item: T;
  distance: number;
}
/** Items with a location within `radiusM` of the pin, nearest first. */
export function nearest<T extends { location: number[] | null }>(
  items: T[],
  pin: number[],
  radiusM: number,
  limit = 3,
): Near<T>[] {
  return items
    .flatMap((item) => (item.location ? [{ item, distance: distanceM(item.location, pin) }] : []))
    .filter((near) => near.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// ---------- today's report of flooded main roads (contract section 16) ----------
export type { RoadFloodingDaily, RoadFloodingReport };

/** "ถนนรามคำแหง", "ถ.รามคำแหง" and "รามคำแหง" name the same road. */
export function roadKey(name: string): string {
  return name.replace(/^(ถนน|ถ\.)\s*/, '').replace(/\s+/g, '');
}

/** "ถ.รามคำแหง" whether the report writes ถนน, ถ. or the bare name */
export function roadLabel(name: string): string {
  return `ถ.${name.replace(/^(ถนน|ถ\.)\s*/, '')}`;
}

/** "สูง 20 ซม. · 300 ม. · เต็มผิว" from what the report gives */
export function floodingText(report: RoadFloodingReport): string {
  return [
    report.depth_cm !== null ? `สูง ${report.depth_cm} ซม.` : null,
    report.length_m !== null ? `ยาว ${report.length_m} ม.` : null,
    report.lanes_th,
  ]
    .filter(Boolean)
    .join(' · ');
}

const CLOCK = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY_CLOCK = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
/** "15:45 น." today, "25 ก.ย. 22:10 น." on another day */
export function reportTime(iso: string, now: number): string {
  const time = Date.parse(iso);
  return `${(DAY.format(time) === DAY.format(now) ? CLOCK : DAY_CLOCK).format(time)} น.`;
}

/** The report is of today (Thai date); another day's report is never shown as the situation now. */
export function isTodaysReport(flooding: RoadFloodingDaily, now: number): boolean {
  return flooding.report_date === DAY.format(now);
}

/** "ดอนเมือง" from "แขวงสีกัน เขตดอนเมือง กรุงเทพมหานคร"; null for a place outside Bangkok. */
export function bangkokDistrict(label: string | null | undefined): string | null {
  if (!label?.includes('กรุงเทพ')) return null;
  const token = label.split(/\s+/).find((part) => part.startsWith('เขต'));
  return token ? token.replace(/^เขต/, '') : null;
}

/**
 * Reports on the roads near a pin in the pin's own Bangkok district. The report has no coordinates, and a long
 * road such as พหลโยธิน crosses many districts and provinces, so the road name alone would pull in a report
 * from far away; the department reports Bangkok roads only, so a pin outside Bangkok gets none.
 */
export function reportsOnRoads(
  flooding: RoadFloodingDaily,
  roadNames: string[],
  district: string | null,
): RoadFloodingReport[] {
  if (!district) return [];
  const wanted = new Set(roadNames.map(roadKey));
  return flooding.reports.filter(
    (report) =>
      wanted.has(roadKey(report.road_th)) &&
      (report.district_th ?? '').replace(/^เขต/, '') === district,
  );
}

// ---------- how old a fetched file is (the DXS files are fetched now and then, not every round) ----------
const DAY_TIME = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
/** A file fetched more than this long ago is labelled "not real time" with its date (the owner's rule). */
export const NOT_REAL_TIME_MS = 24 * 3_600_000;

/** null while fresh; "not updated by itself" after 45 minutes; "not real time, data of <date>" after a day. */
export function oldNote(fetchedAt: string, now: number): string | null {
  const age = now - Date.parse(fetchedAt);
  if (age > NOT_REAL_TIME_MS)
    return `ข้อมูลนี้ไม่ใช่ข้อมูลเรียลไทม์ · ข้อมูล ณ วันที่ ${DAY_TIME.format(Date.parse(fetchedAt))} น.`;
  if (age > BKK_STALE_MS) return `ดึงเมื่อ ${reportTime(fetchedAt, now)} ไม่ได้อัปเดตอัตโนมัติ`;
  return null;
}

// ---------- large dams (contract section 18) and TMD stations (section 19) ----------
export type { Dam, DamReport, SituationReport, WeatherStation, WeatherToday };

export const DAM_CLASSES = [
  { pin: 'pin-dam-low', label: 'ต่ำกว่า 30%', color: '#a1887f' },
  { pin: 'pin-dam', label: '30–80%', color: '#1e88e5' },
  { pin: 'pin-dam-high', label: '80–100%', color: '#fb8c00' },
  { pin: 'pin-dam-full', label: 'เกิน 100%', color: '#e53935' },
];
export const DAM_UNKNOWN_COLOR = '#90a4ae';

/** Pin picture of a dam by how full it is. */
export function damPin(dam: Dam): string {
  if (dam.percent === null) return 'pin-dam-unknown';
  const index = dam.percent < 30 ? 0 : dam.percent < 80 ? 1 : dam.percent < 100 ? 2 : 3;
  return DAM_CLASSES[index].pin;
}

/** TMD's daily rain classes (mm), for the station pins */
export const DAY_RAIN_CLASSES = [
  { pin: 'pin-wx-0', label: 'ไม่มีฝน', color: '#78909c' },
  { pin: 'pin-wx-1', label: '0.1–10', color: '#29b6f6' },
  { pin: 'pin-wx-2', label: '10.1–35', color: '#1e6fd9' },
  { pin: 'pin-wx-3', label: '35.1–90', color: '#6a3fc1' },
  { pin: 'pin-wx-4', label: 'เกิน 90', color: '#c2185b' },
];

/** Pin picture of a TMD station by the rain of its morning report. */
export function weatherPin(station: WeatherStation): string {
  const mm = station.rain_mm;
  if (mm === null) return 'pin-wx-none';
  const index = mm < 0.1 ? 0 : mm <= 10 ? 1 : mm <= 35 ? 2 : mm <= 90 ? 3 : 4;
  return DAY_RAIN_CLASSES[index].pin;
}

const NUMBER = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
/** "8,437.68" or "–" */
export function amount(value: number | null): string {
  return value === null ? '–' : NUMBER.format(value);
}

/** The dams that feed the Chao Phraya, the river through Bangkok (for the overview card). */
export const CHAO_PHRAYA_DAMS = ['200101', '200102', '100107', '100301'];

const THAI_DAY = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
/** "26 ก.ย. 2569" for a report date written 2026-09-26 */
export function thaiDay(isoDate: string): string {
  return THAI_DAY.format(Date.parse(`${isoDate}T12:00:00+07:00`));
}
