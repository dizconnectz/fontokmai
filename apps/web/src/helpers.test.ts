import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoadFloodHistory } from '../../../contracts/v1/ts/road_flood_history';
import type { AlertsFeed } from './data';
import { cleanName, roadsNear, searchKey, searchRoads } from './roads';
import { MercatorCoordinate } from 'maplibre-gl';
import { inMultiPolygon, mercatorHeight, radarClass, radarPixel, rainWords } from './geo';
import { hazardTitle, levelOf, shortTime, summaryLine, whereText, worstLevel } from './alerts';

function example<T>(scenario: string, file: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../contracts/v1/examples/${scenario}/${file}`, import.meta.url),
      'utf8',
    ),
  ) as T;
}
const history = example<RoadFloodHistory>('road-flood-history', 'road_flood_history.json');
const expected = example<{
  normalize: { input: string; key: string }[];
  searches: { query: string; results: { key: string; flood_days: number }[] }[];
  near: { pin: number[]; radius_m: number; results: { key: string; distance_m: number }[] }[];
}>('road-flood-history', 'expected.json');

describe('road flood history follows the producer rules', () => {
  it.each(expected.normalize)('key of $input', ({ input, key }) => {
    expect(searchKey(input)).toBe(key);
  });
  it.each(expected.searches)('search $query', ({ query, results }) => {
    expect(searchRoads(history, query).map((r) => r.key)).toEqual(results.map((r) => r.key));
  });
  it.each(expected.near)('roads near $pin', ({ pin, radius_m, results }) => {
    const found = roadsNear(history, pin, radius_m);
    expect(found.map((r) => r.road.key)).toEqual(results.map((r) => r.key));
    expect(found.map((r) => Math.round(r.distance))).toEqual(results.map((r) => r.distance_m));
  });
  it('keeps the display name readable', () => {
    expect(cleanName('ถ.รังสิต-นครนายก')).toBe('รังสิต-นครนายก');
  });
});

describe('map helpers', () => {
  const square = [
    [
      [
        [100, 13],
        [101, 13],
        [101, 14],
        [100, 14],
        [100, 13],
      ],
      [
        [100.4, 13.4],
        [100.6, 13.4],
        [100.6, 13.6],
        [100.4, 13.6],
        [100.4, 13.4],
      ],
    ],
  ];
  it('finds a pin inside a polygon but not inside its hole', () => {
    expect(inMultiPolygon([100.2, 13.2], square)).toBe(true);
    expect(inMultiPolygon([100.5, 13.5], square)).toBe(false);
    expect(inMultiPolygon([102, 13.5], square)).toBe(false);
  });
  const corners = [
    [95, 22.5],
    [108, 22.5],
    [108, 4],
    [95, 4],
  ];
  it('maps a coordinate to a radar pixel and rejects points outside the frame', () => {
    expect(radarPixel(corners, 1800, 2644, [95, 22.5])).toEqual({ x: 0, y: 0 });
    expect(radarPixel(corners, 1800, 2644, [120, 13])).toBeNull();
    expect(radarPixel(corners, 1800, 2644, [100, 3.9])).toBeNull();
    // TMD frames are 1800 x 2644: the Web Mercator shape of the box, not an even lat/lon grid (2561.5)
    expect(mercatorHeight(corners, 1800)).toBeCloseTo(2644.4, 1);
  });
  // Where MapLibre draws a lon/lat of an image source: linear between the corners in Mercator space.
  function drawnPixel(point: [number, number]) {
    const topLeft = MercatorCoordinate.fromLngLat(corners[0] as [number, number]);
    const bottomRight = MercatorCoordinate.fromLngLat(corners[2] as [number, number]);
    const at = MercatorCoordinate.fromLngLat(point);
    return {
      x: ((at.x - topLeft.x) / (bottomRight.x - topLeft.x)) * 1800,
      y: ((at.y - topLeft.y) / (bottomRight.y - topLeft.y)) * 2644,
    };
  }
  it.each([
    ['the north (Chiang Rai)', [99.83, 19.91]],
    ['Rangsit', [100.62, 14.02]],
    ['Bangkok', [100.5, 13.75]],
    ['the south (Hat Yai)', [100.47, 7.0]],
  ] as [string, [number, number]][])('reads the same pixel the map draws in %s', (_, point) => {
    const read = radarPixel(corners, 1800, 2644, point)!;
    const drawn = drawnPixel(point);
    expect(Math.abs(read.x - drawn.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(read.y - drawn.y)).toBeLessThanOrEqual(1);
  });
  const legend = [
    { min_mm_per_hr: 8, color: '#00B347', label: '8' },
    { min_mm_per_hr: 2, color: '#0006F0', label: '2' },
    { min_mm_per_hr: 0.1, color: '#0077C6', label: '0.1' },
  ];
  it('undoes the white blend of radar pixels before matching the legend', () => {
    expect(radarClass([0x2f, 0x35, 0xec, 255], legend, 0.816)?.label).toBe('2');
    expect(radarClass([0x2f, 0x8d, 0xcb, 255], legend, 0.816)?.label).toBe('0.1');
    expect(radarClass([255, 255, 255, 0], legend, 0.816)).toBeNull();
    expect(rainWords(2)).toBe('ฝนเบา');
    expect(rainWords(8)).toBe('ฝนปานกลาง');
  });
});

describe('alert summaries', () => {
  it('counts provinces without the region names TMD sometimes adds', () => {
    const alert = {
      area_desc_th: 'ภาคตะวันออก กรุงเทพมหานคร สมุทรปราการ นนทบุรี ปทุมธานี',
    } as Parameters<typeof whereText>[0];
    expect(whereText(alert)).toBe('4 จังหวัด รวม กทม. และภาคตะวันออก');
    expect(whereText({ area_desc_th: 'ภาคใต้' } as Parameters<typeof whereText>[0])).toBe('ภาคใต้');
  });

  const feed = example<AlertsFeed>('active', 'alerts.json');
  const now = Date.parse('2026-09-25T18:20:00+07:00');
  it('reads the severity, hazard and area in plain Thai', () => {
    const veryHeavy = feed.alerts.find((a) => a.event === 'Very Heavy Rain')!;
    expect(levelOf(veryHeavy)).toBe('extreme');
    expect(hazardTitle(veryHeavy)).toBe('ฝนตกหนักมาก');
    expect(whereText(veryHeavy)).toBe('30 จังหวัด รวม กทม.');
    expect(summaryLine(veryHeavy, now)).toMatch(/^ฝนตกหนักมาก · 30 จังหวัด รวม กทม\. · ถึง /);
    expect(worstLevel(feed.alerts)).toBe('extreme');
    expect(worstLevel([])).toBeNull();
  });
  it('writes times relative to today in Thai time', () => {
    expect(shortTime('2026-09-25T20:00:00+07:00', now)).toBe('วันนี้ 20:00 น.');
    expect(shortTime('2026-09-26T06:00:00+07:00', now)).toBe('พรุ่งนี้ 06:00 น.');
  });
});
