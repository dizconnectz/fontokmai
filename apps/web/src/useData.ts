import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DataError,
  loadConfig,
  loadRef,
  loadSnapshot,
  validCctv,
  validPlaces,
  validRoadFlood,
  type CctvRegistry,
  type PlaceGazetteer,
  type RoadFloodHistory,
  type RuntimeConfig,
  type Snapshot,
} from './data';

export type RefState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
interface Refs {
  cameras: CctvRegistry | null;
  roads: RoadFloodHistory | null;
  places: PlaceGazetteer | null;
}
type RefName = keyof Refs;
// Reference files of the manifest. Cameras are small and always shown; the others load on first need.
const REF_FILES: { [K in RefName]: { path: string; valid: (value: unknown) => boolean } } = {
  cameras: { path: 'ref/cctv.json', valid: validCctv },
  roads: { path: 'ref/road_flood_history.json', valid: validRoadFlood },
  places: { path: 'ref/places.json', valid: validPlaces },
};
const NONE: Refs = { cameras: null, roads: null, places: null };
const IDLE: Record<RefName, RefState> = { cameras: 'idle', roads: 'idle', places: 'idle' };

export function useData() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refs, setRefs] = useState<Refs>(NONE);
  const [refStates, setRefStates] = useState(IDLE);
  const current = useRef<Snapshot | null>(null);
  const settings = useRef<RuntimeConfig | null>(null);
  const flight = useRef<AbortController | null>(null);
  // sha256 of the version loaded (or being loaded) per reference file
  const loaded = useRef<Record<string, string>>({});
  const wanted = useRef(new Set<RefName>(['cameras']));
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  // Reference files change rarely: fetch one again only when its sha256 in the manifest changes.
  const syncRef = useCallback(async (name: RefName) => {
    const next = current.current;
    const base = settings.current?.DATA_BASE_URL;
    if (!next || !base) return;
    const { path, valid } = REF_FILES[name];
    const setState = (state: RefState) => setRefStates((all) => ({ ...all, [name]: state }));
    const file = next.manifest.files.find((f) => f.path === path);
    if (!file) {
      setState('missing');
      return;
    }
    if (loaded.current[path] === file.sha256) return;
    const previous = loaded.current[path];
    loaded.current[path] = file.sha256;
    setRefStates((all) => ({ ...all, [name]: all[name] === 'ready' ? 'ready' : 'loading' }));
    try {
      const value = await loadRef(
        base,
        next.manifest,
        path,
        valid as (value: unknown) => value is { schema_version?: string },
      );
      setRefs((all) => ({ ...all, [name]: value }));
      setState('ready');
    } catch {
      // keep what was shown before and try again on the next refresh
      if (previous) loaded.current[path] = previous;
      else delete loaded.current[path];
      setRefStates((all) => ({ ...all, [name]: all[name] === 'ready' ? 'ready' : 'error' }));
    }
  }, []);

  const want = useCallback(
    async (name: RefName) => {
      wanted.current.add(name);
      await syncRef(name);
    },
    [syncRef],
  );
  const loadRoads = useCallback(() => want('roads'), [want]);
  const loadPlaces = useCallback(() => want('places'), [want]);

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
      for (const name of wanted.current) void syncRef(name);
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
  }, [syncRef]);

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
    cameras: refs.cameras,
    roads: refs.roads,
    roadsState: refStates.roads,
    loadRoads,
    places: refs.places,
    placesState: refStates.places,
    loadPlaces,
  };
}
