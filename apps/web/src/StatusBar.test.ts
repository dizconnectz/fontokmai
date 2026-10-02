import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { statusChips, statusCounts, type StatusCounts } from './StatusBar';
import type { Overview } from './overview';

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
    expect(statusChips(quiet).map((chip) => [chip.text, chip.target])).toEqual([
      ['ยังไม่พบจุดที่ต้องระวัง', 'summary'],
      // no alert card is shown then (user, 2026-10-02): the chip opens nothing
      ['ไม่มีประกาศกรมอุตุฯ', null],
    ]);
    // an old or missing alert feed says nothing about alerts
    expect(statusChips({ ...quiet, alerts: null, floods: null }).map((chip) => chip.text)).toEqual([
      'ยังไม่พบจุดที่ต้องระวัง',
    ]);
    // a minor or moderate alert is a warning, not a danger
    expect(statusChips({ ...quiet, alerts: 1, worst: 'moderate' })[0].tone).toBe('warn');
  });

  it('counts the places as the summary card lists them, none from a file too old to list', () => {
    const summary = JSON.parse(
      readFileSync(
        new URL('../../../contracts/v1/examples/overview/overview.json', import.meta.url),
        'utf8',
      ),
    ) as Overview;
    const counts = (now: number) =>
      statusCounts({
        summary,
        floods: null,
        dams: null,
        alerts: [],
        trusted: true,
        worst: null,
        now,
      });
    const at = Date.parse('2026-09-26T17:30:00+07:00');
    expect([counts(at).watchNow, counts(at).watchNext]).toEqual([2, 6]);
    // more than three hours after the file was made, the card lists nothing and the bar says nothing
    const late = counts(at + 3 * 3_600_000 + 60_000);
    expect([late.watchNow, late.watchNext]).toEqual([0, 0]);
  });

  it('says how the places changed in the last hour, in words, and nothing without the round before', () => {
    const chips = (watchNowDelta: number | null, watchNextDelta: number | null) =>
      statusChips({ ...quiet, watchNow: 12, watchNext: 4, watchNowDelta, watchNextDelta })
        .slice(0, 2)
        .map((chip) => chip.text);
    expect(chips(3, -1)).toEqual([
      'ต้องระวังตอนนี้ 12 แห่ง · เพิ่ม 3 ใน 1 ชม.',
      'เตรียมรับมือ 4 แห่ง · ลด 1 ใน 1 ชม.',
    ]);
    expect(chips(0, null)).toEqual(['ต้องระวังตอนนี้ 12 แห่ง', 'เตรียมรับมือ 4 แห่ง']);
  });
});
