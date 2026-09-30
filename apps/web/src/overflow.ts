import type {
  BankMeasurement,
  BankReachReport,
  CanalLevels,
} from '../../../contracts/v1/ts/bkk_water';
import type { FeatureCollection, Point, LineString } from 'geojson';

export type BankObservation = BankMeasurement | BankReachReport;
export const BANK_COLORS = {
  above_bank: '#c62828',
  at_bank: '#b86b00',
  below_bank: '#247ba0',
  unknown: '#7b858b',
};
type BankStatus = keyof typeof BANK_COLORS;

/** A point never gives a whole reach a status; freshness follows observation time, not fetch time. */
export function bankState(
  item: BankObservation,
  now: number,
): { status: BankStatus; text: string } {
  const unknown = (why: string) => ({
    status: 'unknown' as const,
    text: `ยังยืนยันไม่ได้ · ${why}`,
  });
  if (!item.verified) return unknown('หลักฐานยังไม่ผ่านการตรวจสอบ');
  const time = item.observed_at ? Date.parse(item.observed_at) : NaN;
  if (!Number.isFinite(time)) return unknown('ไม่มีเวลาวัดหรือรายงาน');
  if (time > now) return unknown('เวลาต้นทางอยู่ในอนาคต');
  if (now - time > 60 * 60_000) return unknown('ข้อมูลเกิน 60 นาที');
  if (item.kind === 'reported_reach') {
    const text = {
      above_bank: 'ต้นทางรายงานน้ำเกินตลิ่งในช่วงนี้',
      at_bank: 'ต้นทางรายงานน้ำถึงระดับตลิ่งในช่วงนี้',
      below_bank: 'ต้นทางรายงานน้ำต่ำกว่าตลิ่งในช่วงนี้',
      unknown: 'ยังยืนยันระดับน้ำเทียบตลิ่งไม่ได้',
    };
    return { status: item.status, text: text[item.status] };
  }
  if (
    item.level_m === null ||
    item.bank_m === null ||
    !Number.isFinite(item.level_m) ||
    !Number.isFinite(item.bank_m)
  )
    return unknown('ไม่มีระดับน้ำหรือระดับตลิ่ง');
  if (
    !item.level_datum?.trim() ||
    item.level_datum !== item.bank_datum ||
    !item.level_side?.trim() ||
    item.level_side !== item.bank_side
  )
    return unknown('ระดับอ้างอิงหรือฝั่งที่วัดไม่ตรงกัน');
  const diff = item.level_m - item.bank_m;
  const size = (Math.abs(diff) * 100).toLocaleString('th-TH', { maximumFractionDigits: 1 });
  return diff > 0
    ? { status: 'above_bank', text: `น้ำสูงกว่าตลิ่ง ${size} ซม. ณ จุดวัด` }
    : diff < 0
      ? { status: 'below_bank', text: `น้ำต่ำกว่าตลิ่ง ${size} ซม. ณ จุดวัด` }
      : { status: 'at_bank', text: 'น้ำถึงระดับตลิ่ง ณ จุดวัด' };
}

export function bankFeatures(
  file: CanalLevels | null,
  now: number,
): FeatureCollection<Point | LineString> {
  return {
    type: 'FeatureCollection',
    features: (file?.bank_observations ?? []).map((item) => {
      const state = bankState(item, now);
      return {
        type: 'Feature',
        geometry: item.geometry as Point | LineString,
        properties: { id: item.id, color: BANK_COLORS[state.status], status: state.status },
      };
    }),
  };
}
