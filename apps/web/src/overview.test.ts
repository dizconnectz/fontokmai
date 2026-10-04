import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  changeSince,
  dayWord,
  groupByProvince,
  liveItems,
  officialFor,
  officialLine,
  oldInputs,
  outlineBounds,
  placeParts,
  REASON_TONE,
  reasonLine,
  shownItems,
  watchAreas,
  watchShapes,
  type Overview,
} from './overview';
import type { Alert, Boundaries } from './data';

// the producer's example: the other examples summed up at 17:30 on 26 Sep (contract section 21)
const overview = JSON.parse(
  readFileSync(
    new URL('../../../contracts/v1/examples/overview/overview.json', import.meta.url),
    'utf8',
  ),
) as Overview;
const AT = Date.parse('2026-09-26T17:30:00+07:00');
// the producer's outlines cut to the pilot area: Bangkok, Samut Prakan, Nonthaburi and Pathum Thani
const boundaries = JSON.parse(
  readFileSync(
    new URL('../../../contracts/v1/examples/boundaries/boundaries.json', import.meta.url),
    'utf8',
  ),
) as Boundaries;
const DAY = 86_400_000;

describe('the summary of places to watch', () => {
  it('says the day of a forecast from the reader’s clock, and drops a day that has passed', () => {
    expect(dayWord('2026-09-26', AT)).toBe('วันนี้');
    expect(dayWord('2026-09-27', AT)).toBe('พรุ่งนี้');
    expect(dayWord('2026-09-28', AT)).toBe('อีก 2 วัน (วันจันทร์)');
    const forecast = {
      kind: 'rain_forecast',
      text_th: 'ฝนหนักบางพื้นที่ สูงสุดราว 50 มม.',
      day: '2026-09-27',
    };
    expect(reasonLine(forecast as never, AT)).toBe('พรุ่งนี้: ฝนหนักบางพื้นที่ สูงสุดราว 50 มม.');
    expect(reasonLine(forecast as never, AT + 2 * DAY)).toBeNull();
    const three = { kind: 'rain_3days', text_th: 'ฝนสะสม 3 วันราว 160 มม.', day: '2026-09-26' };
    expect(reasonLine(three as never, AT)).toBe('ฝนสะสม 3 วันราว 160 มม.');
  });

  it('lists what is happening first and what to prepare for apart', () => {
    const now = liveItems(overview, 'now', AT);
    expect(now.map((item) => item.place_th)).toEqual([
      'เขตจตุจักร กรุงเทพมหานคร',
      'เขตห้วยขวาง กรุงเทพมหานคร',
    ]);
    expect(now[1].reasons.map((reason) => reasonLine(reason, AT))).toEqual([
      'มีรายงานน้ำท่วม 2 จุด',
      'พรุ่งนี้: ฝนหนักเกือบทั่ว กทม. สูงสุดราว 50 มม.',
    ]);
    const next = liveItems(overview, 'next', AT);
    expect(next[0].place_th).toBe('จ.สมุทรปราการ');
    // two days later every forecast of the example has passed, and the rules never keep them
    expect(liveItems(overview, 'next', AT + 5 * DAY)).toEqual([]);
    // the example has no satellite file (GISTDA, added 2026-10-04): missing is said, never read as no flood
    expect(oldInputs(overview)).toEqual([
      'น้ำท่วมจากภาพดาวเทียม (GISTDA)',
      'แนวโน้มแม่น้ำ (GloFAS)',
    ]);
  });

  it('drops what was happening once it is over, even while the file is fresh (Codex M27)', () => {
    const [cluster] = liveItems(overview, 'now', AT).filter((item) =>
      item.reasons.some((reason) => reason.kind === 'flood_reports'),
    );
    const reports = cluster.reasons.find((reason) => reason.kind === 'flood_reports')!;
    expect(reports.until).toBeTruthy();
    const over = Date.parse(reports.until!) + 60_000;
    expect(reasonLine(reports, over)).toBeNull();
    // a file without `until`: a flood report holds 12 hours from the latest start (D33)
    const old = {
      ...reports,
      until: null,
      at: new Date(AT - 12 * 3_600_000 - 60_000).toISOString(),
    };
    expect(reasonLine(old, AT)).toBeNull();
    // a forecast taken along does not keep a place on the list of now by itself
    const alone = {
      ...cluster,
      reasons: cluster.reasons.map((r) => ({
        ...r,
        until: null,
        at: old.at,
      })) as typeof cluster.reasons,
    };
    const onlyForecast = { ...overview, items: [alone] };
    expect(liveItems(onlyForecast, 'now', AT)).toEqual([]);
  });

  it('points to official alerts of the same province without copying them', () => {
    const alert = (code: string, severity: string, effective: number): Alert =>
      ({
        event_id: `tmd:${code}`,
        severity,
        lifecycle_status: 'active',
        effective: new Date(effective).toISOString(),
        expires: new Date(AT + DAY).toISOString(),
        targets: [{ kind: 'province', code }],
      }) as unknown as Alert;
    const bangkok = liveItems(overview, 'now', AT)[0];
    expect(officialFor(bangkok, [alert('TH-10', 'Severe', AT - 3_600_000)], AT)).toEqual({
      level: 'severe',
      pending: false,
    });
    expect(officialFor(bangkok, [alert('TH-10', 'Extreme', AT + 3_600_000)], AT)).toEqual({
      level: 'extreme',
      pending: true,
    });
    expect(officialFor(bangkok, [alert('TH-50', 'Severe', AT)], AT)).toBeNull();
    expect(officialLine([alert('TH-10', 'Severe', AT), alert('TH-13', 'Moderate', AT)])).toBe(
      'มีประกาศเตือนภัยของกรมอุตุฯ 2 ฉบับ ครอบคลุม 2 จังหวัด (ดูด้านล่าง)',
    );
    expect(officialLine([])).toBeNull();
  });
});

describe('the places to watch now go by province (user, 2026-10-01)', () => {
  it('splits a place into its district and its province', () => {
    expect(placeParts('อ.ทับปุด จ.พังงา')).toEqual(['อ.ทับปุด', 'จ.พังงา']);
    expect(placeParts('เขตจตุจักร กรุงเทพมหานคร')).toEqual(['เขตจตุจักร', 'กรุงเทพมหานคร']);
    expect(placeParts('จ.สระบุรี')).toEqual(['จ.สระบุรี', 'จ.สระบุรี']);
  });

  it('keeps the summary order: the province of the strongest place first, its districts in order', () => {
    const item = overview.items[0];
    const places = [
      'อ.ปลายพระยา จ.กระบี่',
      'อ.ทับปุด จ.พังงา',
      'อ.เขาพนม จ.กระบี่',
      'อ.ตะกั่วป่า จ.พังงา',
    ];
    const groups = groupByProvince(places.map((place_th) => ({ ...item, place_th })));
    expect(
      groups.map((group) => [group.province, group.items.map((i) => placeParts(i.place_th)[0])]),
    ).toEqual([
      ['จ.กระบี่', ['อ.ปลายพระยา', 'อ.เขาพนม']],
      ['จ.พังงา', ['อ.ทับปุด', 'อ.ตะกั่วป่า']],
    ]);
  });
});

describe('the summary’s places outlined on the map (user, 2026-10-01)', () => {
  it('outlines the districts to watch now and the provinces to prepare for, as the lists show them', () => {
    expect(watchAreas(overview, AT).map((area) => `${area.when}:${area.code}`)).toEqual([
      'now:1030',
      'now:1017',
      'next:11',
      'next:19',
      'next:12',
      'next:13',
      'next:14',
      'next:74',
    ]);
    // the flood reports of Huai Khwang held until 18:19: after that it is off the list, and off the map
    expect(watchAreas(overview, AT + 3_600_000).filter((area) => area.when === 'now')).toEqual([
      { code: '1030', when: 'now', place: 'เขตจตุจักร กรุงเทพมหานคร' },
    ]);
  });

  it('outlines nothing from a file too old to list, nor an item without an area', () => {
    const tooOld = Date.parse(overview.generated_at) + 3 * 3_600_000 + 60_000;
    expect(shownItems(overview, 'now', tooOld)).toEqual([]);
    expect(watchAreas(overview, tooOld)).toEqual([]);
    expect(watchAreas(null, AT)).toEqual([]);
    // a river point or a dam has no area; a file made before area_code has none at all
    const river = {
      ...overview.items[2],
      place_th: 'แม่น้ำบางปะกง ที่ฉะเชิงเทรา',
      area_code: null,
    };
    const before = overview.items.map((item) => {
      const copy = { ...item };
      delete copy.area_code;
      return copy;
    });
    expect(watchAreas({ ...overview, items: [river] }, AT)).toEqual([]);
    expect(watchAreas({ ...overview, items: before }, AT)).toEqual([]);
  });

  it('draws the outlines the file has, and nothing before it loads', () => {
    const areas = watchAreas(overview, AT);
    const shapes = watchShapes(areas, boundaries);
    // Saraburi, Ayutthaya and Samut Sakhon are outside the cut file: left out, the others drawn
    expect(shapes.features.map((feature) => feature.properties.code)).toEqual([
      '1030',
      '1017',
      '11',
      '12',
      '13',
    ]);
    expect(shapes.features[0].geometry.type).toBe('MultiPolygon');
    expect(shapes.features[0].properties).toEqual(areas[0]);
    expect(watchShapes(areas, null).features).toEqual([]);
  });

  it('fits the map to whole outlines, or says it cannot', () => {
    const [[west, south], [east, north]] = outlineBounds(['1030', '1017'], boundaries)!;
    // Chatuchak and Huai Khwang, north of the centre of Bangkok
    expect(west).toBeGreaterThan(100.5);
    expect(east).toBeLessThan(100.65);
    expect(south).toBeGreaterThan(13.74);
    expect(north).toBeLessThan(13.88);
    expect(outlineBounds(['1030', '1999'], boundaries)).toBeNull();
    expect(outlineBounds(['1030'], null)).toBeNull();
  });
});

describe('what changed since about an hour before (user, 2026-10-01)', () => {
  it('says the new places and how many passed, from the lists the producer kept', () => {
    // nothing kept: nothing said
    expect(changeSince(overview, 'now', AT)).toBeNull();
    const earlier = {
      generated_at: '2026-09-26T16:33:00+07:00',
      now: ['เขตจตุจักร กรุงเทพมหานคร', 'อ.ธัญบุรี จ.ปทุมธานี', 'อ.คลองหลวง จ.ปทุมธานี'],
      next: ['จ.สมุทรปราการ'],
    };
    const file = { ...overview, earlier };
    expect(changeSince(file, 'now', AT)).toEqual({
      at: '2026-09-26T16:33:00+07:00',
      added: ['เขตห้วยขวาง กรุงเทพมหานคร'],
      passed: 2,
      delta: -1,
    });
    expect(changeSince(file, 'next', AT)?.added).toHaveLength(5);
    expect(changeSince(file, 'next', AT)?.delta).toBe(5);
    // the flood reports of Huai Khwang held until 18:19: once they pass, it is not counted as new
    expect(changeSince(file, 'now', AT + 3_600_000)).toMatchObject({ added: [], passed: 2 });
    // a file too old to list says nothing about change either
    expect(changeSince(file, 'now', Date.parse(overview.generated_at) + 4 * 3_600_000)).toBeNull();
  });
});

describe('the reasons to prepare for that stand out (user, 2026-10-02)', () => {
  it('colours a release up a lot red, a dam over its storage and a river rising a lot orange', () => {
    expect(REASON_TONE.dam_release_up).toBe('danger');
    expect(REASON_TONE.dam_full).toBe('warn');
    expect(REASON_TONE.river_rising).toBe('warn');
    // a forecast keeps its plain words
    expect(REASON_TONE.rain_forecast).toBeUndefined();
  });
});
