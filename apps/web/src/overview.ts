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

/**
 * How long what is happening holds when a reason carries no `until` (a file made before it, contract section 21):
 * the producer's own limits (D33 for flood reports).
 */
const HOLDS_MS: Partial<Record<OverviewReason['kind'], number>> = {
  flood_reports: 12 * 3_600_000,
  rain_measured: 60 * 60_000,
  rain_radar: 45 * 60_000,
};
/**
 * Until when a reason holds; null when only its day decides (forecasts, rivers, dams). The producer's `until` and
 * the kind's own limit from `at` both bound it: the earlier one counts, so a reason whose time was changed keeps
 * no older `until` alive.
 */
export function holdsUntil(reason: OverviewReason): number | null {
  const bounds: number[] = [];
  if (reason.until) bounds.push(Date.parse(reason.until));
  if (reason.kind === 'road_flooding')
    bounds.push(Date.parse(`${DAY.format(Date.parse(reason.at))}T00:00:00+07:00`) + 86_400_000);
  const holds = HOLDS_MS[reason.kind];
  if (holds !== undefined) bounds.push(Date.parse(reason.at) + holds);
  return bounds.length ? Math.min(...bounds) : null;
}

/**
 * A reason in plain words with its day; null when it no longer holds: its day has passed, or what was happening is
 * over (Codex M27: the reports of a cluster passed their 12 hours while the file itself was still fresh).
 */
export function reasonLine(reason: OverviewReason, now: number): string | null {
  const until = holdsUntil(reason);
  if (until !== null && now > until) return null;
  if (!reason.day) return reason.text_th;
  if (daysAway(reason.day, now) < 0) return null;
  // three days counted from its day read as they are; the others lead with their day
  return reason.kind === 'rain_3days'
    ? reason.text_th
    : `${dayWord(reason.day, now)}: ${reason.text_th}`;
}

/**
 * The items of one list whose reasons still hold at `now`. A place to watch now needs something that is still
 * happening: a forecast taken along with it does not keep it on the list alone.
 */
export function liveItems(overview: Overview, when: 'now' | 'next', now: number): OverviewItem[] {
  return overview.items.filter(
    (item) =>
      item.when === when &&
      item.reasons.some(
        (reason) => reasonLine(reason, now) !== null && (when === 'next' || !reason.day),
      ),
  );
}

/** "อ.ทับปุด จ.พังงา" → ["อ.ทับปุด", "จ.พังงา"]; "เขตจตุจักร กรุงเทพมหานคร" → ["เขตจตุจักร", "กรุงเทพมหานคร"] */
export function placeParts(place: string): [string, string] {
  const space = place.indexOf(' ');
  return space < 0 ? [place, place] : [place.slice(0, space), place.slice(space + 1)];
}

export interface PlaceGroup {
  province: string;
  /** strongest first, as the summary orders them */
  items: OverviewItem[];
}

/**
 * The places to watch now by province (user 2026-10-01: fifteen district cards were too long to take in): the
 * province of the strongest place first, each with its districts in the summary's order.
 */
export function groupByProvince(items: OverviewItem[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const item of items) {
    const province = placeParts(item.place_th)[1];
    const group = groups.get(province) ?? { province, items: [] };
    group.items.push(item);
    groups.set(province, group);
  }
  return [...groups.values()];
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
