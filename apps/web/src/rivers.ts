import type { RiverForecast } from '../../../contracts/v1/ts/forecast_rivers';

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

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
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
  const ahead = point.median
    .slice(today + 1, today + 1 + AHEAD_DAYS)
    .flatMap((value, i) => (value === null ? [] : [{ value, day: file.days[today + 1 + i] }]));
  if (!ahead.length) return null;
  const peak = ahead.reduce((best, next) => (next.value > best.value ? next : best));
  const low = ahead.reduce((best, next) => (next.value < best.value ? next : best));
  const up = peak.value / base - 1;
  const down = low.value / base - 1;
  const trend: Trend =
    up >= FAST ? 'rising_fast' : up >= RISE ? 'rising' : down <= FALL ? 'falling' : 'steady';
  return trend === 'falling'
    ? { trend, change: down, day: low.day, today }
    : { trend, change: up, day: peak.day, today };
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
