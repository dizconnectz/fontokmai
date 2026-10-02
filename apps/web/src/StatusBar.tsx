import type { Level } from './alerts';
import { shownDam, releaseChange, type DamReport } from './bkk';
import { isOngoing } from './floods';
import { openSection } from './Fold';
import { changeSince, shownItems, type Overview } from './overview';
import { riverSummary, type RiverForecast } from './rivers';
import type { Alert, LiveFloods } from './data';

/**
 * The whole picture in one line at the top of the side panel (user 2026-10-01): how many places to watch now and to
 * prepare for, flood reports, dams over capacity or releasing a lot more, official alerts. Each chip opens its
 * section. Counts only: the sections below say what and where, with sources and times.
 */
export type Tone = 'danger' | 'warn' | 'ok';

export interface Chip {
  key: string;
  text: string;
  tone: Tone;
  /** id of the section the chip opens; null for a chip that only says something */
  target: string | null;
}

export interface StatusCounts {
  watchNow: number;
  watchNext: number;
  /** change since the round about an hour before; null without one */
  watchNowDelta?: number | null;
  watchNextDelta?: number | null;
  /** flood reports still in their time; null when the file is not there */
  floods: number | null;
  damsFull: number;
  damsReleasing: number;
  /** main rivers the system's forecast sees rising in 7 days, and whether one rises a lot */
  riversRising?: number;
  riversFast?: boolean;
  /** alerts in effect; null when the alert feed cannot be trusted (old or missing) */
  alerts: number | null;
  worst: Level | null;
}

/** " · เพิ่ม 3 ใน 1 ชม." / " · ลด 2 ใน 1 ชม.": the change since the round about an hour before */
function trend(delta: number | null | undefined): string {
  if (!delta) return '';
  return ` · ${delta > 0 ? 'เพิ่ม' : 'ลด'} ${Math.abs(delta)} ใน 1 ชม.`;
}

export function statusChips(counts: StatusCounts): Chip[] {
  const chips: Chip[] = [];
  if (counts.watchNow)
    chips.push({
      key: 'now',
      text: `ต้องระวังตอนนี้ ${counts.watchNow} แห่ง${trend(counts.watchNowDelta)}`,
      tone: 'danger',
      target: 'summary',
    });
  if (counts.watchNext)
    chips.push({
      key: 'next',
      text: `เตรียมรับมือ ${counts.watchNext} แห่ง${trend(counts.watchNextDelta)}`,
      tone: 'warn',
      target: 'summary',
    });
  if (counts.floods)
    chips.push({
      key: 'floods',
      text: `น้ำท่วม ${counts.floods} จุด`,
      tone: 'danger',
      target: 'floods-now',
    });
  if (counts.damsFull)
    chips.push({
      key: 'dams-full',
      text: `เขื่อนเกินความจุ ${counts.damsFull} แห่ง`,
      tone: 'warn',
      target: 'dams',
    });
  if (counts.damsReleasing)
    chips.push({
      key: 'dams-release',
      text: `เขื่อนระบายเพิ่มมาก ${counts.damsReleasing} แห่ง`,
      // a release up a lot is something to watch, in red (user 2026-10-02)
      tone: 'danger',
      target: 'dams',
    });
  if (counts.riversRising)
    chips.push({
      key: 'rivers',
      text: `แม่น้ำจะเพิ่ม ${counts.riversRising} สาย`,
      tone: counts.riversFast ? 'danger' : 'warn',
      target: 'rivers',
    });
  if (counts.alerts)
    chips.push({
      key: 'alerts',
      text: `ประกาศกรมอุตุฯ ${counts.alerts} ฉบับ`,
      tone: counts.worst === 'extreme' || counts.worst === 'severe' ? 'danger' : 'warn',
      target: 'alerts',
    });
  // nothing found is said as such, never as "safe"
  if (!chips.length)
    chips.push({ key: 'calm', text: 'ยังไม่พบจุดที่ต้องระวัง', tone: 'ok', target: 'summary' });
  // no alert card is shown then (user 2026-10-02): nothing to open
  if (counts.alerts === 0)
    chips.push({ key: 'no-alerts', text: 'ไม่มีประกาศกรมอุตุฯ', tone: 'ok', target: null });
  return chips;
}

/** The counts of the files at `now`, as the sections below read them. */
export function statusCounts({
  summary,
  floods,
  dams,
  rivers = null,
  alerts,
  trusted,
  worst,
  now,
}: {
  summary: Overview | null;
  floods: LiveFloods | null;
  dams: DamReport | null;
  rivers?: RiverForecast | null;
  alerts: Alert[];
  trusted: boolean;
  worst: Level | null;
  now: number;
}): StatusCounts {
  const previousDay = dams?.previous_report_date ?? null;
  const risingRivers = rivers ? riverSummary(rivers, now).filter((row) => row.rising.length) : [];
  return {
    // as the summary card lists them: nothing from a file too old to list
    watchNow: summary ? shownItems(summary, 'now', now).length : 0,
    watchNext: summary ? shownItems(summary, 'next', now).length : 0,
    watchNowDelta: summary ? (changeSince(summary, 'now', now)?.delta ?? null) : null,
    watchNextDelta: summary ? (changeSince(summary, 'next', now)?.delta ?? null) : null,
    floods: floods ? floods.reports.filter((report) => isOngoing(report, now)).length : null,
    damsFull: (dams?.dams ?? []).filter((dam) => (shownDam(dam).percent ?? 0) > 100).length,
    damsReleasing: previousDay
      ? (dams?.dams ?? []).filter((dam) => releaseChange(dam)?.big).length
      : 0,
    riversRising: risingRivers.length,
    riversFast: risingRivers.some((row) => row.trend === 'rising_fast'),
    alerts: alerts.length ? alerts.length : trusted ? 0 : null,
    worst,
  };
}

export function StatusBar({ counts }: { counts: StatusCounts }) {
  return (
    <nav className="status-bar" aria-label="สรุปสถานการณ์" data-testid="status-bar">
      {statusChips(counts).map((chip) =>
        chip.target ? (
          <button
            key={chip.key}
            className={`status-chip ${chip.tone}`}
            onClick={() => openSection(chip.target!)}
          >
            {chip.text}
          </button>
        ) : (
          <span key={chip.key} className={`status-chip ${chip.tone}`}>
            {chip.text}
          </span>
        ),
      )}
    </nav>
  );
}
