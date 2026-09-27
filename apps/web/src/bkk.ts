import type { CanalLevels, CanalStation } from '../../../contracts/v1/ts/bkk_water';
import type { RainGauge, RainGauges } from '../../../contracts/v1/ts/bkk_rain';
import type { RoadFloodingDaily, RoadFloodingReport } from '../../../contracts/v1/ts/bkk_flooding';
import type { SituationReport } from '../../../contracts/v1/ts/bkk_news';
import type { Dam, DamReport } from '../../../contracts/v1/ts/dams';
import type { WeatherStation, WeatherToday } from '../../../contracts/v1/ts/weather_today';
import { agoText } from './floods';
import { dayRainWords } from './forecast';
import { rainWords as rateWords } from './geo';
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

/**
 * Rain of the last hour in the words the site gives a radar rain rate (geo.rainWords: under 1 mm light, to 4
 * slight, to 16 moderate, to 48 heavy, then very heavy), so a gauge and the radar over it read alike. TMD
 * classes only a day's total (DAY_RAIN_CLASSES), so these words are the site's own.
 */
export const RAIN_HOUR_CLASSES = [
  { pin: 'pin-rain-0', label: 'ไม่มีฝน', range: '', color: '#78909c' },
  { pin: 'pin-rain-1', label: 'เล็กน้อย', range: 'ต่ำกว่า 1', color: '#81d4fa' },
  { pin: 'pin-rain-2', label: 'เบา', range: '1–4', color: '#29b6f6' },
  { pin: 'pin-rain-3', label: 'ปานกลาง', range: '4–16', color: '#1e6fd9' },
  { pin: 'pin-rain-4', label: 'หนัก', range: '16–48', color: '#6a3fc1' },
  { pin: 'pin-rain-5', label: 'หนักมาก', range: '48 ขึ้นไป', color: '#c2185b' },
];
export const RAIN_OLD_COLOR = '#b0bec5';

const hourClass = (mm: number) =>
  mm <= 0 ? 0 : 1 + [1, 4, 16, 48].filter((bound) => mm >= bound).length;

/** Pin picture of a rain gauge by its rain in the last hour; grey without a recent reading. */
export function rainPin(gauge: RainGauge, now: number): string {
  const mm = gauge.rain_1h_mm;
  if (mm === null || !isRecent(gauge.observed_at, now)) return 'pin-rain-old';
  return RAIN_HOUR_CLASSES[hourClass(mm)].pin;
}

/** "ฝนปานกลาง" for 8 mm in an hour (the words above); "ไม่มีค่า" without a reading */
export function hourRainWords(mm: number | null): string {
  if (mm === null) return 'ไม่มีค่า';
  return mm <= 0 ? 'ไม่มีฝน' : rateWords(mm);
}

/** "ฝนปานกลาง (8 มม.)" for an hour, or "ฝนหนักมาก (120.5 มม.)" for 24 hours in TMD's words */
export function rainAmountWords(mm: number | null, hours: 1 | 24): string {
  if (mm === null) return 'ไม่มีค่า';
  const words = hours === 1 ? hourRainWords(mm) : dayRainWords(mm);
  return words === 'ไม่มีฝน' ? words : `${words} (${mmText(mm)})`;
}

/** "15 นาทีล่าสุดไม่มีฝน" or "15 นาทีล่าสุดยังมีฝน 2 มม."; null without a reading */
export function lastQuarterText(mm: number | null): string | null {
  if (mm === null) return null;
  return mm > 0 ? `15 นาทีล่าสุดยังมีฝน ${mmText(mm)}` : '15 นาทีล่าสุดไม่มีฝน';
}

/** "กรมอุตุนิยมวิทยา" from "กรมอุตุนิยมวิทยา (ผ่านระบบ DXS ของ…)": the agency alone, for a short source link */
export function shortCredit(credit: string): string {
  return credit.replace(/\s*\(.*\)$/, '');
}

/** "1.78 ม.รทก." or "ไม่มีค่า" */
export function levelText(metres: number | null): string {
  return metres === null ? 'ไม่มีค่า' : `${metres.toFixed(2)} ม.รทก.`;
}

/**
 * "สูงกว่าระดับน้ำทะเล 2 ซม." for 0.02 ม.รทก. The department gives no bank or warning level with its stations,
 * so a level alone cannot say high or low for its canal; this only says it plainly.
 */
export function levelWords(metres: number | null): string {
  if (metres === null) return 'ไม่มีค่า';
  const cm = Math.round(Math.abs(metres) * 100);
  if (cm === 0) return 'เท่ากับระดับน้ำทะเล';
  const size = cm < 100 ? `${cm} ซม.` : `${(cm / 100).toFixed(2)} ม.`;
  return `${metres > 0 ? 'สูงกว่า' : 'ต่ำกว่า'}ระดับน้ำทะเล ${size}`;
}

/** "วัดเมื่อ 19:25 น. (27 นาทีก่อน)", with the date when it was another day */
export function measuredText(observedAt: string | null, now: number): string {
  if (!observedAt) return 'ไม่มีค่าล่าสุด';
  const ago = agoText(observedAt, now);
  return `วัดเมื่อ ${reportTime(observedAt, now)} (${ago === 'เมื่อสักครู่' ? ago : ago.replace(/^เมื่อ /, '')})`;
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

/** The Royal Irrigation Department's words for water in a reservoir (เกณฑ์ปริมาณน้ำกักเก็บ, % of capacity). */
export const DAM_CLASSES = [
  { pin: 'pin-dam-critical', label: 'น้ำน้อยวิกฤต', range: '≤30%', color: '#8d6e63' },
  { pin: 'pin-dam-low', label: 'น้ำน้อย', range: '30–50%', color: '#c49a6c' },
  { pin: 'pin-dam', label: 'น้ำปานกลาง', range: '50–80%', color: '#1e88e5' },
  { pin: 'pin-dam-high', label: 'น้ำมาก', range: '80–100%', color: '#fb8c00' },
  { pin: 'pin-dam-full', label: 'เกินความจุเก็บกัก', range: 'เกิน 100%', color: '#e53935' },
];
export const DAM_UNKNOWN_COLOR = '#90a4ae';

const damClass = (percent: number) =>
  percent <= 30 ? 0 : percent <= 50 ? 1 : percent <= 80 ? 2 : percent <= 100 ? 3 : 4;

/** Pin picture of a dam by how full it is. */
export function damPin(dam: Dam): string {
  return dam.percent === null ? 'pin-dam-unknown' : DAM_CLASSES[damClass(dam.percent)].pin;
}

/** "น้ำมาก" for a reservoir 85 % full (the department's words); null without a figure */
export function damWords(percent: number | null): string | null {
  return percent === null ? null : DAM_CLASSES[damClass(percent)].label;
}

/** TMD's daily rain classes (mm), for the station pins */
export const DAY_RAIN_CLASSES = [
  { pin: 'pin-wx-0', label: 'ไม่มีฝน', range: '', color: '#78909c' },
  { pin: 'pin-wx-1', label: 'เล็กน้อย', range: '0.1–10', color: '#29b6f6' },
  { pin: 'pin-wx-2', label: 'ปานกลาง', range: '10.1–35', color: '#1e6fd9' },
  { pin: 'pin-wx-3', label: 'หนัก', range: '35.1–90', color: '#6a3fc1' },
  { pin: 'pin-wx-4', label: 'หนักมาก', range: 'เกิน 90', color: '#c2185b' },
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
