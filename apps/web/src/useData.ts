import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DataError,
  loadConfig,
  loadRef,
  loadSnapshot,
  validCanalLevels,
  validCctv,
  validForecast,
  validLiveFloods,
  validPlaces,
  validRainGauges,
  validRoadFlood,
  validRoadFlooding,
  type CanalLevels,
  type CctvRegistry,
  type LiveFloods,
  type Manifest,
  type PlaceGazetteer,
  type RainForecast,
  type RainGauges,
  type RoadFloodHistory,
  type RoadFloodingDaily,
  type RuntimeConfig,
  type Snapshot,
} from './data';
import { RefSync, type RefSlot } from './refSync';

export type { RefState } from './refSync';
type RefName =
  'cameras' | 'roads' | 'places' | 'forecast' | 'floods' | 'water' | 'rain' | 'flooding';
// Files of the manifest outside the snapshot generation. Cameras and the forecast (timeline, ~50 KB gzip)
// load at once; the others on first need.
const REF_FILES: Record<RefName, { path: string; valid: (value: unknown) => boolean }> = {
  cameras: { path: 'ref/cctv.json', valid: validCctv },
  roads: { path: 'ref/road_flood_history.json', valid: validRoadFlood },
  places: { path: 'ref/places.json', valid: validPlaces },
  forecast: { path: 'forecast/rain.json', valid: validForecast },
  floods: { path: 'live/floods.json', valid: validLiveFloods },
  // Bangkok canal levels and rain gauges (DXS), drawn as map pins
  water: { path: 'bkk/water.json', valid: validCanalLevels },
  rain: { path: 'bkk/rain.json', valid: validRainGauges },
  flooding: { path: 'bkk/flooding.json', valid: validRoadFlooding },
};
const IDLE: RefSlot<never> = { value: null, state: 'idle' };

export function useData() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<DataError | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [cameras, setCameras] = useState<RefSlot<CctvRegistry>>(IDLE);
  const [roads, setRoads] = useState<RefSlot<RoadFloodHistory>>(IDLE);
  const [places, setPlaces] = useState<RefSlot<PlaceGazetteer>>(IDLE);
  const [forecast, setForecast] = useState<RefSlot<RainForecast>>(IDLE);
  const [floods, setFloods] = useState<RefSlot<LiveFloods>>(IDLE);
  const [water, setWater] = useState<RefSlot<CanalLevels>>(IDLE);
  const [rain, setRain] = useState<RefSlot<RainGauges>>(IDLE);
  const [flooding, setFlooding] = useState<RefSlot<RoadFloodingDaily>>(IDLE);
  const current = useRef<Snapshot | null>(null);
  const settings = useRef<RuntimeConfig | null>(null);
  const flight = useRef<AbortController | null>(null);
  const wanted = useRef(
    new Set<RefName>(['cameras', 'forecast', 'floods', 'water', 'rain', 'flooding']),
  );
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const syncs = useRef<Record<RefName, Pick<RefSync<unknown>, 'sync'>> | null>(null);
  if (!syncs.current) {
    const loader = (name: RefName) => (manifest: Manifest, path: string) =>
      loadRef(
        settings.current!.DATA_BASE_URL,
        manifest,
        path,
        REF_FILES[name].valid as (value: unknown) => value is { schema_version?: string },
      );
    syncs.current = {
      cameras: new RefSync(REF_FILES.cameras.path, loader('cameras'), (slot) =>
        setCameras(slot as RefSlot<CctvRegistry>),
      ),
      roads: new RefSync(REF_FILES.roads.path, loader('roads'), (slot) =>
        setRoads(slot as RefSlot<RoadFloodHistory>),
      ),
      places: new RefSync(REF_FILES.places.path, loader('places'), (slot) =>
        setPlaces(slot as RefSlot<PlaceGazetteer>),
      ),
      forecast: new RefSync(REF_FILES.forecast.path, loader('forecast'), (slot) =>
        setForecast(slot as RefSlot<RainForecast>),
      ),
      floods: new RefSync(REF_FILES.floods.path, loader('floods'), (slot) =>
        setFloods(slot as RefSlot<LiveFloods>),
      ),
      water: new RefSync(REF_FILES.water.path, loader('water'), (slot) =>
        setWater(slot as RefSlot<CanalLevels>),
      ),
      rain: new RefSync(REF_FILES.rain.path, loader('rain'), (slot) =>
        setRain(slot as RefSlot<RainGauges>),
      ),
      flooding: new RefSync(REF_FILES.flooding.path, loader('flooding'), (slot) =>
        setFlooding(slot as RefSlot<RoadFloodingDaily>),
      ),
    };
  }

  const syncRef = useCallback(async (name: RefName) => {
    if (current.current && settings.current)
      await syncs.current![name].sync(current.current.manifest);
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
    cameras: cameras.value,
    camerasState: cameras.state,
    roads: roads.value,
    roadsState: roads.state,
    loadRoads,
    places: places.value,
    placesState: places.state,
    loadPlaces,
    forecast: forecast.value,
    forecastState: forecast.state,
    floods: floods.value,
    floodsState: floods.state,
    water: water.value,
    waterState: water.state,
    rain: rain.value,
    rainState: rain.state,
    flooding: flooding.value,
    floodingState: flooding.state,
  };
}
