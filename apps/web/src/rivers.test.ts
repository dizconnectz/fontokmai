import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RIVER_CLASSES,
  riverChart,
  riverOutlook,
  riverPin,
  riverStretches,
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

describe('stretches of river forecast to rise (user, 2026-10-02)', () => {
  // the producer's stretches of the six stations around Bangkok
  const lines = JSON.parse(
    readFileSync(
      new URL('../../../contracts/v1/examples/river-lines/river_lines.json', import.meta.url),
      'utf8',
    ),
  ) as RiverLines;
  it('draws a stretch orange or red as its point rises, and leaves the others out', () => {
    const shapes = riverStretches(lines, rivers, AT);
    const drawn = Object.fromEntries(shapes.features.map((f) => [f.properties.code, f.properties]));
    expect(drawn['cp-bangkok']).toMatchObject({ trend: 'rising', color: RIVER_CLASSES[1].color });
    expect(drawn['bangpakong-chachoengsao']).toMatchObject({
      trend: 'rising_fast',
      color: RIVER_CLASSES[0].color,
    });
    // every stretch drawn is of a point rising; every point rising has its stretch drawn
    for (const stretch of lines.stretches) {
      const trend = riverOutlook(rivers, point(stretch.point_id), AT)?.trend;
      expect(stretch.point_id in drawn).toBe(trend === 'rising' || trend === 'rising_fast');
    }
    expect(shapes.features[0].geometry.type).toBe('MultiLineString');
  });
  it('draws nothing for a point the file does not have, or a day the file does not reach', () => {
    expect(riverStretches(lines, { ...rivers, points: [] }, AT).features).toEqual([]);
    expect(riverStretches(lines, rivers, Date.parse('2026-12-01T12:00:00+07:00')).features).toEqual(
      [],
    );
  });
});
