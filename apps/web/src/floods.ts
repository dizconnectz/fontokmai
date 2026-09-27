import type { LiveFloods } from '../../../contracts/v1/ts/live_floods';
import { distanceM } from './roads';

export type { LiveFloods };
export type FloodReport = LiveFloods['reports'][number];

export const FLOODS_STALE_MS = 45 * 60_000;
export const FLOOD_RADIUS_M = 3_000;

export const REPORTER_TH: Record<FloodReport['reporter'], string> = {
  highway_department: 'กรมทางหลวง',
  itic_staff: 'เจ้าหน้าที่ iTIC',
  public: 'ผู้ใช้รายงาน',
};

/** D33: a report made more than 12 hours ago is not shown, as the collector drops it (longdo_live.py). */
export const REPORT_MAX_AGE_MS = 12 * 3_600_000;
/** A report whose window ended more than 2 hours ago is not shown either (the collector's RECENT). */
export const ENDED_KEEP_MS = 2 * 3_600_000;

/**
 * The report may be shown at all. The web applies the collector's limits again, so a snapshot that stopped
 * refreshing (a tab left open, or the last good file after the source failed) never keeps an old report.
 */
export function isShown(report: FloodReport, now: number): boolean {
  return (
    now - Date.parse(report.start) <= REPORT_MAX_AGE_MS &&
    (!report.stop || now - Date.parse(report.stop) <= ENDED_KEEP_MS)
  );
}

/** The report is within its own time window (public reports last one hour) and still shown. */
export function isOngoing(report: FloodReport, now: number): boolean {
  return (
    isShown(report, now) &&
    Date.parse(report.start) <= now &&
    (!report.stop || now <= Date.parse(report.stop))
  );
}

/** "เมื่อ 12 นาทีก่อน", "เมื่อ 3 ชม.ก่อน", "เมื่อ 5 วันก่อน" */
export function agoText(time: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(time)) / 60_000));
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `เมื่อ ${minutes} นาทีก่อน`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `เมื่อ ${hours} ชม.ก่อน` : `เมื่อ ${Math.round(hours / 24)} วันก่อน`;
}

export interface NearFlood {
  report: FloodReport;
  distance: number;
}
/** Reports within `radiusM` of a pin, nearest first (ongoing before ended at the same distance). */
export function floodsNear(
  floods: LiveFloods,
  pin: number[],
  now: number,
  radiusM = FLOOD_RADIUS_M,
): NearFlood[] {
  return floods.reports
    .filter((report) => isShown(report, now))
    .map((report) => ({ report, distance: distanceM(pin, report.location) }))
    .filter((hit) => hit.distance <= radiusM)
    .sort(
      (a, b) =>
        Number(isOngoing(b.report, now)) - Number(isOngoing(a.report, now)) ||
        a.distance - b.distance,
    );
}

/** Newest reports first, ongoing ones only (the list of roads flooded now). */
export function latestFloods(floods: LiveFloods, now: number, limit = 8): FloodReport[] {
  return floods.reports.filter((report) => isOngoing(report, now)).slice(0, limit);
}
