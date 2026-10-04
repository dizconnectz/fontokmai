import type { FeatureCollection, MultiLineString } from 'geojson';
import type { RiverForecast } from '../../../contracts/v1/ts/forecast_rivers';
import type { RiverLines } from '../../../contracts/v1/ts/river_lines';

// The GloFAS river trend (contract section 20). The model's discharge can be far from what is measured on the
// river, so the site never shows its m³/s: only whether the next 7 days are forecast above or below today.
export type { RiverForecast };
export type RiverPoint = RiverForecast['points'][number];
export type Trend = 'rising_fast' | 'rising' | 'steady' | 'falling';

/** The site's own words for the trend (not an agency's classes); `glyph` is the arrow drawn in the pin. */
export const RIVER_CLASSES: {
  trend: Trend;
  pin: string;
  label: string;
  color: string;
  glyph: 'river' | 'river-flat' | 'river-down';
}[] = [
  {
    trend: 'rising_fast',
    pin: 'pin-river-up2',
    label: 'เพิ่มขึ้นมาก',
    color: '#e53935',
    glyph: 'river',
  },
  { trend: 'rising', pin: 'pin-river-up', label: 'เพิ่มขึ้น', color: '#fb8c00', glyph: 'river' },
  { trend: 'steady', pin: 'pin-river', label: 'ทรงตัว', color: '#1e88e5', glyph: 'river-flat' },
  { trend: 'falling', pin: 'pin-river-down', label: 'ลดลง', color: '#43a047', glyph: 'river-down' },
];
export const RIVER_UNKNOWN_COLOR = '#90a4ae';
/** The file is rebuilt once a day; older than this it is labelled as not updated. */
export const RIVERS_STALE_MS = 36 * 3_600_000;
/** +30 % or more ahead is "rising a lot", +10 % "rising", −10 % or less "falling" (contract section 20). */
const FAST = 0.3;
const RISE = 0.1;
const FALL = -0.1;
const AHEAD_DAYS = 7;
/** so that 100 → 90 is −10 % (falling) rather than −9.999… % after floating point (M19) */
const EDGE = 1e-9;

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
/** The day in Thailand that the trends are read from: what is worked out from them changes with it, not the clock. */
export const riverDay = (now: number): string => DAY.format(now);
const SHORT_DAY = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
});

export interface RiverOutlook {
  trend: Trend;
  /** the largest change over the next 7 days against today, e.g. 0.24 for +24 % */
  change: number;
  /** the Thai date (YYYY-MM-DD) of that largest change */
  day: string;
  /** index of today in `days` */
  today: number;
}

/** The trend of the next 7 days against today, from the ensemble median; null without enough values. */
export function riverOutlook(
  file: RiverForecast,
  point: RiverPoint,
  now: number,
): RiverOutlook | null {
  const today = file.days.indexOf(DAY.format(now));
  const base = today >= 0 ? (point.median[today] ?? point.discharge[today]) : null;
  if (base === null || base <= 0) return null;
  const window = point.median.slice(today + 1, today + 1 + AHEAD_DAYS);
  // a trend of the next 7 days needs all 7 of them: a missing day or the end of the file cannot be told (M18)
  if (window.length < AHEAD_DAYS || window.some((value) => value === null)) return null;
  const ahead = window.map((value, i) => ({
    value: value as number,
    day: file.days[today + 1 + i],
  }));
  const peak = ahead.reduce((best, next) => (next.value > best.value ? next : best));
  const low = ahead.reduce((best, next) => (next.value < best.value ? next : best));
  const up = peak.value / base - 1;
  const down = low.value / base - 1;
  const trend: Trend =
    up >= FAST - EDGE
      ? 'rising_fast'
      : up >= RISE - EDGE
        ? 'rising'
        : down <= FALL + EDGE
          ? 'falling'
          : 'steady';
  return trend === 'falling'
    ? { trend, change: down, day: low.day, today }
    : { trend, change: up, day: peak.day, today };
}

export type RiverStretches = FeatureCollection<
  MultiLineString,
  { code: string; trend: Trend; color: string; rising: boolean }
>;
/**
 * The stretches of river where the water is forecast to rise in the next 7 days, coloured as the pins (user
 * 2026-10-02: rivers orange or red where the water will rise). A steady or falling river is not coloured at all
 * (user 2026-10-04: "แม่น้ำที่ปกติดี ไม่ต้องแสดงสีใดๆ แสดงแค่ที่ไม่ปกติ"); its pin still says its trend.
 */
export function riverStretches(
  lines: RiverLines,
  file: RiverForecast,
  now: number,
): RiverStretches {
  const points = new Map(file.points.map((point) => [point.id, point]));
  return {
    type: 'FeatureCollection',
    features: lines.stretches.flatMap((stretch) => {
      const point = points.get(stretch.point_id);
      const trend = point ? riverOutlook(file, point, now)?.trend : undefined;
      if (trend !== 'rising' && trend !== 'rising_fast') return [];
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'MultiLineString' as const, coordinates: stretch.line.coordinates },
          properties: {
            code: stretch.point_id,
            trend,
            color: RIVER_CLASSES.find((item) => item.trend === trend)!.color,
            rising: trend === 'rising' || trend === 'rising_fast',
          },
        },
      ];
    }),
  };
}

const STRENGTH: Record<Trend, number> = { rising_fast: 3, rising: 2, steady: 1, falling: 0 };
export interface RiverRow {
  river: string;
  /** the strongest trend of its points; null when none can be told */
  trend: Trend | null;
  /** its points forecast to rise, the strongest first */
  rising: { point: RiverPoint; outlook: RiverOutlook }[];
  points: number;
}
/**
 * The rivers in one list for the card (user 2026-10-02): those forecast to rise first, the strongest point of each
 * named with its words; the others say steady or falling.
 */
export function riverSummary(file: RiverForecast, now: number): RiverRow[] {
  const rows = new Map<string, RiverRow>();
  for (const point of file.points) {
    const row = rows.get(point.river_th) ?? {
      river: point.river_th,
      trend: null,
      rising: [],
      points: 0,
    };
    const outlook = riverOutlook(file, point, now);
    row.points += 1;
    if (outlook && (row.trend === null || STRENGTH[outlook.trend] > STRENGTH[row.trend]))
      row.trend = outlook.trend;
    if (outlook && (outlook.trend === 'rising' || outlook.trend === 'rising_fast'))
      row.rising.push({ point, outlook });
    rows.set(point.river_th, row);
  }
  for (const row of rows.values()) row.rising.sort((a, b) => b.outlook.change - a.outlook.change);
  return [...rows.values()].sort(
    (a, b) =>
      (b.trend ? STRENGTH[b.trend] : -1) - (a.trend ? STRENGTH[a.trend] : -1) ||
      a.river.localeCompare(b.river, 'th'),
  );
}

/** Pin picture of a river point by its trend; grey when the trend cannot be told. */
export function riverPin(file: RiverForecast, point: RiverPoint, now: number): string {
  const outlook = riverOutlook(file, point, now);
  return outlook
    ? RIVER_CLASSES.find((item) => item.trend === outlook.trend)!.pin
    : 'pin-river-unknown';
}

const percent = (change: number) =>
  `${change > 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%`;

/** "น้ำเพิ่มขึ้น สูงสุดราว +24% วันที่ 30 ก.ย." in plain words, for the popup and the list */
export function riverWords(outlook: RiverOutlook | null): string {
  if (!outlook) return 'ยังบอกแนวโน้มไม่ได้';
  const day = SHORT_DAY.format(Date.parse(`${outlook.day}T12:00:00+07:00`));
  switch (outlook.trend) {
    case 'rising_fast':
      return `น้ำเพิ่มขึ้นมาก สูงสุดราว ${percent(outlook.change)} วันที่ ${day}`;
    case 'rising':
      return `น้ำเพิ่มขึ้น สูงสุดราว ${percent(outlook.change)} วันที่ ${day}`;
    case 'falling':
      return `น้ำลดลง ต่ำสุดราว ${percent(outlook.change)} วันที่ ${day}`;
    default:
      return 'น้ำทรงตัว เปลี่ยนไม่เกิน 10%';
  }
}

export interface RiverChart {
  /** the model's run for the past days up to today */
  past: string;
  /** the ensemble median from today on */
  ahead: string;
  /** the band between the 25th and 75th percentile from today on */
  band: string;
  todayX: number;
}

/** SVG paths of a small chart without a scale: the shape of the flow, never its number. */
export function riverChart(
  file: RiverForecast,
  point: RiverPoint,
  today: number,
  width: number,
  height: number,
): RiverChart {
  const values = [...point.discharge, ...point.median, ...point.p25, ...point.p75].filter(
    (value): value is number => value !== null,
  );
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const span = top - bottom || 1;
  const last = Math.max(file.days.length - 1, 1);
  const x = (i: number) => Math.round((i / last) * width * 10) / 10;
  const y = (value: number) =>
    Math.round((height - 2 - ((value - bottom) / span) * (height - 4)) * 10) / 10;
  const line = (series: (number | null)[], from: number, to: number) => {
    let path = '';
    let pen = false;
    for (let i = from; i <= to; i++) {
      const value = series[i];
      if (value === null || value === undefined) {
        pen = false;
        continue;
      }
      path += `${pen ? 'L' : 'M'}${x(i)} ${y(value)}`;
      pen = true;
    }
    return path;
  };
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = today; i < file.days.length; i++) {
    const high = point.p75[i];
    const low = point.p25[i];
    if (high === null || low === null) continue;
    upper.push(`${x(i)} ${y(high)}`);
    lower.unshift(`${x(i)} ${y(low)}`);
  }
  return {
    past: line(point.discharge, 0, today),
    ahead: line(point.median, today, file.days.length - 1),
    band: upper.length > 1 ? `M${[...upper, ...lower].join('L')}Z` : '',
    todayX: x(today),
  };
}
