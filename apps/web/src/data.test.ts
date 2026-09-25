import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DataError,
  displayStatus,
  formatTime,
  isStale,
  loadSnapshot,
  safeLink,
  staleAfter,
  validateSnapshot,
  visibleAlerts,
  type AlertsFeed,
  type Manifest,
  type Snapshot,
} from './data';

const base = 'https://data.example.test/data/v1/';
function fixture<T>(scenario: string, file: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../contracts/v1/examples/${scenario}/${file}.json`, import.meta.url),
      'utf8',
    ),
  ) as T;
}
function pair(scenario = 'active'): Snapshot {
  return {
    manifest: fixture<Manifest>(scenario, 'manifest'),
    feed: fixture<AlertsFeed>(scenario, 'alerts'),
  };
}
function responder(...values: unknown[]) {
  let i = 0;
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(values[Math.min(i++, values.length - 1)]), { status: 200 }),
  );
}
const scenarios = [
  'active',
  'pending',
  'expired',
  'source-failed',
  'cancelled',
  'out-of-order',
  'mixed-generation',
];

describe('producer contract examples', () => {
  for (const scenario of scenarios)
    it(scenario, () => {
      const { manifest, feed } = pair(scenario);
      const expected = fixture<{
        generation_match: boolean;
        completeness: string;
        stale_after: string;
        recovery_epoch: number;
        feed_sequence: number;
        visible_alerts: object[];
        ended_events: object[];
        source_status: object[];
      }>(scenario, 'expected');
      if (!expected.generation_match) {
        expect(() => validateSnapshot(manifest, feed)).toThrow(DataError);
        return;
      }
      const snapshot = validateSnapshot(manifest, feed);
      expect(manifest.completeness).toBe(expected.completeness);
      expect(staleAfter(manifest)).toBe(Date.parse(expected.stale_after));
      expect(isStale(manifest, Date.parse(expected.stale_after))).toBe(false);
      expect(isStale(manifest, Date.parse(expected.stale_after) + 1)).toBe(true);
      expect(snapshot.feed!.recovery_epoch).toBe(expected.recovery_epoch);
      expect(snapshot.feed!.feed_sequence).toBe(expected.feed_sequence);
      const actual = visibleAlerts(snapshot.feed, Date.parse(manifest.generated_at)).map((a) => ({
        event_id: a.event_id,
        revision: a.revision,
        lifecycle_status: displayStatus(a, Date.parse(manifest.generated_at)),
        is_effective: a.is_effective,
        effective: a.effective,
        expires: a.expires,
        expires_policy: a.expires_policy,
        qc_flags: a.qc_flags,
      }));
      const sort = (list: object[]) =>
        [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(sort(actual)).toEqual(sort(expected.visible_alerts));
      expect(
        snapshot.feed!.tombstones.map(({ event_id, lifecycle_status, ended_at }) => ({
          event_id,
          lifecycle_status,
          ended_at,
        })),
      ).toEqual(expected.ended_events);
      expect(
        manifest.source_status.map(({ source_id, status, last_success_at }) => ({
          source_id,
          status,
          last_success_at,
        })),
      ).toEqual(expected.source_status);
    });
});

describe('snapshot loading and recovery', () => {
  it('uses no-store, a fresh manifest cache key and the generation in the file URL', async () => {
    const { manifest, feed } = pair();
    const request = responder(manifest, feed);
    await loadSnapshot(base, null, request);
    expect(new URL(String(request.mock.calls[0][0])).searchParams.has('t')).toBe(true);
    expect(request.mock.calls[0][1]?.cache).toBe('no-store');
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get('g')).toBe(
      manifest.generation_id,
    );
  });
  it('retries a mixed generation once, with a different manifest cache key', async () => {
    const mixed = pair('mixed-generation'),
      good = pair();
    const request = responder(mixed.manifest, mixed.feed, good.manifest, good.feed);
    const snapshot = await loadSnapshot(base, null, request);
    expect(snapshot).toEqual(good);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[0][0]).not.toEqual(request.mock.calls[2][0]);
  });
  it('does not mutate the previous snapshot when a mixed generation persists', async () => {
    const good = pair(),
      before = structuredClone(good),
      mixed = pair('mixed-generation');
    mixed.manifest.generation_id = 'new-generation';
    const request = responder(mixed.manifest, mixed.feed, mixed.manifest, mixed.feed);
    await expect(loadSnapshot(base, good, request)).rejects.toMatchObject({ code: 'mixed' });
    expect(good).toEqual(before);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('ignores unknown future files and additive fields', async () => {
    const { manifest, feed } = pair();
    manifest.files.push({ path: 'forecast.json', size: 1, revision: 1, sha256: '0'.repeat(64) });
    const request = responder({ ...manifest, future: true }, { ...feed, future: true });
    const snapshot = await loadSnapshot(base, null, request);
    expect(snapshot.feed!.alerts).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('reports an absent alerts file as unavailable, without inventing an empty feed', async () => {
    const { manifest } = pair();
    manifest.files = [];
    const snapshot = await loadSnapshot(base, null, responder(manifest));
    expect(snapshot.feed).toBeNull();
  });
  it('rejects an unsupported schema and invalid timestamps', () => {
    const { manifest, feed } = pair();
    expect(() => validateSnapshot({ ...manifest, schema_version: '2' }, feed)).toThrow();
    expect(() => validateSnapshot({ ...manifest, generated_at: '2026-09-25' }, feed)).toThrow();
  });
  it('reuses validated alerts only when the generation and file metadata are unchanged', async () => {
    const previous = pair();
    const request = responder(previous.manifest);
    const result = await loadSnapshot(base, previous, request);
    expect(result.feed).toBe(previous.feed);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed geometry rather than treating it as rain coverage', () => {
    const { manifest, feed } = pair();
    feed!.alerts[0].geometry!.type = undefined;
    expect(() => validateSnapshot(manifest, feed)).toThrow();
  });
  it('rejects network failures without erasing the last complete set', async () => {
    const previous = pair();
    await expect(
      loadSnapshot(
        base,
        previous,
        vi.fn(async () => new Response('', { status: 503 })),
      ),
    ).rejects.toMatchObject({ code: 'network' });
    expect(previous.feed!.alerts).toHaveLength(3);
  });
  it('rejects a backwards cursor in the same epoch', async () => {
    const previous = pair();
    previous.feed!.feed_sequence = 10;
    const next = pair();
    next.manifest.generation_id = 'new-generation';
    next.feed!.generation_id = 'new-generation';
    await expect(
      loadSnapshot(base, previous, responder(next.manifest, next.feed)),
    ).rejects.toMatchObject({ code: 'older' });
  });
  it('replaces all event state after an epoch change, even when sequence restarts', async () => {
    const previous = pair();
    previous.feed!.feed_sequence = 50;
    const next = pair('cancelled');
    next.manifest.recovery_epoch = 2;
    next.feed!.recovery_epoch = 2;
    const result = await loadSnapshot(base, previous, responder(next.manifest, next.feed));
    expect(result.feed!.feed_sequence).toBe(next.feed!.feed_sequence);
    expect(result.feed!.alerts).toHaveLength(0);
    expect(result.feed!.tombstones).toEqual(next.feed!.tombstones);
  });
  it('rejects a delayed response from an older recovery epoch', async () => {
    const previous = pair();
    previous.manifest.recovery_epoch = 2;
    previous.feed!.recovery_epoch = 2;
    const next = pair();
    await expect(
      loadSnapshot(base, previous, responder(next.manifest, next.feed)),
    ).rejects.toMatchObject({ code: 'older' });
  });
});

describe('display semantics', () => {
  it('expires alerts at the boundary even when the feed is frozen', () => {
    const alert = pair().feed!.alerts[0];
    expect(displayStatus(alert, Date.parse(alert.expires) - 1)).toBe('active');
    expect(displayStatus(alert, Date.parse(alert.expires))).toBe('ended');
  });
  it('marks future effective times as pending without changing source data', () => {
    const alert = pair().feed!.alerts[2];
    expect(displayStatus(alert, Date.parse(alert.effective) - 1)).toBe('pending');
    expect(displayStatus(alert, Date.parse(alert.effective))).toBe('active');
  });
  it('lets tombstones dominate even if an old alert slips into a feed', () => {
    const feed = pair().feed!;
    feed.tombstones.push({
      event_id: feed.alerts[0].event_id,
      revision: 2,
      lifecycle_status: 'cancelled',
      ended_at: feed.feed_generated_at,
    });
    expect(visibleAlerts(feed, Date.parse(feed.feed_generated_at))).toHaveLength(2);
  });
  it('preserves a null source time as unknown', () => {
    expect(formatTime(null)).toBe('ไม่ทราบเวลา');
  });
  it('formats timestamps in Bangkok independently of the system timezone', () => {
    expect(formatTime('2026-09-25T11:20:00Z')).toContain('18:20');
  });
  it('only renders normal public source links', () => {
    expect(safeLink('javascript:alert(1)')).toBeUndefined();
    expect(safeLink('https://user:password@example.test/')).toBeUndefined();
    expect(safeLink('https://www.tmd.go.th/')).toBe('https://www.tmd.go.th/');
  });
});
