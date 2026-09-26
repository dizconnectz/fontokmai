import { describe, expect, it } from 'vitest';
import { agoText, floodsNear, isOngoing, latestFloods, type LiveFloods } from './floods';

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

  it('says how long ago in plain words', () => {
    expect(agoText('2026-09-26T15:20:00+07:00', at('15:30'))).toBe('เมื่อ 10 นาทีก่อน');
    expect(agoText('2026-09-26T12:20:00+07:00', at('15:30'))).toBe('เมื่อ 3 ชม.ก่อน');
    expect(agoText('2026-09-26T15:30:00+07:00', at('15:30'))).toBe('เมื่อสักครู่');
  });
});
