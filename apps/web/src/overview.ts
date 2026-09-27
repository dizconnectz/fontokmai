import type { Overview } from '../../../contracts/v1/ts/overview';
import type { Alert } from '../../../contracts/v1/ts/alerts';
import { displayStatus } from './data';
import { worstLevel, type Level } from './alerts';

// The places to watch now and to prepare for (contract section 21): fixed rules on the producer, not official.
export type { Overview };
export type OverviewItem = Overview['items'][number];
export type OverviewReason = OverviewItem['reasons'][number];

/** The file is rebuilt every round (15 minutes): older than this it is labelled, older than the second hidden. */
export const OVERVIEW_STALE_MS = 45 * 60_000;
export const OVERVIEW_TOO_OLD_MS = 3 * 3_600_000;
/** items of each list shown before "ดูทั้งหมด" */
export const OVERVIEW_TOP = 5;

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const WEEKDAY = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long' });

/** Days from today (Thai calendar) to a Thai date written YYYY-MM-DD */
export function daysAway(isoDate: string, now: number): number {
  const today = Date.parse(`${DAY.format(now)}T00:00:00+07:00`);
  return Math.round((Date.parse(`${isoDate}T00:00:00+07:00`) - today) / 86_400_000);
}

/** "วันนี้", "พรุ่งนี้", "อีก 2 วัน (วันอังคาร)" from the viewer's clock */
export function dayWord(isoDate: string, now: number): string {
  const away = daysAway(isoDate, now);
  if (away === 0) return 'วันนี้';
  if (away === 1) return 'พรุ่งนี้';
  return `อีก ${away} วัน (${WEEKDAY.format(Date.parse(`${isoDate}T12:00:00+07:00`))})`;
}

/** A reason in plain words with its day; null when its day has passed (the file is older than the forecast). */
export function reasonLine(reason: OverviewReason, now: number): string | null {
  if (!reason.day) return reason.text_th;
  if (daysAway(reason.day, now) < 0) return null;
  // three days counted from its day read as they are; the others lead with their day
  return reason.kind === 'rain_3days'
    ? reason.text_th
    : `${dayWord(reason.day, now)}: ${reason.text_th}`;
}

/** The items of one list whose reasons still hold at `now` (a forecast day that has passed drops out). */
export function liveItems(overview: Overview, when: 'now' | 'next', now: number): OverviewItem[] {
  return overview.items.filter(
    (item) => item.when === when && item.reasons.some((reason) => reasonLine(reason, now) !== null),
  );
}

/**
 * The strongest official alert in effect or announced for the item's province, read from alerts.json: the
 * summary never copies alerts, it only points to them.
 */
export function officialFor(
  item: OverviewItem,
  alerts: Alert[],
  now: number,
): { level: Level; pending: boolean } | null {
  if (!item.province_code) return null;
  const target = `TH-${item.province_code}`;
  const here = alerts.filter((alert) => alert.targets.some((t) => t.code === target));
  const active = here.filter((alert) => displayStatus(alert, now) === 'active');
  const worst = worstLevel(active.length ? active : here);
  return worst ? { level: worst, pending: active.length === 0 } : null;
}

/** "ประกาศเตือนภัยของกรมอุตุฯ 2 ฉบับครอบคลุม 33 จังหวัด" from the alerts shown below the summary */
export function officialLine(alerts: Alert[]): string | null {
  if (!alerts.length) return null;
  const provinces = new Set(alerts.flatMap((alert) => alert.targets.map((t) => t.code)));
  return `มีประกาศเตือนภัยของกรมอุตุฯ ${alerts.length} ฉบับ ครอบคลุม ${provinces.size} จังหวัด (ดูด้านล่าง)`;
}

/** The inputs that were missing or not updated when the summary was made, e.g. "ฝนวัดจริง กทม. (สำนักการระบายน้ำ)" */
export function oldInputs(overview: Overview): string[] {
  return overview.inputs.filter((input) => input.status !== 'fresh').map((input) => input.name_th);
}
