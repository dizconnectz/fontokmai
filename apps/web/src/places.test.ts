import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  foundFromPlace,
  nearestSubdistrict,
  placeBounds,
  placeTokens,
  searchPlaces,
  type PlaceGazetteer,
} from './places';
import { parsePhoton } from './photon';

// Bangkok and Pathum Thani cut from the shipped gazetteer (contracts/v1/examples/places)
const gazetteer = JSON.parse(
  readFileSync(
    new URL('../../../contracts/v1/examples/places/places.json', import.meta.url),
    'utf8',
  ),
) as PlaceGazetteer;
const byCode = (code: string) => gazetteer.places.find((p) => p.code === code)!;
const codes = (query: string) => searchPlaces(gazetteer, query).map((p) => p.code);

describe('place search', () => {
  it('drops the words people type before a name', () => {
    expect(placeTokens('ต.คลองหนึ่ง  อ. คลองหลวง')).toEqual(['คลองหนึ่ง', 'คลองหลวง']);
    expect(placeTokens('จังหวัดปทุมธานี')).toEqual(['ปทุมธานี']);
    expect(placeTokens('แขวงบางนา เขตบางนา')).toEqual(['บางนา', 'บางนา']);
    expect(placeTokens('กทม.')).toEqual(['กรุงเทพมหานคร']);
    expect(placeTokens('   ')).toEqual([]);
  });

  it('puts the exact name first and the larger area before a subdistrict of the same name', () => {
    expect(codes('คลองหลวง')[0]).toBe('1302');
    expect(codes('บางนา').slice(0, 2)).toEqual(['1047', '104701']);
    expect(codes('ปทุม')[0]).toBe('13');
    expect(codes('กทม')[0]).toBe('10');
  });

  it('narrows a name with its district or province', () => {
    expect(codes('คลองหนึ่ง คลองหลวง')).toEqual(['130201']);
    expect(codes('คลองสอง ปทุมธานี')).toEqual(['130202']);
    // a parent name alone does not list every subdistrict inside it
    expect(codes('คลองหลวง')).not.toContain('130201');
  });

  it('forgives a space inside a name and finds nothing for an unknown name', () => {
    expect(codes('บาง นา')[0]).toBe('1047');
    expect(codes('ไม่มีที่นี่แน่นอน')).toEqual([]);
    expect(codes('')).toEqual([]);
  });

  it('describes a result the way the list and the pin card show it', () => {
    const tambon = foundFromPlace(gazetteer, byCode('130201'));
    expect(tambon).toMatchObject({
      id: 'dopa:130201',
      title: 'ต.คลองหนึ่ง',
      detail: 'อ.คลองหลวง จ.ปทุมธานี',
      kind: 'ตำบล',
      scale: 'subdistrict',
      province: 'ปทุมธานี',
      location: [100.607, 14.066],
    });
    expect(foundFromPlace(gazetteer, byCode('1047'))).toMatchObject({
      title: 'เขตบางนา',
      detail: 'กรุงเทพมหานคร',
      kind: 'เขต',
      province: 'กรุงเทพมหานคร',
    });
    expect(foundFromPlace(gazetteer, byCode('13'))).toMatchObject({
      title: 'จ.ปทุมธานี',
      detail: '',
      kind: 'จังหวัด',
      scale: 'province',
    });
  });

  it('zooms to the whole area of a district or province', () => {
    const [[west, south], [east, north]] = placeBounds(gazetteer, byCode('1302'));
    for (const p of gazetteer.places.filter((p) => p.code.startsWith('1302'))) {
      expect(p.location[0]).toBeGreaterThan(west);
      expect(p.location[0]).toBeLessThan(east);
      expect(p.location[1]).toBeGreaterThan(south);
      expect(p.location[1]).toBeLessThan(north);
    }
    const [[w, s], [e, n]] = placeBounds(gazetteer, byCode('130201'));
    expect([e - w, n - s].map((d) => Math.round(d * 100) / 100)).toEqual([0.04, 0.04]);
  });

  it('names a dropped pin after the nearest subdistrict point, but not far out at sea', () => {
    const near = nearestSubdistrict(gazetteer, [100.608, 14.066]);
    expect(near?.place.code).toBe('130201');
    expect(Math.round(near!.distance)).toBe(108);
    expect(nearestSubdistrict(gazetteer, [100.9, 13.2])).toBeNull();
  });
});

describe('landmarks from Photon', () => {
  const feature = (name: unknown, coordinates: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: { name, osm_type: 'N', osm_id: 1, type: 'house', ...extra },
  });

  it('keeps named points in Thailand with a short area line', () => {
    const [mall] = parsePhoton({
      features: [
        feature('Future Park Rangsit', [100.6184, 13.989], {
          district: 'ตำบลประชาธิปัตย์',
          city: 'รังสิต',
          county: 'อำเภอธัญบุรี',
          state: 'จังหวัดปทุมธานี',
          extent: [100.615, 13.992, 100.621, 13.986],
        }),
      ],
    });
    expect(mall).toMatchObject({
      title: 'Future Park Rangsit',
      detail: 'ต.ประชาธิปัตย์ รังสิต อ.ธัญบุรี จ.ปทุมธานี',
      kind: 'สถานที่',
      scale: 'point',
      province: null,
      source: 'osm',
      maxZoom: 16,
      bounds: [
        [100.615, 13.986],
        [100.621, 13.992],
      ],
    });
  });

  it('drops malformed answers, places abroad and a bus stop named after the landmark', () => {
    const found = parsePhoton({
      features: [
        feature('โรงพยาบาลศิริราช', [100.4854, 13.7578], { district: 'บางกอกน้อย' }),
        feature('โรงพยาบาลศิริราช', [100.4834, 13.757], { osm_value: 'bus_stop' }),
        feature('Singapore', [103.8, 1.35]),
        feature('', [100.5, 13.7]),
        feature(42, [100.5, 13.7]),
        feature('No point', 'here'),
        { type: 'Feature' },
        null,
      ],
    });
    expect(found.map((f) => f.title)).toEqual(['โรงพยาบาลศิริราช']);
    // a point without an extent gets a small area around it
    expect(found[0].bounds[1][0] - found[0].bounds[0][0]).toBeCloseTo(0.006);
    expect(parsePhoton({ features: 'nope' })).toEqual([]);
    expect(parsePhoton(null)).toEqual([]);
  });
});
