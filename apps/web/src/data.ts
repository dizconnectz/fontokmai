import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import manifestSchema from '../../../contracts/v1/schema/manifest.schema.json';
import alertsSchema from '../../../contracts/v1/schema/alerts.schema.json';
import radarSchema from '../../../contracts/v1/schema/radar.schema.json';
import cctvSchema from '../../../contracts/v1/schema/cctv.schema.json';
import roadFloodSchema from '../../../contracts/v1/schema/road_flood_history.schema.json';
import placesSchema from '../../../contracts/v1/schema/places.schema.json';
import forecastSchema from '../../../contracts/v1/schema/forecast.schema.json';
import type { Manifest } from '../../../contracts/v1/ts/manifest';
import type { Alert, AlertsFeed } from '../../../contracts/v1/ts/alerts';
import type { RadarFeed } from '../../../contracts/v1/ts/radar';
import type { CctvRegistry } from '../../../contracts/v1/ts/cctv';
import type { RoadFloodHistory } from '../../../contracts/v1/ts/road_flood_history';
import type { PlaceGazetteer } from '../../../contracts/v1/ts/places';
import type { RainForecast } from '../../../contracts/v1/ts/forecast';

export type {
  Alert,
  AlertsFeed,
  CctvRegistry,
  Manifest,
  PlaceGazetteer,
  RadarFeed,
  RainForecast,
  RoadFloodHistory,
};
export type Camera = CctvRegistry['cameras'][number];
export interface Snapshot {
  manifest: Manifest;
  feed: AlertsFeed | null;
  /** Latest radar frames of the same generation, when the snapshot has them. */
  radar?: RadarFeed | null;
}
export interface RuntimeConfig {
  DATA_BASE_URL: string;
  DATA_MODE: 'example' | 'live';
}
export class DataError extends Error {
  constructor(
    public code: 'mixed' | 'invalid' | 'network' | 'older',
    message: string,
  ) {
    super(message);
  }
}

// Additive fields are forward-compatible. Known fields still use the generated schema.
function allowAdditions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(allowAdditions);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'additionalProperties')
        .map(([key, item]) => [key, allowAdditions(item)]),
    );
  return value;
}
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validManifest = ajv.compile<Manifest>(allowAdditions(manifestSchema) as object);
const validFeed = ajv.compile<AlertsFeed>(allowAdditions(alertsSchema) as object);
const validRadar = ajv.compile<RadarFeed>(allowAdditions(radarSchema) as object);
export const validCctv = ajv.compile<CctvRegistry>(allowAdditions(cctvSchema) as object);
export const validRoadFlood = ajv.compile<RoadFloodHistory>(
  allowAdditions(roadFloodSchema) as object,
);
export const validPlaces = ajv.compile<PlaceGazetteer>(allowAdditions(placesSchema) as object);
export const validForecast = ajv.compile<RainForecast>(allowAdditions(forecastSchema) as object);

/** radar.json belongs to the snapshot generation, like alerts.json. */
export function validateRadar(manifest: Manifest, radar: unknown): RadarFeed {
  if (!validRadar(radar) || radar.schema_version !== '1')
    throw new DataError('invalid', 'รูปแบบข้อมูลเรดาร์ไม่รองรับ');
  if (radar.generation_id !== manifest.generation_id)
    throw new DataError('mixed', 'ไฟล์ข้อมูลเป็นคนละชุด');
  return radar;
}

export function validateSnapshot(manifest: unknown, feed: unknown | null): Snapshot {
  if (!validManifest(manifest) || manifest.schema_version !== '1')
    throw new DataError('invalid', 'รูปแบบ manifest ไม่รองรับ');
  if (feed === null) return { manifest, feed: null };
  if (!validFeed(feed) || feed.schema_version !== '1')
    throw new DataError('invalid', 'รูปแบบประกาศไม่รองรับ');
  if (
    feed.generation_id !== manifest.generation_id ||
    feed.recovery_epoch !== manifest.recovery_epoch
  )
    throw new DataError('mixed', 'ไฟล์ข้อมูลเป็นคนละชุด');
  if (feed.alerts.some((a) => a.geometry && a.geometry.type !== 'MultiPolygon'))
    throw new DataError('invalid', 'รูปแบบพื้นที่ไม่รองรับ');
  return { manifest, feed };
}

type Fetcher = typeof fetch;
async function getJson(url: string, fetcher: Fetcher, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DataError('network', 'โหลดข้อมูลไม่สำเร็จ');
  }
}

export async function loadConfig(origin: string): Promise<RuntimeConfig> {
  const value = await getJson(
    new URL(`${import.meta.env.BASE_URL}config.json`, origin).href,
    fetch,
  );
  if (
    !value ||
    typeof value !== 'object' ||
    !('DATA_BASE_URL' in value) ||
    typeof value.DATA_BASE_URL !== 'string' ||
    !('DATA_MODE' in value) ||
    !['example', 'live'].includes(String(value.DATA_MODE))
  )
    throw new DataError('invalid', 'การตั้งค่าแหล่งข้อมูลไม่ถูกต้อง');
  const base = new URL(
    value.DATA_BASE_URL.endsWith('/') ? value.DATA_BASE_URL : `${value.DATA_BASE_URL}/`,
    origin,
  );
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new DataError('invalid', 'ที่อยู่ข้อมูลไม่ถูกต้อง');
  return { DATA_BASE_URL: base.href, DATA_MODE: value.DATA_MODE as RuntimeConfig['DATA_MODE'] };
}

export async function loadSnapshot(
  base: string,
  previous: Snapshot | null = null,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<Snapshot> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const manifestUrl = new URL('manifest.json', base);
      manifestUrl.searchParams.set('t', `${Date.now()}-${attempt}`);
      const raw = await getJson(manifestUrl.href, fetcher, signal);
      const { manifest } = validateSnapshot(raw, null);
      const file = manifest.files.find((f) => f.path === 'alerts.json');
      const url = new URL('alerts.json', base);
      url.searchParams.set('g', manifest.generation_id);
      const priorFile = previous?.manifest.files.find((f) => f.path === 'alerts.json');
      const canReuse =
        file &&
        priorFile &&
        previous?.feed &&
        previous.manifest.generation_id === manifest.generation_id &&
        previous.manifest.recovery_epoch === manifest.recovery_epoch &&
        priorFile.sha256 === file.sha256 &&
        priorFile.size === file.size &&
        priorFile.revision === file.revision;
      const next: Snapshot = validateSnapshot(
        manifest,
        file ? (canReuse ? previous.feed : await getJson(url.href, fetcher, signal)) : null,
      );
      const radarFile = manifest.files.find((f) => f.path === 'radar.json');
      if (radarFile) {
        const radarUrl = new URL('radar.json', base);
        radarUrl.searchParams.set('g', manifest.generation_id);
        const priorRadar = previous?.manifest.files.find((f) => f.path === 'radar.json');
        const reuseRadar =
          previous?.radar &&
          previous.manifest.generation_id === manifest.generation_id &&
          priorRadar?.sha256 === radarFile.sha256;
        next.radar = validateRadar(
          manifest,
          reuseRadar ? previous.radar : await getJson(radarUrl.href, fetcher, signal),
        );
      }
      if (previous) {
        const oldEpoch = previous.manifest.recovery_epoch;
        const epoch = manifest.recovery_epoch;
        if (
          epoch < oldEpoch ||
          (epoch === oldEpoch &&
            (Date.parse(manifest.generated_at) < Date.parse(previous.manifest.generated_at) ||
              (next.feed &&
                previous.feed &&
                next.feed.feed_sequence < previous.feed.feed_sequence)))
        )
          throw new DataError('older', 'ได้รับข้อมูลเก่ากว่าชุดที่แสดงอยู่');
      }
      // Full replacement also drops all prior cursor/event state on recovery_epoch change.
      return next;
    } catch (error) {
      if (error instanceof DataError && error.code === 'mixed' && attempt === 0) continue;
      throw error;
    }
  }
  throw new DataError('mixed', 'ไฟล์ข้อมูลเป็นคนละชุด');
}

/** A reference file of the manifest (ref/…), fetched by revision so a changed file is never served stale. */
export async function loadRef<T extends { schema_version?: string }>(
  base: string,
  manifest: Manifest,
  path: string,
  valid: (value: unknown) => value is T,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<T | null> {
  const file = manifest.files.find((f) => f.path === path);
  if (!file) return null;
  const url = new URL(path, base);
  url.searchParams.set('r', `${file.revision}-${file.sha256.slice(0, 12)}`);
  const value = await getJson(url.href, fetcher, signal);
  if (!valid(value) || value.schema_version !== '1')
    throw new DataError('invalid', 'รูปแบบข้อมูลอ้างอิงไม่รองรับ');
  return value;
}
/** Minutes since the latest radar frame, or null without frames. */
export function radarAgeMinutes(radar: RadarFeed | null | undefined, now: number): number | null {
  const latest = radar?.frames.at(-1);
  return latest ? Math.round((now - Date.parse(latest.time)) / 60_000) : null;
}

export function staleAfter(manifest: Manifest): number {
  return Date.parse(manifest.next_due_at) + 15 * 60_000;
}
export function isStale(manifest: Manifest, now: number): boolean {
  return now > staleAfter(manifest);
}
export function displayStatus(alert: Alert, now: number): 'active' | 'pending' | 'ended' {
  if (
    alert.lifecycle_status === 'cancelled' ||
    alert.lifecycle_status === 'expired' ||
    now >= Date.parse(alert.expires)
  )
    return 'ended';
  return now < Date.parse(alert.effective) ? 'pending' : 'active';
}
export function visibleAlerts(feed: AlertsFeed | null | undefined, now: number): Alert[] {
  if (!feed) return [];
  const ended = new Set(feed.tombstones.map((item) => item.event_id));
  return feed.alerts
    .filter((alert) => !ended.has(alert.event_id) && displayStatus(alert, now) !== 'ended')
    .sort(
      (a, b) => Date.parse(b.sent) - Date.parse(a.sent) || a.event_id.localeCompare(b.event_id),
    );
}
export function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function formatTime(value: string | number | null | undefined): string {
  if (value == null) return 'ไม่ทราบเวลา';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
