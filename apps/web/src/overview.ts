import type { FeatureCollection, MultiPolygon } from 'geojson';
import type { Overview } from '../../../contracts/v1/ts/overview';
import type { Alert } from '../../../contracts/v1/ts/alerts';
import type { Boundaries } from '../../../contracts/v1/ts/boundaries';
import { displayStatus } from './data';
import { worstLevel, type Level } from './alerts';

// The places to watch now and to prepare for (contract section 21): fixed rules on the producer, not official.
export type { Overview };
export type OverviewItem = Overview['items'][number];
export type OverviewReason = OverviewItem['reasons'][number];

/** The file is rebuilt every round (15 minutes): older than this it is labelled, older than the second hidden. */
export const OVERVIEW_STALE_MS = 45 * 60_000;
export const OVERVIEW_TOO_OLD_MS = 3 * 3_600_000;
/** items of each list shown before "ดูทั้งหมด" */
export const OVERVIEW_TOP = 5;

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
const WEEKDAY = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long' });

/** Days from today (Thai calendar) to a Thai date written YYYY-MM-DD */
export function daysAway(isoDate: string, now: number): number {
  const today = Date.parse(`${DAY.format(now)}T00:00:00+07:00`);
  return Math.round((Date.parse(`${isoDate}T00:00:00+07:00`) - today) / 86_400_000);
}

/** "วันนี้", "พรุ่งนี้", "อีก 2 วัน (วันอังคาร)" from the viewer's clock */
export function dayWord(isoDate: string, now: number): string {
  const away = daysAway(isoDate, now);
  if (away === 0) return 'วันนี้';
  if (away === 1) return 'พรุ่งนี้';
  return `อีก ${away} วัน (${WEEKDAY.format(Date.parse(`${isoDate}T12:00:00+07:00`))})`;
}

/**
 * How long what is happening holds when a reason carries no `until` (a file made before it, contract section 21):
 * the producer's own limits (D33 for flood reports).
 */
const HOLDS_MS: Partial<Record<OverviewReason['kind'], number>> = {
  flood_reports: 12 * 3_600_000,
  rain_measured: 60 * 60_000,
  rain_radar: 45 * 60_000,
  // GISTDA's satellite water: 36 hours from the producer's last check of the layer
  satellite_flood: 36 * 3_600_000,
};
/**
 * Until when a reason holds; null when only its day decides (forecasts, rivers, dams). The producer's `until` and
 * the kind's own limit from `at` both bound it: the earlier one counts, so a reason whose time was changed keeps
 * no older `until` alive.
 */
export function holdsUntil(reason: OverviewReason): number | null {
  const bounds: number[] = [];
  if (reason.until) bounds.push(Date.parse(reason.until));
  if (reason.kind === 'road_flooding')
    bounds.push(Date.parse(`${DAY.format(Date.parse(reason.at))}T00:00:00+07:00`) + 86_400_000);
  const holds = HOLDS_MS[reason.kind];
  if (holds !== undefined) bounds.push(Date.parse(reason.at) + holds);
  return bounds.length ? Math.min(...bounds) : null;
}

/**
 * A reason in plain words with its day; null when it no longer holds: its day has passed, or what was happening is
 * over (Codex M27: the reports of a cluster passed their 12 hours while the file itself was still fresh).
 */
export function reasonLine(reason: OverviewReason, now: number): string | null {
  const until = holdsUntil(reason);
  if (until !== null && now > until) return null;
  if (!reason.day) return reason.text_th;
  if (daysAway(reason.day, now) < 0) return null;
  // three days counted from its day read as they are; the others lead with their day
  return reason.kind === 'rain_3days'
    ? reason.text_th
    : `${dayWord(reason.day, now)}: ${reason.text_th}`;
}

/**
 * The items of one list whose reasons still hold at `now`. A place to watch now needs something that is still
 * happening: a forecast taken along with it does not keep it on the list alone.
 */
export function liveItems(overview: Overview, when: 'now' | 'next', now: number): OverviewItem[] {
  return overview.items.filter(
    (item) =>
      item.when === when &&
      item.reasons.some(
        (reason) => reasonLine(reason, now) !== null && (when === 'next' || !reason.day),
      ),
  );
}

/**
 * The reasons to prepare for that stand out in colour (user 2026-10-02: the dam lines were plain text): a release up
 * a lot in red, a dam over its storage and a river rising a lot in orange, as the dams card and the status bar show
 * them. The words say it; the colour only helps.
 */
export const REASON_TONE: Partial<Record<OverviewReason['kind'], 'danger' | 'warn'>> = {
  dam_release_up: 'danger',
  dam_full: 'warn',
  river_rising: 'warn',
  satellite_flood: 'warn',
};

/** The items a list shows at `now`: none when the file is too old to list (the summary card says so). */
export function shownItems(overview: Overview, when: 'now' | 'next', now: number): OverviewItem[] {
  return now - Date.parse(overview.generated_at) > OVERVIEW_TOO_OLD_MS
    ? []
    : liveItems(overview, when, now);
}

export interface ListChange {
  /** time of the round compared with, about an hour before the file */
  at: string;
  /** places shown now that the list of that round did not have */
  added: string[];
  /** places of that round that are no longer shown */
  passed: number;
  /** shown now minus listed then */
  delta: number;
}
/**
 * What changed in a list since the round about an hour before (user 2026-10-01): null when the producer kept no
 * such round, or when the file is too old to list anything.
 */
export function changeSince(
  overview: Overview,
  when: 'now' | 'next',
  now: number,
): ListChange | null {
  const earlier = overview.earlier;
  if (!earlier || now - Date.parse(overview.generated_at) > OVERVIEW_TOO_OLD_MS) return null;
  const shown = shownItems(overview, when, now).map((item) => item.place_th);
  const before = new Set(earlier[when]);
  return {
    at: earlier.generated_at,
    added: shown.filter((place) => !before.has(place)),
    passed: [...before].filter((place) => !shown.includes(place)).length,
    delta: shown.length - before.size,
  };
}

export interface WatchArea {
  /** DOPA code: a district to watch now (4 digits), a province to prepare for (2) */
  code: string;
  when: 'now' | 'next';
  place: string;
}
/**
 * The areas the map outlines (user 2026-10-01: see at a glance where the problems are): the places the summary
 * lists at `now` that have an area, a river point or a dam has none. A file made before `area_code` gives none.
 */
export function watchAreas(overview: Overview | null, now: number): WatchArea[] {
  if (!overview) return [];
  return (['now', 'next'] as const).flatMap((when) =>
    shownItems(overview, when, now).flatMap((item) =>
      item.area_code ? [{ code: item.area_code, when, place: item.place_th }] : [],
    ),
  );
}
export type WatchShapes = FeatureCollection<MultiPolygon, WatchArea>;
/**
 * The summary's places on the map, the web's own rules and not an announcement: a line only, never a fill like an
 * alert zone, red for a district to watch now, orange dashed for a province to prepare for.
 */
export const WATCH_COLOR = { now: '#d32f2f', next: '#ef6c00' } as const;
/** The outlines of the areas found in ref/boundaries.json; an area without one is left out. */
export function watchShapes(areas: WatchArea[], boundaries: Boundaries | null): WatchShapes {
  const outlines = new Map(boundaries?.areas.map((area) => [area.code, area.outline]) ?? []);
  return {
    type: 'FeatureCollection',
    features: areas.flatMap((area) => {
      const outline = outlines.get(area.code);
      return outline
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'MultiPolygon' as const, coordinates: outline.coordinates },
              properties: area,
            },
          ]
        : [];
    }),
  };
}
/** The box around the outlines of these codes, or null when one of them has no outline. */
export function outlineBounds(
  codes: string[],
  boundaries: Boundaries | null,
): [[number, number], [number, number]] | null {
  const outlines = new Map(boundaries?.areas.map((area) => [area.code, area.outline]) ?? []);
  const points = [];
  for (const code of codes) {
    const outline = outlines.get(code);
    if (!outline) return null;
    for (const polygon of outline.coordinates) points.push(...polygon[0]);
  }
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

/** "อ.ทับปุด จ.พังงา" → ["อ.ทับปุด", "จ.พังงา"]; "เขตจตุจักร กรุงเทพมหานคร" → ["เขตจตุจักร", "กรุงเทพมหานคร"] */
export function placeParts(place: string): [string, string] {
  const space = place.indexOf(' ');
  return space < 0 ? [place, place] : [place.slice(0, space), place.slice(space + 1)];
}

export interface PlaceGroup {
  province: string;
  /** strongest first, as the summary orders them */
  items: OverviewItem[];
}

/**
 * The places to watch now by province (user 2026-10-01: fifteen district cards were too long to take in): the
 * province of the strongest place first, each with its districts in the summary's order.
 */
export function groupByProvince(items: OverviewItem[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const item of items) {
    const province = placeParts(item.place_th)[1];
    const group = groups.get(province) ?? { province, items: [] };
    group.items.push(item);
    groups.set(province, group);
  }
  return [...groups.values()];
}

/**
 * The strongest official alert in effect or announced for the item's province, read from alerts.json: the
 * summary never copies alerts, it only points to them.
 */
export function officialFor(
  item: OverviewItem,
  alerts: Alert[],
  now: number,
): { level: Level; pending: boolean } | null {
  if (!item.province_code) return null;
  const target = `TH-${item.province_code}`;
  const here = alerts.filter((alert) => alert.targets.some((t) => t.code === target));
  const active = here.filter((alert) => displayStatus(alert, now) === 'active');
  const worst = worstLevel(active.length ? active : here);
  return worst ? { level: worst, pending: active.length === 0 } : null;
}

/** "ประกาศเตือนภัยของกรมอุตุฯ 2 ฉบับครอบคลุม 33 จังหวัด" from the alerts shown below the summary */
export function officialLine(alerts: Alert[]): string | null {
  if (!alerts.length) return null;
  const provinces = new Set(alerts.flatMap((alert) => alert.targets.map((t) => t.code)));
  return `มีประกาศเตือนภัยของกรมอุตุฯ ${alerts.length} ฉบับ ครอบคลุม ${provinces.size} จังหวัด (ดูด้านล่าง)`;
}

/** The inputs that were missing or not updated when the summary was made, e.g. "ฝนวัดจริง กทม. (สำนักการระบายน้ำ)" */
export function oldInputs(overview: Overview): string[] {
  return overview.inputs.filter((input) => input.status !== 'fresh').map((input) => input.name_th);
}
