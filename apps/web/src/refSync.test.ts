import { describe, expect, it } from 'vitest';
import type { Manifest } from './data';
import { RefSync, type RefSlot } from './refSync';

const PATH = 'ref/cctv.json';
function manifest(sha: string | null): Manifest {
  return {
    files: sha ? [{ path: PATH, sha256: sha.padEnd(64, '0'), size: 1, revision: 1 }] : [],
  } as unknown as Manifest;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup() {
  const requests = new Map<string, ReturnType<typeof deferred<string>>>();
  const seen: RefSlot<string>[] = [];
  const sync = new RefSync<string>(
    PATH,
    (m) => {
      const sha = m.files[0].sha256.slice(0, 1);
      const request = deferred<string>();
      requests.set(sha, request);
      return request.promise;
    },
    (slot) => seen.push(slot),
  );
  return { sync, requests, seen };
}

describe('reference files follow the manifest', () => {
  it('reports a failed first load as an error, never as an empty list', async () => {
    const { sync, requests } = setup();
    const pending = sync.sync(manifest('a'));
    expect(sync.slot).toEqual({ value: null, state: 'loading' });
    requests.get('a')!.reject(new Error('503'));
    await pending;
    expect(sync.slot).toEqual({ value: null, state: 'error' });
  });

  it('keeps the previous version as outdated when a newer one fails, and retries it', async () => {
    const { sync, requests } = setup();
    let pending = sync.sync(manifest('a'));
    requests.get('a')!.resolve('cameras A');
    await pending;
    pending = sync.sync(manifest('b'));
    requests.get('b')!.reject(new Error('503'));
    await pending;
    expect(sync.slot).toEqual({ value: 'cameras A', state: 'outdated' });
    pending = sync.sync(manifest('b'));
    requests.get('b')!.resolve('cameras B');
    await pending;
    expect(sync.slot).toEqual({ value: 'cameras B', state: 'ready' });
  });

  it('drops the data when the manifest no longer lists the file, and loads it again when it returns', async () => {
    const { sync, requests } = setup();
    let pending = sync.sync(manifest('a'));
    requests.get('a')!.resolve('cameras A');
    await pending;
    await sync.sync(manifest(null));
    expect(sync.slot).toEqual({ value: null, state: 'missing' });
    pending = sync.sync(manifest('a'));
    expect(sync.slot.state).toBe('loading');
    requests.get('a')!.resolve('cameras A');
    await pending;
    expect(sync.slot).toEqual({ value: 'cameras A', state: 'ready' });
  });

  it('never lets an older request that finishes late replace a newer version', async () => {
    const { sync, requests } = setup();
    const old = sync.sync(manifest('a'));
    const fresh = sync.sync(manifest('b'));
    requests.get('b')!.resolve('cameras B');
    await fresh;
    requests.get('a')!.resolve('cameras A');
    await old;
    expect(sync.slot).toEqual({ value: 'cameras B', state: 'ready' });
    // and a removal while a request is in flight wins as well
    const late = sync.sync(manifest('c'));
    await sync.sync(manifest(null));
    requests.get('c')!.resolve('cameras C');
    await late;
    expect(sync.slot).toEqual({ value: null, state: 'missing' });
  });

  it('asks only once per version', async () => {
    const { sync, requests } = setup();
    const first = sync.sync(manifest('a'));
    const again = sync.sync(manifest('a'));
    requests.get('a')!.resolve('cameras A');
    await Promise.all([first, again]);
    await sync.sync(manifest('a'));
    expect(requests.size).toBe(1);
    expect(sync.slot.state).toBe('ready');
  });
});
