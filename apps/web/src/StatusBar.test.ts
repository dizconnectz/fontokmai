import { describe, expect, it } from 'vitest';
import { statusChips, type StatusCounts } from './StatusBar';

const quiet: StatusCounts = {
  watchNow: 0,
  watchNext: 0,
  floods: 0,
  damsFull: 0,
  damsReleasing: 0,
  alerts: 0,
  worst: null,
};

describe('the status bar says the whole picture in one line (user, 2026-10-01)', () => {
  it('names each kind of trouble with its count and the section it opens', () => {
    const chips = statusChips({
      watchNow: 15,
      watchNext: 3,
      floods: 5,
      damsFull: 2,
      damsReleasing: 1,
      alerts: 2,
      worst: 'severe',
    });
    expect(chips.map((chip) => [chip.text, chip.tone, chip.target])).toEqual([
      ['ต้องระวังตอนนี้ 15 แห่ง', 'danger', 'summary'],
      ['เตรียมรับมือ 3 แห่ง', 'warn', 'summary'],
      ['น้ำท่วม 5 จุด', 'danger', 'floods-now'],
      ['เขื่อนเกินความจุ 2 แห่ง', 'warn', 'dams'],
      ['เขื่อนระบายเพิ่มมาก 1 แห่ง', 'warn', 'dams'],
      ['ประกาศกรมอุตุฯ 2 ฉบับ', 'danger', 'alerts'],
    ]);
  });

  it('says nothing was found, never that it is safe, and no alert only when the feed is trusted', () => {
    expect(statusChips(quiet).map((chip) => chip.text)).toEqual([
      'ยังไม่พบจุดที่ต้องระวัง',
      'ไม่มีประกาศกรมอุตุฯ',
    ]);
    // an old or missing alert feed says nothing about alerts
    expect(statusChips({ ...quiet, alerts: null, floods: null }).map((chip) => chip.text)).toEqual([
      'ยังไม่พบจุดที่ต้องระวัง',
    ]);
    // a minor or moderate alert is a warning, not a danger
    expect(statusChips({ ...quiet, alerts: 1, worst: 'moderate' })[0].tone).toBe('warn');
  });
});
