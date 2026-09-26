import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  amount,
  bangkokDistrict,
  damPin,
  floodingText,
  isRecent,
  isTodaysReport,
  oldNote,
  levelText,
  mmText,
  nearest,
  rainPin,
  reportsOnRoads,
  reportTime,
  roadKey,
  roadLabel,
  waterPin,
  weatherPin,
  type CanalLevels,
  type RainGauges,
  type DamReport,
  type RoadFloodingDaily,
  type WeatherToday,
} from './bkk';

// the producer's examples from synthetic DXS answers (contracts/v1/examples/bkk), read at 17:20 on 26 Sep
const read = <T>(name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/v1/examples/bkk/${name}`, import.meta.url), 'utf8'),
  ) as T;
const water = read<CanalLevels>('water.json');
const rain = read<RainGauges>('rain.json');
const flooding = read<RoadFloodingDaily>('flooding.json');
const dams = read<DamReport>('dams.json');
const weather = read<WeatherToday>('weather-today.json');
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

  it('describes a reported road and matches it to nearby roads by name only', () => {
    const [wet, dry] = flooding.reports;
    expect(wet.dry_at).toBeNull();
    expect(floodingText(wet)).toBe('สูง 20 ซม. · ยาว 300 ม. · เต็มผิว');
    expect(roadLabel(wet.road_th)).toBe('ถ.ทดสอบหนึ่ง');
    expect(roadKey('ถนนรามคำแหง')).toBe(roadKey('ถ. รามคำแหง'));
    // same road name and same Bangkok district only (the example report is in เขตดินแดง)
    expect(reportsOnRoads(flooding, ['ทดสอบสอง', 'ไม่มีในรายงาน'], 'ดินแดง')).toEqual([dry]);
    expect(reportsOnRoads(flooding, ['ทดสอบสอง'], 'พญาไท')).toEqual([]);
    expect(reportsOnRoads(flooding, ['ทดสอบสอง'], null)).toEqual([]);
    expect(bangkokDistrict('แขวงสีกัน เขตดอนเมือง กรุงเทพมหานคร')).toBe('ดอนเมือง');
    expect(bangkokDistrict('ต.ประชาธิปัตย์ อ.ธัญบุรี จ.ปทุมธานี')).toBeNull();
    expect(reportTime(dry.dry_at!, AT)).toBe('17:15 น.');
    expect(isTodaysReport(flooding, AT)).toBe(true);
    expect(isTodaysReport(flooding, AT + 24 * 3_600_000)).toBe(false);
    expect(reportTime(flooding.reports[2].flood_start!, AT)).toMatch(/^25 ก\.ย\. 22:10 น\.$/);
  });

  it('says when fetched data is not updated by itself, and that it is not real time after a day', () => {
    const fetched = flooding.fetched_at;
    expect(oldNote(fetched, Date.parse(fetched) + 10 * 60_000)).toBeNull();
    expect(oldNote(fetched, Date.parse(fetched) + 2 * 3_600_000)).toMatch(
      /^ดึงเมื่อ .*ไม่ได้อัปเดตอัตโนมัติ$/,
    );
    expect(oldNote(fetched, Date.parse(fetched) + 26 * 3_600_000)).toMatch(
      /^ข้อมูลนี้ไม่ใช่ข้อมูลเรียลไทม์ · ข้อมูล ณ วันที่ 26 ก\.ย\. 2569 17:20 น\.$/,
    );
  });

  it('colours dams by how full they are and stations by their morning rain', () => {
    const [bhumibol, unplaced, pasak] = dams.dams;
    expect(damPin(bhumibol)).toBe('pin-dam'); // 62.68 %
    expect(damPin(unplaced)).toBe('pin-dam-high'); // 95 %
    expect(damPin(pasak)).toBe('pin-dam-high'); // 82.99 %
    expect(damPin({ ...pasak, percent: 104 })).toBe('pin-dam-full');
    expect(damPin({ ...pasak, percent: null })).toBe('pin-dam-unknown');
    expect(unplaced.location).toBeNull();
    const [bangkok, dry, broken] = weather.stations;
    expect(weatherPin(bangkok)).toBe('pin-wx-3'); // 52.8 mm
    expect(weatherPin(dry)).toBe('pin-wx-0');
    expect(weatherPin(broken)).toBe('pin-wx-none');
    expect(amount(8437.68)).toBe('8,437.68');
    expect(amount(null)).toBe('–');
  });
});
