import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Alert, AlertsFeed, LiveFloods, PlaceGazetteer, RainForecast } from './data';
import { favoriteLine } from './favoriteLine';
import { watchAreas, type Overview } from './overview';

const example = <T>(path: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/v1/examples/${path}`, import.meta.url), 'utf8'),
  ) as T;
// the producer's examples: Bangkok and Pathum Thani, the summary at 17:30 on 26 Sep, the forecast of 11:50
const places = example<PlaceGazetteer>('places/places.json');
const overview = example<Overview>('overview/overview.json');
const forecast = example<RainForecast>('forecast/rain.json');
const floods = example<LiveFloods>('live-floods/floods.json');
const AT = Date.parse('2026-09-26T17:30:00+07:00');
const CHATUCHAK = [100.565, 13.826]; // the DOPA point of แขวงลาดยาว เขตจตุจักร
const THANYABURI = [100.632, 13.987]; // ต.ประชาธิปัตย์ อ.ธัญบุรี จ.ปทุมธานี
// the extreme alert of the example over Bangkok and the provinces around it, still in effect at AT
const extreme = {
  ...example<AlertsFeed>('active/alerts.json').alerts.find((a) => a.severity === 'Extreme')!,
  effective: '2026-09-26T08:00:00+07:00',
  expires: '2026-09-27T06:00:00+07:00',
} as Alert;
const areas = watchAreas(overview, AT);
const line = (point: number[], extra: Partial<Parameters<typeof favoriteLine>[0]> = {}) =>
  favoriteLine({
    point,
    alerts: [],
    trust: 'ok',
    places,
    areas,
    floods: null,
    forecast,
    now: AT,
    ...extra,
  }).map((part) => `${part.tone}:${part.text}`);

describe('the saved place in one line (user, 2026-10-01)', () => {
  it('says the alert over it, its district on the summary, flood reports near it and today’s rain', () => {
    const near = {
      ...floods,
      reports: [
        {
          ...floods.reports[0],
          location: [100.566, 13.827],
          start: '2026-09-26T17:00:00+07:00',
          stop: '2026-09-26T18:00:00+07:00',
        },
      ],
    } as LiveFloods;
    expect(line(CHATUCHAK, { alerts: [extreme], floods: near })).toEqual([
      'danger:มีประกาศรุนแรงมาก',
      'danger:เขตจตุจักร ต้องระวังตอนนี้',
      'danger:น้ำท่วมใกล้ๆ 1 จุด',
      'muted:วันนี้ฝนปานกลาง ราว 23.8 มม.',
    ]);
  });

  it('names the province to prepare for when its district is not on the list to watch now', () => {
    expect(line(THANYABURI)).toEqual([
      'ok:ไม่มีประกาศ',
      'warn:จ.ปทุมธานี เตรียมรับมือ',
      'muted:วันนี้ฝนปานกลาง ราว 32 มม.',
    ]);
  });

  it('never says safe: an alert feed it cannot trust, and missing data, are left as such', () => {
    expect(line(CHATUCHAK, { trust: 'stale', places: null, forecast: null })).toEqual([
      'muted:ตรวจประกาศไม่ครบ',
    ]);
    // a forecast older than 12 hours is not read as today's
    const old = { ...forecast, fetched_at: '2026-09-26T05:00:00+07:00' };
    expect(line(CHATUCHAK, { forecast: old })).toEqual([
      'ok:ไม่มีประกาศ',
      'danger:เขตจตุจักร ต้องระวังตอนนี้',
    ]);
  });
});
