import type { CanalLevels, CanalStation } from '../../../contracts/v1/ts/bkk_water';
import type { RainGauge, RainGauges } from '../../../contracts/v1/ts/bkk_rain';
import type { RoadFloodingDaily, RoadFloodingReport } from '../../../contracts/v1/ts/bkk_flooding';
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

/** Reports on the roads near a pin, matched by road name only (the report has no coordinates). */
export function reportsOnRoads(
  flooding: RoadFloodingDaily,
  roadNames: string[],
): RoadFloodingReport[] {
  const wanted = new Set(roadNames.map(roadKey));
  return flooding.reports.filter((report) => wanted.has(roadKey(report.road_th)));
}
