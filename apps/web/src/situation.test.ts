import { describe, expect, it } from 'vitest';
import { situationSummary, situationTime } from './situation';

const report =
  'วันที่ 30 กันยายน 2569 เวลา 10.00 น. /พื้นที่ กทม.ไม่พบกลุ่มฝน / อุณหภูมิที่สำนักการระบายน้ำ 31 องศาเซลเซียส ความชื้นสัมพัทธ์ 69%';
const now = Date.parse('2026-09-30T10:30:00+07:00');

describe('situation report, not fetch time', () => {
  it('keeps the rain statement and its observation time, not office temperature', () => {
    expect(situationSummary(report, now)).toEqual({
      time: '2026-09-30T03:00:00.000Z',
      warning: null,
      rain: ['ไม่พบกลุ่มฝนในพื้นที่ กทม.'],
    });
  });
  it('ages the report even when fetched again and treats future time as unconfirmed', () => {
    expect(situationSummary(report, now + 86400_000).warning).toContain('รายงานย้อนหลัง');
    expect(situationSummary(report, now - 3600_000).warning).toContain('อนาคต');
  });
  it('does not infer dry weather from missing or unfamiliar observations', () => {
    expect(situationSummary('อุณหภูมิ 31 องศา ความชื้น 69%', now).rain).toEqual([]);
    expect(situationSummary('ฝนตกหลายพื้นที่', now).rain).toEqual(['ฝนตกหลายพื้นที่']);
    expect(situationSummary('ฝนตกหลายพื้นที่', now).warning).toContain('ระบุเวลา');
  });
  it('rejects invalid or ambiguous dates and supports Thai digits', () => {
    expect(situationTime(report.replace('30 กันยายน', '31 กันยายน'))).toBeNull();
    expect(situationTime(report.replace('10.00', '24.00'))).toBeNull();
    expect(situationTime(report + '\n' + report)).toBeNull();
    expect(situationTime('วันที่ ๓๐ กันยายน ๒๕๖๙ เวลา ๑๐.๐๐ น.')).toBe('2026-09-30T03:00:00.000Z');
  });
});
