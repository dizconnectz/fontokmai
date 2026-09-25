import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DataError,
  loadConfig,
  loadRef,
  loadSnapshot,
  validCctv,
  validRoadFlood,
  type CctvRegistry,
  type RoadFloodHistory,
  type RuntimeConfig,
  type Snapshot,
} from './data';

export type RefState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
const CCTV_PATH = 'ref/cctv.json';
const ROADS_PATH = 'ref/road_flood_history.json';

export function useData() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [cameras, setCameras] = useState<CctvRegistry | null>(null);
  const [roads, setRoads] = useState<RoadFloodHistory | null>(null);
  const [roadsState, setRoadsState] = useState<RefState>('idle');
  const current = useRef<Snapshot | null>(null);
  const settings = useRef<RuntimeConfig | null>(null);
  const flight = useRef<AbortController | null>(null);
  const loaded = useRef<Record<string, string>>({});
  const wantRoads = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  // Reference files change rarely: fetch one again only when its sha256 in the manifest changes.
  const syncRef = useCallback(async (path: string, next: Snapshot, base: string) => {
    const file = next.manifest.files.find((f) => f.path === path);
    if (!file) return 'missing' as const;
    if (loaded.current[path] === file.sha256) return 'same' as const;
    const value =
      path === CCTV_PATH
        ? await loadRef(base, next.manifest, path, validCctv)
        : await loadRef(base, next.manifest, path, validRoadFlood);
    loaded.current[path] = file.sha256;
    if (path === CCTV_PATH) setCameras(value as CctvRegistry | null);
    else setRoads(value as RoadFloodHistory | null);
    return 'loaded' as const;
  }, []);

  const loadRoads = useCallback(async () => {
    wantRoads.current = true;
    const next = current.current;
    const base = settings.current?.DATA_BASE_URL;
    if (!next || !base) return;
    setRoadsState((state) => (state === 'ready' ? state : 'loading'));
    try {
      const result = await syncRef(ROADS_PATH, next, base);
      setRoadsState(result === 'missing' ? 'missing' : 'ready');
    } catch {
      setRoadsState('error');
    }
  }, [syncRef]);

  const refresh = useCallback(async () => {
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setLoading(true);
    try {
      const nextConfig = settings.current ?? (await loadConfig(window.location.origin));
      if (controller.signal.aborted) return;
      settings.current = nextConfig;
      setConfig(nextConfig);
      const next = await loadSnapshot(
        nextConfig.DATA_BASE_URL,
        current.current,
        fetch,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      current.current = next;
      setSnapshot(next);
      setError(null);
      void syncRef(CCTV_PATH, next, nextConfig.DATA_BASE_URL).catch(() => undefined);
      if (wantRoads.current) void loadRoads();
    } catch (cause) {
      if (!controller.signal.aborted) {
        const failure =
          cause instanceof DataError ? cause : new DataError('network', 'โหลดข้อมูลไม่สำเร็จ');
        setError(failure);
        // A host can serve a new manifest a moment before the files that go with it; try again soon.
        if (failure.code === 'mixed') window.setTimeout(() => void refreshRef.current(), 10_000);
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setLoading(false);
      }
    }
  }, [syncRef, loadRoads]);

  refreshRef.current = refresh;
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const resume = () => {
      setNow(Date.now());
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      flight.current?.abort();
      flight.current = null;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  return {
    snapshot,
    config,
    error,
    loading,
    now,
    refresh,
    cameras,
    roads,
    roadsState,
    loadRoads,
  };
}
