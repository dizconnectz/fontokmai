import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Boundaries, PlaceGazetteer, SatelliteFloods } from './data';
import { favoriteLine } from './favoriteLine';
import { nearestSubdistrict } from './places';
import {
  satelliteColor,
  satelliteNear,
  satelliteOld,
  satelliteShapes,
  satelliteWords,
} from './satellite';

const example = <T>(path: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/v1/examples/${path}`, import.meta.url), 'utf8'),
  ) as T;
const places = example<PlaceGazetteer>('places/places.json');
const boundaries = JSON.parse(
  readFileSync(
    new URL('../../../pipeline/src/fontokmai/ref_data/boundaries.json', import.meta.url),
    'utf8',
  ),
) as Boundaries;
const AT = Date.parse('2026-10-04T13:00:00+07:00');
const CHATUCHAK = [100.565, 13.826];
const district = (code: string, area: number, name: string) => ({
  code,
  name_th: name,
  area_km2: area,
  cells: Math.max(1, Math.round(area * 8)),
  population: 1200,
  buildings: 30,
});
const own = nearestSubdistrict(places, CHATUCHAK)!.place.code.slice(0, 4);
const file = (districts: SatelliteFloods['districts'], fetched = '2026-10-04T12:00:00+07:00') =>
  ({
    schema_version: '1',
    product: 'gistda_flood_3days',
    name_th: 'พื้นที่น้ำท่วมจากภาพดาวเทียม (ในรอบ 3 วัน)',
    credit_th: 'GISTDA',
    source_url: 'https://disaster.gistda.or.th/',
    fetched_at: fetched,
    window_days: 3,
    scenes: ['S1D_20261002_0609'],
    latest_scene_day: '2026-10-02',
    total_km2: districts.reduce((sum, d) => sum + d.area_km2, 0),
    districts,
    notes_th: [],
  }) as SatelliteFloods;

describe('GISTDA flood water seen from satellites (user 2026-10-04)', () => {
  it('colours a district by its water and draws its outline', () => {
    expect(satelliteColor(25)).toBe('#08306b');
    expect(satelliteColor(0.2)).toBe('#9ecae1');
    const shapes = satelliteShapes(
      file([district(own, 6, 'เขตจตุจักร กรุงเทพมหานคร')]),
      boundaries,
    );
    expect(shapes.features).toHaveLength(1);
    expect(shapes.features[0].properties).toEqual({ code: own, color: '#2171b5', area: 6 });
  });

  it('finds water in the district of a point and in districts within 10 km', () => {
    const far = file([district('6403', 3, 'อ.คีรีมาศ จ.สุโขทัย')]);
    expect(satelliteNear(far, places, CHATUCHAK, own)).toEqual({ here: null, near: [] });
    const neighbour = places.places.find(
      (p) => p.kind === 'subdistrict' && p.code.slice(0, 4) !== own && p.code.startsWith('10'),
    )!;
    const seen = satelliteNear(
      file([district(neighbour.code.slice(0, 4), 2, 'เขตข้างๆ กรุงเทพมหานคร')]),
      places,
      neighbour.location,
      own,
    );
    expect(seen.here).toBeNull();
    expect(seen.near[0].km).toBeLessThan(0.01);
  });

  it('says it on the saved place’s line: here is danger, near is a warning, an old file says nothing', () => {
    const line = (satellite: SatelliteFloods) =>
      favoriteLine({
        point: CHATUCHAK,
        alerts: [],
        trust: 'ok',
        places,
        areas: [],
        floods: null,
        forecast: null,
        satellite,
        now: AT,
      }).map((part) => `${part.tone}:${part.text}`);
    expect(line(file([district(own, 1, 'เขตจตุจักร กรุงเทพมหานคร')]))).toContain(
      'danger:ดาวเทียมเห็นน้ำท่วมในอำเภอนี้',
    );
    const old = file([district(own, 1, 'เขตจตุจักร กรุงเทพมหานคร')], '2026-10-02T12:00:00+07:00');
    expect(satelliteOld(old, AT)).toBe(true);
    expect(line(old).some((part) => part.includes('ดาวเทียม'))).toBe(false);
  });

  it('puts the water in plain words', () => {
    expect(satelliteWords(district('1030', 12.4, 'x'))).toBe(
      'น้ำท่วมราว 12 ตร.กม. · ประชากรในพื้นที่น้ำราว 1,200 คน',
    );
    expect(satelliteWords({ ...district('1030', 0.04, 'x'), population: 0 })).toBe(
      'น้ำท่วมราว น้อยกว่า 0.1 ตร.กม.',
    );
  });
});
