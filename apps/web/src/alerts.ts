import { displayStatus, type Alert } from './data';

export type Level = 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
export const LEVEL_LABEL: Record<Level, string> = {
  extreme: 'รุนแรงมาก',
  severe: 'รุนแรง',
  moderate: 'เฝ้าระวัง',
  minor: 'เล็กน้อย',
  unknown: 'ไม่ระบุระดับ',
};
// Map fills; the matching text/background pairs live in styles.css (level-*)
export const LEVEL_FILL: Record<Level, string> = {
  extreme: '#e53935',
  severe: '#fb8c00',
  moderate: '#fbc02d',
  minor: '#fff176',
  unknown: '#90a4ae',
};
export const LEVEL_LINE: Record<Level, string> = {
  extreme: '#b71c1c',
  severe: '#bf5b00',
  moderate: '#a17800',
  minor: '#a19100',
  unknown: '#546e7a',
};
const ORDER: Level[] = ['extreme', 'severe', 'moderate', 'minor', 'unknown'];

export function levelOf(alert: Alert): Level {
  const severity = alert.severity.toLowerCase();
  return (ORDER as string[]).includes(severity) ? (severity as Level) : 'unknown';
}
export function worstLevel(alerts: Alert[]): Level | null {
  if (!alerts.length) return null;
  return ORDER[Math.min(...alerts.map((a) => ORDER.indexOf(levelOf(a))))];
}

/** "ฝนตกหนักมาก" from "พื้นที่เสี่ยงภัยฝนตกหนักมากบริเวณประเทศไทย". */
export function hazardTitle(alert: Alert): string {
  const text = (alert.headline_th ?? alert.event)
    .replace(/^พื้นที่เสี่ยงภัย/, '')
    .replace(/บริเวณประเทศไทย$/, '')
    .replace(/บริเวณ$/, '')
    .trim();
  return text || alert.event;
}
export function provincesOf(alert: Alert): string[] {
  return (alert.area_desc_th ?? '').split(/\s+/).filter(Boolean);
}
export function whereText(alert: Alert): string {
  const provinces = provincesOf(alert);
  if (!provinces.length) return 'ไม่ระบุพื้นที่';
  if (provinces.length <= 3) return provinces.join(' ');
  const bangkok = provinces.includes('กรุงเทพมหานคร') ? ' รวม กทม.' : '';
  return `${provinces.length} จังหวัด${bangkok}`;
}

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const CLOCK = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
});
const DATE = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
});
/** "วันนี้ 18:00" / "พรุ่งนี้ 06:00" / "28 ก.ย. 06:00" in Thai time. */
export function shortTime(value: string | number, now: number): string {
  const time = typeof value === 'number' ? value : Date.parse(value);
  const day = DAY.format(time);
  const clock = `${CLOCK.format(time)} น.`;
  if (day === DAY.format(now)) return `วันนี้ ${clock}`;
  if (day === DAY.format(now + 86_400_000)) return `พรุ่งนี้ ${clock}`;
  if (day === DAY.format(now - 86_400_000)) return `เมื่อวาน ${clock}`;
  return `${DATE.format(time)} ${clock}`;
}
export function whenText(alert: Alert, now: number): string {
  if (displayStatus(alert, now) === 'pending') return `เริ่ม ${shortTime(alert.effective, now)}`;
  const approx = alert.expires_policy === 'default_24h' ? ' (โดยประมาณ)' : '';
  return `ถึง ${shortTime(alert.expires, now)}${approx}`;
}
/** One line a person can read at a glance. */
export function summaryLine(alert: Alert, now: number): string {
  return `${hazardTitle(alert)} · ${whereText(alert)} · ${whenText(alert, now)}`;
}
