import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canalBounds,
  canalFeatures,
  canalsOld,
  canalsToWatch,
  canalWords,
  factorText,
  flowFeatures,
  gapLines,
  pointLabel,
  flowText,
  sitePin,
  sitePoints,
} from './flows';
import { statusChips, statusCounts } from './StatusBar';
import type { CanalLines, CanalOutlook, RidFlows } from './data';

// the producer's examples from RID's report of 3 Oct, read at 11:00 (contract sections 25–27)
const read = <T>(path: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/v1/examples/${path}`, import.meta.url), 'utf8'),
  ) as T;
const flows = read<RidFlows>('flows/flows.json');
const lines = read<CanalLines>('canals/canals.json');
const outlook = read<CanalOutlook>('canals/outlook.json');
const AT = Date.parse('2026-10-03T11:00:00+07:00');
const site = (id: string) => flows.sites.find((s) => s.id === id)!;
const point = (id: string) => flows.points.find((p) => p.id === id)!;
/** the example with rangsit at warn and hokwa at watch */
const raised: CanalOutlook = {
  ...outlook,
  canals: outlook.canals.map((watch) =>
    watch.id === 'rangsit'
      ? { ...watch, score: 3, level: 'warn' as const }
      : watch.id === 'hokwa'
        ? { ...watch, score: 2, level: 'watch' as const }
        : watch,
  ),
};

describe("RID's daily figures on the map (D35)", () => {
  it("colours a site by the worst of RID's states there, blue for gates alone, grey once old", () => {
    expect(sitePin(flows, site('ayutthaya'), AT)).toBe('pin-flow-flood');
    expect(sitePin(flows, site('samkhok'), AT)).toBe('pin-flow-normal');
    // the barrage's site takes the state of the station below it
    expect(sitePin(flows, site('rama6'), AT)).toBe('pin-flow-critical');
    expect(sitePin(flows, site('raphiphat-split'), AT)).toBe('pin-flow');
    expect(sitePin(flows, site('samkhok'), AT + 3 * 86_400_000)).toBe('pin-flow-old');
    // a station whose state the chart has not given is grey, never blue like a gate or green (Codex M51)
    const unread = {
      ...flows,
      points: flows.points.map((p) => (p.id === 'c35' ? { ...p, state: null } : p)),
    };
    expect(sitePin(unread, site('ayutthaya'), AT)).toBe('pin-flow-unknown');
    // a station RID calls flooded never goes into a bubble
    const severe = flowFeatures(flows, AT).features.filter((f) => f.properties?.severe);
    expect(severe.map((f) => f.properties?.code)).toEqual(['ayutthaya']);
    // the worse the state, the higher the pin; a site of gates alone lowest
    const rank = (code: string) =>
      flowFeatures(flows, AT).features.find((f) => f.properties?.code === code)!.properties?.rank;
    expect([rank('ayutthaya'), rank('rama6'), rank('samkhok'), rank('raphiphat-split')]).toEqual([
      3, 2, 1, 0,
    ]);
    expect(flowFeatures(null, AT).features).toEqual([]);
  });

  it('says each figure in plain words, only what the report gives', () => {
    expect(flowText(point('c2'))).toBe(
      'น้ำไหลผ่าน 2,245 ลบ.ม./วิ · 60% ของที่ลำน้ำรับได้ · ลดจากเมื่อวาน 2,416 · ' +
        'น้ำต่ำกว่าตลิ่ง 2.37 ม. · กรมชลฯ จัดว่าวิกฤต',
    );
    expect(flowText(point('c13'))).toBe(
      'น้ำไหลผ่าน 2,500 ลบ.ม./วิ · 92% ของที่ระบายได้สูงสุด · เท่าเมื่อวาน · กรมชลฯ จัดว่าวิกฤต',
    );
    expect(flowText(point('phranarai'))).toBe('ปิด ไม่มีน้ำเข้าคลองระพีพัฒน์ → ทุ่งรังสิต');
    expect(flowText(point('manorom'))).toBe(
      'ปล่อยน้ำเข้าคลองชัยนาท-ป่าสัก 191 ลบ.ม./วิ · 91% ของที่ปล่อยได้สูงสุด',
    );
    expect(flowText(point('rama6'))).toBe('612 ลบ.ม./วิ · เพิ่มจากเมื่อวาน 546');
    expect(flowText(point('east_intake'))).toBe('246 ลบ.ม./วิ · ลดจากเมื่อวาน 257');
    // no flow in the report: none is made up, the state and the channel's capacity still say something
    expect(flowText(point('c35'))).toBe(
      'รายงาน PDF ไม่มีตัวเลขของจุดนี้ ดูในผังน้ำของกรมชลฯ · ลำน้ำรับได้ 1,159 ลบ.ม./วิ · กรมชลฯ จัดว่าท่วม',
    );
    // a site named after its one station says only the station's code under its name
    expect(pointLabel(point('c35'), site('ayutthaya'))).toBe('สถานี C.35');
    expect(pointLabel(point('c29b'), site('samkhok'))).toBe('สถานี C.29B');
    expect(pointLabel(point('rama6'), site('rama6'))).toBe('น้ำผ่านเขื่อนพระรามหก');
    const { main, gates } = sitePoints(flows, site('chao-phraya-dam'));
    expect(main.map((p) => p.id)).toEqual(['c13']);
    expect(gates).toHaveLength(9);
  });
});

describe('the canals by the trial outlook (D35)', () => {
  it('colours each canal by its level, thin where nothing adds up', () => {
    const plain = canalFeatures(lines, outlook).features;
    expect(plain).toHaveLength(6);
    expect(new Set(plain.map((f) => f.properties?.level))).toEqual(new Set(['none']));
    const shapes = canalFeatures(lines, raised).features;
    const level = (id: string) => shapes.find((f) => f.properties?.id === id)!.properties;
    expect([level('rangsit')?.level, level('rangsit')?.color]).toEqual(['warn', '#d32f2f']);
    expect(level('hokwa')?.level).toBe('watch');
    // no outlook: every canal unknown, never "below the rules" (Codex M50)
    expect(
      canalFeatures(lines, null).features.every((f) => f.properties?.level === 'unknown'),
    ).toBe(true);
    expect(canalFeatures(null, raised).features).toEqual([]);
  });

  it('words the level and the factors, and finds the box of a canal', () => {
    const rangsit = outlook.canals.find((watch) => watch.id === 'rangsit')!;
    expect(canalWords(rangsit)).toBe('ยังไม่ถึงเกณฑ์ · 1 คะแนน');
    expect(factorText(rangsit.factors[0])).toBe(
      '+1 กรมชลฯ รายงานพื้นที่ประสบอุทกภัยใน อ.เมืองปทุมธานี อ.ธัญบุรี',
    );
    // a factor only noted has no points before it
    expect(factorText(rangsit.factors[1])).toBe(
      'ปตร.พระศรีศิลป์ ปล่อยน้ำเข้าคลองระพีพัฒน์แยกตก 18 ลบ.ม./วิ',
    );
    expect(canalsToWatch(outlook)).toEqual([]);
    expect(canalsToWatch(raised).map((watch) => [watch.id, canalWords(watch)])).toEqual([
      ['rangsit', 'ต้องระวัง · 3 คะแนน'],
      ['hokwa', 'เฝ้าดู · 2 คะแนน'],
    ]);
    const [[west, south], [east, north]] = canalBounds(lines, 'rangsit')!;
    expect(west < east && south < north).toBe(true);
    expect(canalBounds(lines, 'nowhere')).toBeNull();
    expect(canalsOld(outlook, AT)).toBe(false);
    expect(canalsOld(outlook, AT + 3 * 3_600_000)).toBe(true);
  });

  it('says a canal without its data is not assessed, with what is missing and why (M50)', () => {
    const blind = {
      ...outlook.canals.find((watch) => watch.id === 'hokwa')!,
      score: 0,
      level: null,
      factors: [],
      assessed: false,
      gaps: [
        { kind: 'inflow' as const, text_th: 'รายงานกรมชลประทาน ไม่มีในรอบนี้' },
        { kind: 'flooding' as const, text_th: 'รายงานกรมชลประทาน ไม่มีในรอบนี้' },
        { kind: 'rain' as const, text_th: 'พยากรณ์ฝน เก่าเกินเกณฑ์ (ข้อมูล 26/09 11:50 น.)' },
      ],
    };
    expect(canalWords(blind)).toBe('ข้อมูลไม่พอประเมิน');
    expect(gapLines(blind)).toEqual([
      'น้ำเข้า รายงานน้ำท่วม: รายงานกรมชลประทาน ไม่มีในรอบนี้',
      'ฝน: พยากรณ์ฝน เก่าเกินเกณฑ์ (ข้อมูล 26/09 11:50 น.)',
    ]);
    const shapes = canalFeatures(lines, {
      ...outlook,
      canals: outlook.canals.map((watch) => (watch.id === 'hokwa' ? blind : watch)),
    });
    const hokwa = shapes.features.find((f) => f.properties?.id === 'hokwa')!.properties;
    expect([hokwa?.level, hokwa?.color]).toEqual(['unknown', '#90a4ae']);
    // a file from before the field: assessed
    const { assessed: _, gaps: __, ...older } = outlook.canals[0];
    expect(canalWords(older)).toBe('ยังไม่ถึงเกณฑ์ · 1 คะแนน');
    expect(gapLines(older)).toEqual([]);
  });

  it('puts the canals at watch or warn in the status bar, red with one at warn', () => {
    const base = {
      summary: null,
      floods: null,
      dams: null,
      alerts: [],
      trusted: true,
      worst: null,
    };
    const counts = statusCounts({ ...base, canals: raised, now: AT });
    expect([counts.canalsWarn, counts.canalsWatch]).toEqual([1, 1]);
    const chip = statusChips(counts).find((item) => item.key === 'canals')!;
    expect([chip.text, chip.tone, chip.target]).toEqual(['คลองอาจล้น 2 สาย', 'danger', 'canals']);
    const quiet = statusCounts({ ...base, canals: outlook, now: AT });
    expect(statusChips(quiet).some((item) => item.key === 'canals')).toBe(false);
  });
});
