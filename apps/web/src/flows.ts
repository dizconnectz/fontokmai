// RID's daily figures of the Chao Phraya's stations, barrages and gates (water/flows.json, contract section 25,
// D35) and the canals of the Rangsit pilot they may fill (ref/canals.json, summary/canals.json, sections 26–27).
// The figures and the coloured states are RID's own; which canal may overflow is this site's trial rule, apart.

import type { FeatureCollection, MultiLineString, Point } from 'geojson';
import type { CanalLines, CanalOutlook, RidFlows } from './data';

export type FlowPoint = RidFlows['points'][number];
export type FlowSite = RidFlows['sites'][number];
export type CanalWatch = CanalOutlook['canals'][number];
export type CanalFactor = CanalWatch['factors'][number];
type State = NonNullable<FlowPoint['state']>;

/** The report is of 06:00 every day, posted about 10:30: two days on, its figures are labelled old and go grey. */
export const FLOWS_STALE_MS = 2 * 24 * 3_600_000;
/** The canal outlook is rebuilt every round (15 minutes); older than this it says so. */
export const CANALS_STALE_MS = 2 * 3_600_000;

/** RID's states of its stations (the dots of its chart), the worst first, in the map's colours */
export const FLOW_CLASSES: { state: State; pin: string; label: string; color: string }[] = [
  { state: 'flood', pin: 'pin-flow-flood', label: 'ท่วม', color: '#e53935' },
  { state: 'critical', pin: 'pin-flow-critical', label: 'วิกฤต', color: '#fb8c00' },
  { state: 'normal', pin: 'pin-flow-normal', label: 'ปกติ', color: '#43a047' },
];
/** a gate or barrage with figures and no station of RID's there */
export const FLOW_PLAIN = { pin: 'pin-flow', label: 'ประตูน้ำ', color: '#1e88e5' };
/** a station whose state RID's chart has not given (yet): never shown as normal (Codex M51) */
export const FLOW_UNKNOWN = { pin: 'pin-flow-unknown', label: 'ยังไม่ทราบสถานะ', color: '#90a4ae' };
export const FLOW_OLD = { pin: 'pin-flow-old', label: 'รายงานเก่า', color: '#90a4ae' };

export function flowsOld(file: RidFlows, now: number): boolean {
  return now - Date.parse(file.observed_at) > FLOWS_STALE_MS;
}

const STRENGTH: Record<State, number> = { flood: 2, critical: 1, normal: 0 };

/** The worst of RID's states among a site's points; null when RID gives none there. */
export function siteState(file: RidFlows, site: FlowSite): State | null {
  let worst: State | null = null;
  for (const id of site.points) {
    const state = file.points.find((point) => point.id === id)?.state;
    if (state && (worst === null || STRENGTH[state] > STRENGTH[worst])) worst = state;
  }
  return worst;
}

/**
 * The picture of a site's pin: RID's worst state there; grey for a station whose state is not known and once the
 * report is old; blue for gates alone, which have no state of RID's.
 */
export function sitePin(file: RidFlows, site: FlowSite, now: number): string {
  if (flowsOld(file, now)) return FLOW_OLD.pin;
  const state = siteState(file, site);
  if (state) return FLOW_CLASSES.find((item) => item.state === state)!.pin;
  const station = site.points.some(
    (id) => file.points.find((point) => point.id === id)?.kind === 'station',
  );
  return station ? FLOW_UNKNOWN.pin : FLOW_PLAIN.pin;
}

/** The sites as map points; a site whose station RID calls flooded never goes into a bubble. */
export function flowFeatures(file: RidFlows | null, now: number): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: (file?.sites ?? []).map((site) => {
      const pin = sitePin(file!, site, now);
      // the worse RID's state, the higher the pin is drawn; gates alone and an old report lowest
      const at = FLOW_CLASSES.findIndex((item) => item.pin === pin);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: site.location },
        properties: {
          code: site.id,
          pin,
          severe: pin === FLOW_CLASSES[0].pin,
          rank: at < 0 ? 0 : FLOW_CLASSES.length - at,
        },
      };
    }),
  };
}

const NUMBER = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
/** "2,245 ลบ.ม./วิ" */
export const cms = (value: number) => `${NUMBER.format(value)} ลบ.ม./วิ`;

function change(point: FlowPoint): string | null {
  const before = point.yesterday_cms;
  if (before === null || before === undefined || point.flow_cms === null) return null;
  if (before === point.flow_cms) return 'เท่าเมื่อวาน';
  return `${point.flow_cms > before ? 'เพิ่ม' : 'ลด'}จากเมื่อวาน ${NUMBER.format(before)}`;
}

function share(point: FlowPoint): string | null {
  if (point.flow_cms === null || !point.capacity_cms) return null;
  const percent = Math.round((100 * point.flow_cms) / point.capacity_cms);
  return point.capacity_kind === 'channel'
    ? `${percent}% ของที่ลำน้ำรับได้`
    : `${percent}% ของที่${point.kind === 'gate' ? 'ปล่อย' : 'ระบาย'}ได้สูงสุด`;
}

/** RID's own word for the state of a station, said as RID's */
export function stateWords(state: FlowPoint['state']): string | null {
  const found = FLOW_CLASSES.find((item) => item.state === state);
  return found ? `กรมชลฯ จัดว่า${found.label}` : null;
}

/**
 * One point of a site in plain words (user 2026-10-03: say plainly whether it is high): what flows, against what the
 * channel or the gate takes, against yesterday, how far below the bank, and RID's state. Only what the report gives.
 */
export function flowText(point: FlowPoint): string {
  const parts: string[] = [];
  if (point.flow_cms === null) {
    // the daily PDF prints no figure for some stations (C.35): RID's chart of the day draws it, linked in the popup
    parts.push('รายงาน PDF ไม่มีตัวเลขของจุดนี้ ดูในผังน้ำของกรมชลฯ');
    if (point.capacity_cms && point.capacity_kind === 'channel')
      parts.push(`ลำน้ำรับได้ ${cms(point.capacity_cms)}`);
  } else if (point.kind === 'gate' && point.flow_cms <= 0) {
    parts.push(point.into_th ? `ปิด ไม่มีน้ำเข้า${point.into_th}` : 'ปิด');
  } else {
    const verb =
      point.kind === 'gate'
        ? `ปล่อยน้ำ${point.into_th ? `เข้า${point.into_th}` : ''}`
        : point.kind === 'station'
          ? 'น้ำไหลผ่าน'
          : ''; // a barrage's or an intake's name says what the figure is
    parts.push(verb ? `${verb} ${cms(point.flow_cms)}` : cms(point.flow_cms));
    const of = share(point);
    if (of) parts.push(of);
    const since = change(point);
    if (since) parts.push(since);
    // the report had no figure: this one is the backup from RID's hydrology centre, with its own time
    if (point.flow_backup_at)
      parts.push(
        `ตัวเลขสำรองจากศูนย์อุทกวิทยาฯ ${BACKUP_TIME.format(new Date(point.flow_backup_at))} น.`,
      );
  }
  if (point.below_bank_m !== null && point.below_bank_m !== undefined)
    parts.push(
      point.below_bank_m >= 0
        ? `น้ำต่ำกว่าตลิ่ง ${point.below_bank_m.toFixed(2)} ม.`
        : `น้ำสูงกว่าตลิ่ง ${(-point.below_bank_m).toFixed(2)} ม.`,
    );
  const state = stateWords(point.state);
  if (state) parts.push(state);
  return parts.join(' · ');
}

const BACKUP_TIME = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "ท้ายเขื่อนเจ้าพระยา (C.13)": a point's name with its station code when it has one */
export function pointName(point: FlowPoint): string {
  return point.code ? `${point.name_th} (${point.code})` : point.name_th;
}

/** A point's name in its site's popup: only its station code when the site is named after it (no name twice) */
export function pointLabel(point: FlowPoint, site: FlowSite): string {
  if (site.name_th.startsWith(point.name_th)) return point.code ? `สถานี ${point.code}` : '';
  return pointName(point);
}

/** The points of a site, in its order: the river and the barrage first, the gates after them. */
export function sitePoints(
  file: RidFlows,
  site: FlowSite,
): { main: FlowPoint[]; gates: FlowPoint[] } {
  const points = site.points.flatMap((id) => file.points.filter((point) => point.id === id));
  return {
    main: points.filter((point) => point.kind === 'station' || point.kind === 'barrage'),
    gates: points.filter((point) => point.kind === 'gate' || point.kind === 'intake'),
  };
}

export type CanalLevel = 'warn' | 'watch' | 'none' | 'unknown';
export const CANAL_CLASSES: { level: CanalLevel; label: string; color: string }[] = [
  { level: 'warn', label: 'ต้องระวัง', color: '#d32f2f' },
  { level: 'watch', label: 'เฝ้าดู', color: '#ef6c00' },
  { level: 'none', label: 'ยังไม่ถึงเกณฑ์', color: '#4f83b5' },
  // drawn dashed: not a low score, no score at all (Codex M50)
  { level: 'unknown', label: 'ข้อมูลไม่พอประเมิน', color: '#90a4ae' },
];

/** A canal the outlook could not assess, or does not list, is "unknown", never "below the rules" (M50). */
export function canalLevel(watch: CanalWatch | undefined): CanalLevel {
  if (!watch || watch.assessed === false) return 'unknown';
  return watch.level ?? 'none';
}

/** "ต้องระวัง · 3 คะแนน" for a canal of the outlook; "ข้อมูลไม่พอประเมิน" without a score */
export function canalWords(watch: CanalWatch): string {
  const level = canalLevel(watch);
  const label = CANAL_CLASSES.find((item) => item.level === level)!.label;
  return level === 'unknown' ? label : `${label} · ${watch.score} คะแนน`;
}

const KIND_TH: Record<CanalFactor['kind'], string> = {
  inflow: 'น้ำเข้า',
  rain: 'ฝน',
  drainage: 'การระบาย',
  level: 'ระดับน้ำ',
  pumps: 'เครื่องสูบน้ำ',
  flooding: 'รายงานน้ำท่วม',
};
/** "ฝน: พยากรณ์ฝน เก่าเกินเกณฑ์ (…)", the factors that could not be judged, those of one reason together */
export function gapLines(watch: CanalWatch): string[] {
  const byText = new Map<string, string[]>();
  for (const gap of watch.gaps ?? [])
    byText.set(gap.text_th, [...(byText.get(gap.text_th) ?? []), KIND_TH[gap.kind]]);
  return [...byText].map(([text, kinds]) => `${kinds.join(' ')}: ${text}`);
}

export function canalsOld(outlook: CanalOutlook, now: number): boolean {
  return now - Date.parse(outlook.generated_at) > CANALS_STALE_MS;
}

export type CanalShapes = FeatureCollection<MultiLineString>;

/** The canals as map lines, coloured by the outlook; one it could not assess or does not list is unknown. */
export function canalFeatures(lines: CanalLines | null, outlook: CanalOutlook | null): CanalShapes {
  return {
    type: 'FeatureCollection',
    features: (lines?.canals ?? []).map((canal) => {
      const level = canalLevel(outlook?.canals.find((watch) => watch.id === canal.id));
      return {
        type: 'Feature' as const,
        geometry: { type: 'MultiLineString' as const, coordinates: canal.line.coordinates },
        properties: {
          id: canal.id,
          name: canal.name_th,
          level,
          color: CANAL_CLASSES.find((item) => item.level === level)!.color,
          rank: CANAL_CLASSES.length - CANAL_CLASSES.findIndex((item) => item.level === level),
        },
      };
    }),
  };
}

/** The box around a canal's line, a little wider, or null without it */
export function canalBounds(
  lines: CanalLines | null,
  id: string,
): [[number, number], [number, number]] | null {
  const canal = lines?.canals.find((item) => item.id === id);
  const points = canal?.line.coordinates.flat() ?? [];
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [
    [Math.min(...xs) - 0.02, Math.min(...ys) - 0.02],
    [Math.max(...xs) + 0.02, Math.max(...ys) + 0.02],
  ];
}

/** The canals at watch or warn, the highest score first (the file's order) */
export function canalsToWatch(outlook: CanalOutlook | null): CanalWatch[] {
  return (outlook?.canals ?? []).filter((watch) => watch.level);
}

/** "+2 " before a factor that counts, nothing before one only noted */
export function factorText(factor: CanalFactor): string {
  return factor.points > 0 ? `+${factor.points} ${factor.text_th}` : factor.text_th;
}
