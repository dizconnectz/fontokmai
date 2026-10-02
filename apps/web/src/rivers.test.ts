import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RIVER_CLASSES,
  riverChart,
  riverOutlook,
  riverPin,
  riverStretches,
  riverSummary,
  riverWords,
  type RiverForecast,
} from './rivers';
import type { RiverLines } from './data';

// the producer's example from a recorded GloFAS answer, fetched at 11:42 on 27 Sep (contract section 20)
const rivers = JSON.parse(
  readFileSync(
    new URL('../../../contracts/v1/examples/forecast/rivers.json', import.meta.url),
    'utf8',
  ),
) as RiverForecast;
const AT = Date.parse('2026-09-27T11:42:00+07:00');
const point = (id: string) => rivers.points.find((p) => p.id === id)!;

describe('the GloFAS river trend', () => {
  it('compares the next 7 days of the ensemble median with today', () => {
    const bangkok = riverOutlook(rivers, point('cp-bangkok'), AT)!;
    expect(bangkok.today).toBe(7);
    expect(bangkok.trend).toBe('rising');
    expect(bangkok.day).toBe('2026-10-01');
    expect(riverWords(bangkok)).toBe('น้ำเพิ่มขึ้น สูงสุดราว +19% วันที่ 1 ต.ค.');
    expect(riverOutlook(rivers, point('bangpakong-chachoengsao'), AT)!.trend).toBe('rising_fast');
    expect(riverWords(riverOutlook(rivers, point('mekong-nongkhai'), AT))).toBe(
      'น้ำลดลง ต่ำสุดราว −17% วันที่ 4 ต.ค.',
    );
    expect(riverWords(riverOutlook(rivers, point('yom-sukhothai'), AT))).toBe(
      'น้ำทรงตัว เปลี่ยนไม่เกิน 10%',
    );
  });

  it('colours the pin by the trend, grey when the file does not reach today', () => {
    expect(riverPin(rivers, point('cp-bangkok'), AT)).toBe('pin-river-up');
    expect(riverPin(rivers, point('mun-ubon'), AT)).toBe('pin-river-up2');
    expect(riverPin(rivers, point('mekong-nongkhai'), AT)).toBe('pin-river-down');
    expect(riverPin(rivers, point('nan-phitsanulok'), AT)).toBe('pin-river');
    const later = AT + 60 * 86_400_000;
    expect(riverOutlook(rivers, point('cp-bangkok'), later)).toBeNull();
    expect(riverPin(rivers, point('cp-bangkok'), later)).toBe('pin-river-unknown');
    expect(riverWords(null)).toBe('ยังบอกแนวโน้มไม่ได้');
    expect(RIVER_CLASSES.map((item) => item.label)).toEqual([
      'เพิ่มขึ้นมาก',
      'เพิ่มขึ้น',
      'ทรงตัว',
      'ลดลง',
    ]);
  });

  it('draws the shape of the flow without its number', () => {
    const chart = riverChart(rivers, point('cp-bangkok'), 7, 230, 54);
    expect(chart.todayX).toBeCloseTo((7 / 36) * 230, 1);
    expect(chart.past.startsWith('M0 ')).toBe(true);
    expect(chart.ahead.startsWith(`M${chart.todayX} `)).toBe(true);
    expect(chart.band.endsWith('Z')).toBe(true);
    // every point stays inside the box
    const numbers = `${chart.past}${chart.ahead}${chart.band}`.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(230);
  });
});

describe('stretches of river by the system’s 7-day forecast (user, 2026-10-02)', () => {
  // all of the producer's stretches; the example file has the 14 stations only
  const lines = JSON.parse(
    readFileSync(
      new URL('../../../pipeline/src/fontokmai/ref_data/river_lines.json', import.meta.url),
      'utf8',
    ),
  ) as RiverLines;
  it('draws every stretch whose point has a trend, bold when it rises', () => {
    const shapes = riverStretches(lines, rivers, AT);
    const drawn = Object.fromEntries(shapes.features.map((f) => [f.properties.code, f.properties]));
    expect(drawn['cp-bangkok']).toMatchObject({
      trend: 'rising',
      color: RIVER_CLASSES[1].color,
      rising: true,
    });
    expect(drawn['bangpakong-chachoengsao']).toMatchObject({ trend: 'rising_fast', rising: true });
    // steady and falling show where the forecast is, thin
    expect(drawn['yom-sukhothai']).toMatchObject({ trend: 'steady', rising: false });
    expect(drawn['mekong-nongkhai']).toMatchObject({ trend: 'falling', rising: false });
    // a stretch whose point the file does not have (a reach point here) is not drawn
    expect(Object.keys(drawn).every((code) => rivers.points.some((p) => p.id === code))).toBe(true);
    expect(shapes.features[0].geometry.type).toBe('MultiLineString');
  });
  it('draws nothing for a day the file does not reach', () => {
    expect(riverStretches(lines, rivers, Date.parse('2026-12-01T12:00:00+07:00')).features).toEqual(
      [],
    );
  });
  it('lists the rivers forecast to rise first, each with its strongest stretch', () => {
    const rows = riverSummary(rivers, AT);
    expect(rows.map((row) => row.river).slice(0, 3)).toContain('แม่น้ำบางปะกง');
    const bangPakong = rows.find((row) => row.river === 'แม่น้ำบางปะกง')!;
    expect(bangPakong.trend).toBe('rising_fast');
    expect(bangPakong.rising[0].point.id).toBe('bangpakong-chachoengsao');
    const strengths = rows.map((row) => row.trend);
    // rising a lot, then rising, then steady, then falling
    expect(strengths.indexOf('falling')).toBeGreaterThan(strengths.lastIndexOf('rising'));
    expect(rows.find((row) => row.river === 'แม่น้ำโขง')).toMatchObject({
      trend: 'falling',
      rising: [],
    });
  });
});
