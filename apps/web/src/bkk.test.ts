import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  amount,
  bangkokDistrict,
  carriedFrom,
  carriedText,
  damPin,
  shownDam,
  damWords,
  damMissingText,
  damReadingLines,
  hasDamReadings,
  releaseChange,
  releaseWords,
  floodingText,
  hourRainWords,
  isRecent,
  isTodaysReport,
  lastQuarterText,
  measuredText,
  oldNote,
  damsOldNote,
  levelChange,
  levelChangeWords,
  levelSigned,
  LEVEL_NO_BANK_TH,
  levelText,
  levelWords,
  mmText,
  nearest,
  rainPin,
  rainAmountWords,
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

describe('dam readings when the source omits the daily figures', () => {
  const missing = {
    ...dams.dams[0],
    percent: null,
    volume_mcm: null,
    inflow_mcm: null,
    outflow_mcm: null,
    previous_outflow_mcm: 2,
  };

  it('does not count capacity or a previous release as a current reading', () => {
    expect(hasDamReadings(missing)).toBe(false);
    expect(damReadingLines(missing)).toEqual([]);
    expect(damMissingText(missing)).toBe('ยังไม่มีตัวเลขปริมาณน้ำและการระบายในรายงานนี้');
  });

  it.each(['percent', 'volume_mcm', 'inflow_mcm', 'outflow_mcm'] as const)(
    'keeps a reported zero in %s',
    (key) => {
      expect(hasDamReadings({ ...missing, [key]: 0 })).toBe(true);
    },
  );

  it('keeps partial observations with units and states the gaps without placeholder numbers', () => {
    const partial = { ...missing, outflow_mcm: 0 };
    expect(damReadingLines(partial)).toEqual(['ระบาย 0 ล้าน ลบ.ม./วัน']);
    expect(damMissingText(partial)).toBe('ยังไม่มีข้อมูล: ปริมาณน้ำในอ่าง / น้ำไหลเข้า');
    expect(damReadingLines({ ...partial, volume_mcm: 0, storage_mcm: null })).toEqual([
      'ปริมาณน้ำ 0 ล้าน ลบ.ม.',
      'ระบาย 0 ล้าน ลบ.ม./วัน',
    ]);
    expect(damMissingText({ ...partial, percent: 0, inflow_mcm: 0 })).toBeNull();
  });
});

describe('a dam the report leaves blank keeps its last known figures, dated', () => {
  const last = {
    report_date: '2026-09-30',
    fetched_at: '2026-09-30T17:14:00+07:00',
    percent: 106.8,
    volume_mcm: 930.8,
    inflow_mcm: 40.1,
    outflow_mcm: 25.2,
  };
  const dam = (percent: number | null, lastKnown: typeof last | null) => ({
    id: '100301',
    name_th: 'เขื่อนป่าสักชลสิทธิ์',
    region_th: null,
    owner_th: null,
    location: null,
    location_kind: null,
    storage_mcm: 871.5,
    volume_mcm: null,
    percent,
    inflow_mcm: null,
    outflow_mcm: null,
    last_known: lastKnown,
  });

  it('shows the earlier figures only when the report has none of its own', () => {
    expect(carriedFrom(dam(null, last))).toEqual(last);
    expect(shownDam(dam(null, last))).toMatchObject({ percent: 106.8, outflow_mcm: 25.2 });
    expect(damPin(shownDam(dam(null, last)))).toBe('pin-dam-full');
    // today's own figure wins; without earlier figures nothing is invented
    expect(carriedFrom(dam(98, last))).toBeNull();
    expect(shownDam(dam(98, last)).percent).toBe(98);
    expect(carriedFrom(dam(null, null))).toBeNull();
    expect(shownDam(dam(null, null)).percent).toBeNull();
  });

  it('says the day of the report and when it was fetched', () => {
    expect(carriedText(last)).toBe(
      'ตัวเลขล่าสุดที่มี: รายงานวันที่ 30 ก.ย. 2569 · ดึงเมื่อ 30 ก.ย. 17:14 น. (รายงานฉบับนี้ยังไม่มีตัวเลข)',
    );
  });

  it('ignores an empty last-known set but preserves a partial set and a real zero', () => {
    const empty = { ...last, percent: null, volume_mcm: null, inflow_mcm: null, outflow_mcm: null };
    const blank = { ...dam(null, null), last_known: empty };
    expect(carriedFrom(blank)).toBeNull();
    expect(hasDamReadings(shownDam(blank))).toBe(false);
    const partial = { ...blank, last_known: { ...empty, outflow_mcm: 0 } };
    expect(damReadingLines(shownDam(partial))).toEqual(['ระบาย 0 ล้าน ลบ.ม./วัน']);
    expect(damMissingText(shownDam(partial))).toBe('ยังไม่มีข้อมูล: ปริมาณน้ำในอ่าง / น้ำไหลเข้า');
  });
});

describe('dam releases against the report before', () => {
  const dam = (outflow: number | null, previous: number | null | undefined) => ({
    id: '1',
    name_th: 'เขื่อนทดสอบ',
    region_th: null,
    owner_th: null,
    location: null,
    location_kind: null,
    storage_mcm: null,
    volume_mcm: null,
    percent: null,
    inflow_mcm: null,
    outflow_mcm: outflow,
    previous_outflow_mcm: previous,
  });

  it('is up a lot at 1 million m³ a day more and half as much again (the site trial rule)', () => {
    expect(releaseChange(dam(12.34, 8.1))).toEqual({ direction: 'up', before: 8.1, big: true });
    expect(releaseChange(dam(3, 2))).toEqual({ direction: 'up', before: 2, big: true }); // both edges
    expect(releaseChange(dam(1, 0))?.big).toBe(true);
    expect(releaseChange(dam(26, 20))).toEqual({ direction: 'up', before: 20, big: false }); // only 30 %
    expect(releaseChange(dam(0.9, 0.2))?.big).toBe(false); // less than 1 more
    expect(releaseChange(dam(2, 5))).toEqual({ direction: 'down', before: 5, big: false });
    expect(releaseChange(dam(2.16, 2.16))?.direction).toBe('same');
    // a file made before the field, or a dam without a figure on either day: nothing to compare
    expect(releaseChange(dam(3, undefined))).toBeNull();
    expect(releaseChange(dam(null, 3))).toBeNull();
  });

  it('says it in plain words with the day compared with', () => {
    const words = (outflow: number, previous: number) =>
      releaseWords(releaseChange(dam(outflow, previous))!, '2026-09-28');
    expect(words(12.34, 8.1)).toBe('ระบายเพิ่มมาก จาก 8.1 (28 ก.ย.)');
    expect(words(26, 20)).toBe('ระบายเพิ่มขึ้น จาก 20 (28 ก.ย.)');
    expect(words(2, 5)).toBe('ระบายลดลง จาก 5 (28 ก.ย.)');
    expect(words(2.16, 2.16)).toBe('ระบายเท่ากับ 28 ก.ย.');
  });
});

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
    expect(rainPin(heavy, AT)).toBe('pin-rain-3'); // 12 mm: heavy
    expect(rainPin(dry, AT)).toBe('pin-rain-0');
    expect(rainPin(silent, AT)).toBe('pin-rain-old');
    expect(rainPin({ ...heavy, rain_1h_mm: 45 }, AT)).toBe('pin-rain-4');
  });

  it('says the rain in plain words: its own words for an hour, TMD words for a day', () => {
    // an hour reads like a radar rain rate at the same place (geo.rainWords)
    expect(hourRainWords(0)).toBe('ไม่มีฝน');
    expect(hourRainWords(0.5)).toBe('ฝนเล็กน้อย');
    expect(hourRainWords(2)).toBe('ฝนเบา');
    expect(hourRainWords(8)).toBe('ฝนปานกลาง');
    expect(hourRainWords(16)).toBe('ฝนหนัก');
    expect(hourRainWords(48)).toBe('ฝนหนักมาก');
    expect(hourRainWords(null)).toBe('ไม่มีค่า');
    // the owner's example: 8 mm in the last hour, 120.5 mm in 24 hours, none in the last 15 minutes
    expect(rainAmountWords(8, 1)).toBe('ฝนปานกลาง (8 มม.)');
    expect(rainAmountWords(120.5, 24)).toBe('ฝนหนักมาก (120.5 มม.)');
    expect(rainAmountWords(8, 24)).toBe('ฝนเล็กน้อย (8 มม.)');
    expect(rainAmountWords(0, 1)).toBe('ไม่มีฝน');
    expect(rainPin({ ...rain.gauges[0], rain_1h_mm: 0.5 }, AT)).toBe('pin-rain-1');
    expect(rainPin({ ...rain.gauges[0], rain_1h_mm: 48 }, AT)).toBe('pin-rain-5');
    expect(lastQuarterText(0)).toBe('15 นาทีล่าสุดไม่มีฝน');
    expect(lastQuarterText(1.5)).toBe('15 นาทีล่าสุดยังมีฝน 1.5 มม.');
    expect(lastQuarterText(null)).toBeNull();
  });

  it('says a canal level against the sea without calling it high or low', () => {
    expect(levelWords(0.02)).toBe('สูงกว่าระดับน้ำทะเล 2 ซม.');
    expect(levelWords(-0.12)).toBe('ต่ำกว่าระดับน้ำทะเล 12 ซม.');
    expect(levelWords(1.78)).toBe('สูงกว่าระดับน้ำทะเล 1.78 ม.');
    expect(levelWords(0.004)).toBe('เท่ากับระดับน้ำทะเล');
    expect(levelWords(null)).toBe('ไม่มีค่า');
  });

  it('says whether a canal level rose or fell since the reading before, and never calls it critical', () => {
    // user 2026-10-02: "+0.99 above the sea" alone says neither high nor low
    const station = {
      level_in_m: 0.99,
      observed_at: '2026-10-02T15:45:00+07:00',
      previous_level_in_m: 0.87,
      previous_observed_at: '2026-10-02T12:45:00+07:00',
    };
    expect(levelChangeWords(levelChange(station)!)).toBe(
      '↑ สูงขึ้น 12 ซม. จากค่าวัด 3 ชม.ก่อนหน้า',
    );
    const fell = { previous_level_in_m: 1.04, previous_observed_at: '2026-10-02T15:05:00+07:00' };
    expect(levelChangeWords(levelChange({ ...station, ...fell })!)).toBe(
      '↓ ลดลง 5 ซม. จากค่าวัด 40 นาทีก่อนหน้า',
    );
    expect(levelChangeWords(levelChange({ ...station, previous_level_in_m: 0.985 })!)).toBe(
      'ทรงตัว จากค่าวัด 3 ชม.ก่อนหน้า',
    );
    // no earlier reading, one more than a day older, or no level now: nothing is said
    expect(
      levelChange({ ...station, previous_level_in_m: null, previous_observed_at: null }),
    ).toBeNull();
    expect(
      levelChange({ ...station, previous_observed_at: '2026-10-01T12:45:00+07:00' }),
    ).toBeNull();
    expect(levelChange({ ...station, level_in_m: null })).toBeNull();
    expect(levelSigned(0.99)).toBe('+0.99 ม.รทก.');
    expect(levelSigned(-0.1)).toBe('−0.10 ม.รทก.');
    expect(levelSigned(0.004)).toBe('0.00 ม.รทก.');
    expect(LEVEL_NO_BANK_TH).toContain('ระบบบอกไม่ได้');
  });

  it('gives the time of a reading as a clock time and how long ago', () => {
    expect(measuredText('2026-09-26T16:53:00+07:00', AT)).toBe('วัดเมื่อ 16:53 น. (27 นาทีก่อน)');
    expect(measuredText('2026-09-26T17:20:00+07:00', AT)).toBe('วัดเมื่อ 17:20 น. (เมื่อสักครู่)');
    expect(measuredText('2026-09-25T22:10:00+07:00', AT)).toMatch(
      /^วัดเมื่อ 25 ก\.ย\. 22:10 น\. \(19 ชม\.ก่อน\)$/,
    );
    expect(measuredText(null, AT)).toBe('ไม่มีค่าล่าสุด');
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
    // the Royal Irrigation Department's classes: <=30, >30-50, >50-80, >80-100, >100
    expect(damPin({ ...pasak, percent: 30 })).toBe('pin-dam-critical');
    expect(damPin({ ...pasak, percent: 30.5 })).toBe('pin-dam-low');
    expect(damPin({ ...pasak, percent: 80 })).toBe('pin-dam');
    expect(damPin({ ...pasak, percent: 100 })).toBe('pin-dam-high');
    expect(damWords(62.68)).toBe('น้ำปานกลาง');
    expect(damWords(104)).toBe('เกินความจุเก็บกัก');
    expect(damWords(null)).toBeNull();
    expect(unplaced.location).toBeNull();
    const [bangkok, dry, broken] = weather.stations;
    expect(weatherPin(bangkok)).toBe('pin-wx-3'); // 52.8 mm
    expect(weatherPin(dry)).toBe('pin-wx-0');
    expect(weatherPin(broken)).toBe('pin-wx-none');
    expect(amount(8437.68)).toBe('8,437.68');
    expect(amount(null)).toBe('–');
  });
});

describe('the dams file fetched by the server itself (user, 2026-10-02)', () => {
  const fetched = '2026-10-02T10:00:00+07:00';
  const at = (hours: number) => Date.parse(fetched) + hours * 3_600_000;
  it('is late only after 6 hours, and not real time after a day', () => {
    const automatic = { fetched_at: fetched, automatic: true };
    expect(damsOldNote(automatic, at(3))).toBeNull();
    expect(damsOldNote(automatic, at(7))).toBe('ไม่ได้อัปเดตตามรอบ · ดึงล่าสุด 10:00 น.');
    expect(damsOldNote(automatic, at(25))).toMatch(/^ข้อมูลนี้ไม่ใช่ข้อมูลเรียลไทม์/);
  });
  it('keeps the rule of the Bangkok update run by hand', () => {
    expect(damsOldNote({ fetched_at: fetched }, at(1))).toBe(oldNote(fetched, at(1)));
    expect(damsOldNote({ fetched_at: fetched, automatic: false }, at(1))).toMatch(
      /ไม่ได้อัปเดตอัตโนมัติ$/,
    );
  });
});
