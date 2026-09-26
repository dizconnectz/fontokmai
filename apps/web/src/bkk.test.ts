import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isRecent,
  levelText,
  mmText,
  nearest,
  rainPin,
  waterPin,
  type CanalLevels,
  type RainGauges,
} from './bkk';

// the producer's examples from synthetic DXS answers (contracts/v1/examples/bkk), read at 17:20 on 26 Sep
const read = <T>(name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/v1/examples/bkk/${name}`, import.meta.url), 'utf8'),
  ) as T;
const water = read<CanalLevels>('water.json');
const rain = read<RainGauges>('rain.json');
const AT = Date.parse('2026-09-26T17:20:00+07:00');

describe('Bangkok canal levels and rain gauges', () => {
  it('turns a pin grey without a recent reading', () => {
    const [khlongToei, , swapped, none] = water.stations;
    expect(waterPin(khlongToei, AT)).toBe('pin-water');
    expect(waterPin(khlongToei, AT + 3 * 3_600_000)).toBe('pin-water-old');
    expect(waterPin(swapped, AT)).toBe('pin-water'); // only the outer level is known
    expect(waterPin(none, AT)).toBe('pin-water-old');
    expect(isRecent(null, AT)).toBe(false);
  });

  it('colours a rain gauge by the rain of the last hour', () => {
    const [heavy, dry, silent] = rain.gauges;
    expect(rainPin(heavy, AT)).toBe('pin-rain-2'); // 12 mm
    expect(rainPin(dry, AT)).toBe('pin-rain-0');
    expect(rainPin(silent, AT)).toBe('pin-rain-old');
    expect(rainPin({ ...heavy, rain_1h_mm: 45 }, AT)).toBe('pin-rain-4');
  });

  it('writes levels in metres above sea level and rain in millimetres', () => {
    expect(levelText(1.78)).toBe('1.78 ม.รทก.');
    expect(levelText(-0.1)).toBe('-0.10 ม.รทก.');
    expect(levelText(null)).toBe('ไม่มีค่า');
    expect(mmText(12)).toBe('12 มม.');
    expect(mmText(0)).toBe('0 มม.');
    expect(mmText(null)).toBe('–');
  });

  it('lists the stations near a pin, nearest first, and skips those without a place', () => {
    const near = nearest(water.stations, [100.5703, 13.7065], 3_000);
    expect(near.map((n) => n.item.code)).toEqual(['S001']);
    expect(nearest(water.stations, [100.56, 13.75], 10_000).map((n) => n.item.code)).toEqual([
      'S001',
      'S002',
    ]);
  });
});
