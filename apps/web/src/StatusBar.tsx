import type { Level } from './alerts';
import type { RefState } from './refSync';
import { shownDam, releaseChange, type DamReport } from './bkk';
import { isOngoing } from './floods';
import { openSection } from './Fold';
import { changeSince, OVERVIEW_STALE_MS, shownItems, type Overview } from './overview';
import type { RiverRow } from './rivers';
import type { Alert, CanalOutlook, LiveFloods } from './data';

/**
 * A compact status summary at the top of the side panel (user 2026-10-01): the leading risk and official alert state
 * stay visible, while the other counts fold together. Each chip opens its section. Counts only: the sections below say
 * what and where, with sources and times.
 */
export type Tone = 'danger' | 'warn' | 'ok' | 'unknown';

/**
 * What the summary of places to watch can say now (Codex M40): `ok` fresh; `outdated` a newer round failed to load
 * and the one before is shown; `stale` older than 45 minutes; `loading`, `error` or `missing` when there is none.
 */
export type SummaryHealth = 'ok' | 'outdated' | 'stale' | 'loading' | 'error' | 'missing';

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
  /** canals of the pilot at warn and at watch by the site's trial rules (D35) */
  canalsWarn?: number;
  canalsWatch?: number;
  /** alerts in effect; null when the alert feed cannot be trusted (old or missing) */
  alerts: number | null;
  worst: Level | null;
  /** whether "nothing found" can be said (absent: as before, it can) */
  summary?: SummaryHealth;
}

/** The health of the summary file as the side panel has it */
export function summaryHealth(
  summary: Overview | null,
  load: RefState | undefined,
  now: number,
): SummaryHealth {
  if (summary) {
    if (now - Date.parse(summary.generated_at) > OVERVIEW_STALE_MS) return 'stale';
    return load === 'outdated' ? 'outdated' : 'ok';
  }
  if (load === 'idle' || load === 'loading') return 'loading';
  return load === 'error' ? 'error' : 'missing';
}

/** "nothing found" is said only from a summary that could be read and is fresh; otherwise why it cannot be said */
const CALM: Record<SummaryHealth, Omit<Chip, 'key'>> = {
  ok: { text: 'ยังไม่พบจุดที่ต้องระวัง', tone: 'ok', target: 'summary' },
  outdated: {
    text: 'ยังไม่พบจุดที่ต้องระวังในข้อมูลรอบก่อน · กำลังโหลดใหม่',
    tone: 'unknown',
    target: 'summary',
  },
  stale: {
    text: 'สรุปจุดที่ต้องระวังไม่อัปเดต · ยังประเมินไม่ได้',
    tone: 'unknown',
    target: 'summary',
  },
  loading: { text: 'กำลังโหลดสรุปจุดที่ต้องระวัง', tone: 'unknown', target: null },
  error: {
    text: 'โหลดสรุปจุดที่ต้องระวังไม่สำเร็จ · ยังประเมินไม่ได้',
    tone: 'unknown',
    target: null,
  },
  missing: {
    text: 'ยังไม่มีสรุปจุดที่ต้องระวัง · ยังประเมินไม่ได้',
    tone: 'unknown',
    target: null,
  },
};

/** " · เพิ่ม 3 ใน 1 ชม." / " · ลด 2 ใน 1 ชม.": the change since the round about an hour before */
function trend(delta: number | null | undefined): string {
  if (!delta) return '';
  return ` · ${delta > 0 ? 'เพิ่ม' : 'ลด'} ${Math.abs(delta)} ใน 1 ชม.`;
}

export function statusChips(counts: StatusCounts): Chip[] {
  const chips: Chip[] = [];
  // a summary that could not be read, or is old, says so first, where its places would be, even beside other
  // chips: they cannot stand for it (Codex M40)
  const health = counts.summary ?? 'ok';
  if (health !== 'ok' && health !== 'outdated') chips.push({ key: 'summary', ...CALM[health] });
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
  if (counts.canalsWarn || counts.canalsWatch)
    chips.push({
      key: 'canals',
      text: `คลองอาจล้น ${(counts.canalsWarn ?? 0) + (counts.canalsWatch ?? 0)} สาย`,
      tone: counts.canalsWarn ? 'danger' : 'warn',
      target: 'canals',
    });
  if (counts.alerts)
    chips.push({
      key: 'alerts',
      text: `ประกาศกรมอุตุฯ ${counts.alerts} ฉบับ`,
      tone: counts.worst === 'extreme' || counts.worst === 'severe' ? 'danger' : 'warn',
      target: 'alerts',
    });
  // nothing found is said as such, never as "safe", and only from a summary that could be read and is fresh (M40)
  if (!chips.length) chips.push({ key: 'calm', ...CALM[health] });
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
  riverRows = null,
  canals = null,
  summaryLoad,
  alerts,
  trusted,
  worst,
  now,
}: {
  summary: Overview | null;
  floods: LiveFloods | null;
  dams: DamReport | null;
  /** the rivers card's rows (riverSummary), worked out once for both */
  riverRows?: RiverRow[] | null;
  /** the canals' outlook (D35), as the canals card reads it */
  canals?: CanalOutlook | null;
  /** how the summary file loaded (RefSync's state); absent: as if it loaded */
  summaryLoad?: RefState;
  alerts: Alert[];
  trusted: boolean;
  worst: Level | null;
  now: number;
}): StatusCounts {
  const previousDay = dams?.previous_report_date ?? null;
  const risingRivers = (riverRows ?? []).filter((row) => row.rising.length);
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
    canalsWarn: (canals?.canals ?? []).filter((watch) => watch.level === 'warn').length,
    canalsWatch: (canals?.canals ?? []).filter((watch) => watch.level === 'watch').length,
    alerts: alerts.length ? alerts.length : trusted ? 0 : null,
    worst,
    summary: summaryHealth(summary, summaryLoad, now),
  };
}

export function StatusBar({ counts }: { counts: StatusCounts }) {
  const chips = statusChips(counts);
  const announcement = chips.find((chip) => chip.key === 'alerts' || chip.key === 'no-alerts');
  const first = chips[0];
  const visible = first
    ? [first, ...(announcement && announcement !== first ? [announcement] : chips.slice(1, 2))]
    : [];
  const extra = chips.filter((chip) => !visible.includes(chip));

  return (
    <nav className="status-bar" aria-label="สรุปสถานการณ์" data-testid="status-bar">
      {visible.map((chip) => (
        <StatusChip key={chip.key} chip={chip} />
      ))}
      {extra.length > 0 && (
        <details className="status-more" data-testid="status-more">
          <summary>ดูอีก {extra.length} สถานะ</summary>
          <div className="status-more-list">
            {extra.map((chip) => (
              <StatusChip key={chip.key} chip={chip} />
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}

function StatusChip({ chip }: { chip: Chip }) {
  return chip.target ? (
    <button className={`status-chip ${chip.tone}`} onClick={() => openSection(chip.target!)}>
      {chip.text}
    </button>
  ) : (
    <span className={`status-chip ${chip.tone}`}>{chip.text}</span>
  );
}
