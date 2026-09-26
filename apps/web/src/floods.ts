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

/** The report is within its own time window (public reports last one hour). */
export function isOngoing(report: FloodReport, now: number): boolean {
  return Date.parse(report.start) <= now && (!report.stop || now <= Date.parse(report.stop));
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
