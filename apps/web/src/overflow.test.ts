import { describe, expect, it } from 'vitest';
import { bankFeatures, bankState, type BankObservation } from './overflow';
import { validCanalLevels } from './data';
import type { CanalLevels } from './bkk';

const now = Date.parse('2026-09-30T11:00:00+07:00');
const point: BankObservation = {
  id: 'test',
  name_th: 'สถานีทดสอบ',
  kind: 'measurement',
  verified: true,
  source_url: 'https://example.com/evidence',
  credit_th: 'ข้อมูลสมมติสำหรับทดสอบ',
  observed_at: '2026-09-30T10:30:00+07:00',
  geometry: { type: 'Point', coordinates: [100.5, 13.75] },
  level_m: 1.2,
  bank_m: 1,
  level_datum: 'MSL-test',
  bank_datum: 'MSL-test',
  level_side: 'inner',
  bank_side: 'inner',
};
const reach: BankObservation = {
  id: 'reach-test',
  name_th: 'ช่วงทดสอบ',
  kind: 'reported_reach',
  verified: true,
  source_url: 'https://example.com/evidence',
  credit_th: 'ข้อมูลสมมติสำหรับทดสอบ',
  observed_at: point.observed_at,
  geometry: {
    type: 'LineString',
    coordinates: [
      [100.5, 13.75],
      [100.51, 13.76],
    ],
  },
  status: 'above_bank',
};
const file = (items: BankObservation[]): CanalLevels => ({
  schema_version: '1',
  fetched_at: new Date(now).toISOString(),
  source_url: 'https://example.com',
  credit_th: 'ทดสอบ',
  notes_th: [],
  stations: [],
  bank_observations: items,
});

describe('bank evidence, limited to its location and time', () => {
  it('compares like-for-like levels only at the point and treats equality distinctly', () => {
    expect(bankState(point, now)).toEqual({
      status: 'above_bank',
      text: 'น้ำสูงกว่าตลิ่ง 20 ซม. ณ จุดวัด',
    });
    expect(bankState({ ...point, level_m: 1 }, now).status).toBe('at_bank');
    expect(bankState({ ...point, level_m: 0.9 }, now).status).toBe('below_bank');
    expect(bankFeatures(file([point]), now).features[0].geometry.type).toBe('Point');
  });
  it.each([
    { bank_m: null },
    { level_m: null },
    { bank_datum: 'other' },
    { bank_side: 'outer' },
    { level_datum: null },
    { verified: false },
    { observed_at: null },
    { observed_at: '2026-09-30T09:59:59+07:00' },
    { observed_at: '2026-09-30T11:01:00+07:00' },
  ])('does not turn incomplete or old evidence red: %s', (extra) => {
    expect(bankState({ ...point, ...extra } as BankObservation, now).status).toBe('unknown');
  });
  it('renders only the explicitly reported reach, and expires without changing the file', () => {
    const first = bankFeatures(file([reach]), now).features[0];
    expect(first.geometry).toEqual(reach.geometry);
    expect(first.properties?.color).toBe('#c62828');
    expect(bankFeatures(file([reach]), now + 31 * 60_000).features[0].properties?.status).toBe(
      'unknown',
    );
    expect(bankFeatures(file([]), now).features).toEqual([]);
  });
  it('validates coordinates and rejects expanding a point measurement into a reach', () => {
    expect(validCanalLevels(file([point, reach]))).toBe(true);
    expect(
      validCanalLevels(
        file([{ ...point, geometry: reach.geometry } as unknown as BankObservation]),
      ),
    ).toBe(false);
    expect(
      validCanalLevels(file([{ ...point, geometry: { type: 'Point', coordinates: [100, 91] } }])),
    ).toBe(false);
    expect(
      validCanalLevels(
        file([
          {
            ...reach,
            geometry: { type: 'LineString', coordinates: [[100, 13]] },
          } as unknown as BankObservation,
        ]),
      ),
    ).toBe(false);
    const legacy = file([]);
    delete legacy.bank_observations;
    expect(validCanalLevels(legacy)).toBe(true);
  });
});
