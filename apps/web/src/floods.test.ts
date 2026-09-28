import { describe, expect, it } from 'vitest';
import {
  agoText,
  floodsNear,
  isOngoing,
  isShown,
  latestFloods,
  reportedAt,
  type LiveFloods,
} from './floods';

const at = (hhmm: string) => Date.parse(`2026-09-26T${hhmm}:00+07:00`);
const report = (id: string, start: string, stop: string | null, location: [number, number]) => ({
  id,
  title_th: `น้ำท่วม ${id}`,
  road_th: id,
  location,
  start: `2026-09-26T${start}:00+07:00`,
  stop: stop ? `2026-09-26T${stop}:00+07:00` : null,
  reporter: 'public' as const,
  url: `https://traffic.longdo.com/e/${id}`,
});
const floods = {
  schema_version: '1',
  fetched_at: '2026-09-26T15:30:00+07:00',
  source_url: 'https://traffic.longdo.com/',
  credit_th: 'iTIC และ Longdo Traffic (CC BY 4.0)',
  notes_th: [],
  reports: [
    report('near-now', '15:20', '16:20', [100.6, 14.0]),
    report('near-ended', '14:00', '15:00', [100.601, 14.0]),
    report('far', '15:10', '16:10', [100.9, 14.3]),
    report('highway', '06:00', null, [100.61, 14.005]),
  ],
} as LiveFloods;

describe('live flood reports', () => {
  it('knows which reports are within their own time window', () => {
    expect(isOngoing(floods.reports[0], at('15:30'))).toBe(true);
    expect(isOngoing(floods.reports[1], at('15:30'))).toBe(false);
    expect(isOngoing(floods.reports[3], at('15:30'))).toBe(true); // no stop time yet
  });

  it('lists nearby reports ongoing first, then by distance, within 3 km', () => {
    expect(floodsNear(floods, [100.6, 14.0], at('15:30')).map((f) => f.report.id)).toEqual([
      'near-now',
      'highway',
      'near-ended',
    ]);
  });

  it('shows only ongoing reports, newest first, in the list of roads flooded now', () => {
    expect(latestFloods(floods, at('15:30')).map((r) => r.id)).toEqual([
      'near-now',
      'far',
      'highway',
    ]);
  });

  it('drops reports past the collector limits even from a file that stopped refreshing (D33)', () => {
    const [nearNow, nearEnded, , highway] = floods.reports;
    // the highway report started at 06:00 with no end: shown to 18:00 exactly, then gone everywhere
    expect(isOngoing(highway, at('18:00'))).toBe(true);
    expect(isOngoing(highway, at('18:00') + 1)).toBe(false);
    expect(isShown(highway, at('18:00') + 1)).toBe(false);
    expect(latestFloods(floods, at('18:01')).map((r) => r.id)).not.toContain('highway');
    expect(
      floodsNear(floods, [100.61, 14.005], at('18:01')).map((hit) => hit.report.id),
    ).not.toContain('highway');
    // an ended report stays two hours after its end, faded, then goes
    expect(isShown(nearEnded, at('17:00'))).toBe(true);
    expect(isShown(nearEnded, at('17:00') + 1)).toBe(false);
    expect(isShown(nearNow, at('15:30'))).toBe(true);
  });

  it('says how long ago in plain words', () => {
    expect(agoText('2026-09-26T15:20:00+07:00', at('15:30'))).toBe('เมื่อ 10 นาทีก่อน');
    expect(agoText('2026-09-26T12:20:00+07:00', at('15:30'))).toBe('เมื่อ 3 ชม.ก่อน');
    expect(agoText('2026-09-26T15:30:00+07:00', at('15:30'))).toBe('เมื่อสักครู่');
    // a report says its day and clock too: "10 นาทีก่อน" alone does not say which day
    expect(reportedAt('2026-09-26T15:20:00+07:00', at('15:30'))).toBe(
      'วันนี้ 15:20 น. (10 นาทีก่อน)',
    );
    expect(reportedAt('2026-09-25T23:50:00+07:00', at('15:30'))).toBe(
      'เมื่อวาน 23:50 น. (16 ชม.ก่อน)',
    );
  });
});
