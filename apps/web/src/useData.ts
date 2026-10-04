import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DataError,
  loadConfig,
  loadRef,
  loadSnapshot,
  validCanalLevels,
  validCctv,
  validDams,
  validForecast,
  validLiveFloods,
  validPlaces,
  validRainGauges,
  validRoadFlood,
  validRoadFlooding,
  validSituation,
  validWeatherToday,
  validRivers,
  validSatellite,
  validFloodFreq,
  validOutlook,
  validOverview,
  validBoundaries,
  validRiverLines,
  validFlows,
  validCanalLines,
  validCanalOutlook,
  type Boundaries,
  type CanalLines,
  type CanalOutlook,
  type RidFlows,
  type SatelliteFloods,
  type FloodFrequency,
  type RiverLines,
  type CanalLevels,
  type CctvRegistry,
  type DamReport,
  type LiveFloods,
  type Manifest,
  type PlaceGazetteer,
  type RainForecast,
  type RainGauges,
  type RoadFloodHistory,
  type RoadFloodingDaily,
  type SituationReport,
  type WeatherToday,
  type RiverForecast,
  type RainOutlook,
  type SummaryOverview,
  type RuntimeConfig,
  type Snapshot,
} from './data';
import { RefSync, type RefSlot } from './refSync';

export type { RefState } from './refSync';
type RefName =
  | 'cameras'
  | 'roads'
  | 'places'
  | 'forecast'
  | 'floods'
  | 'water'
  | 'rain'
  | 'flooding'
  | 'news'
  | 'dams'
  | 'weather'
  | 'outlook'
  | 'rivers'
  | 'overview'
  | 'boundaries'
  | 'riverLines'
  | 'flows'
  | 'canalLines'
  | 'canals'
  | 'satellite'
  | 'floodFreq';
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
  news: { path: 'bkk/news.json', valid: validSituation },
  dams: { path: 'water/dams.json', valid: validDams },
  weather: { path: 'weather/today.json', valid: validWeatherToday },
  // the GloFAS river trend (model values, rebuilt once a day)
  outlook: { path: 'forecast/outlook.json', valid: validOutlook },
  rivers: { path: 'forecast/rivers.json', valid: validRivers },
  // the places to watch, rebuilt every round from the other files (not official)
  overview: { path: 'summary/overview.json', valid: validOverview },
  // outlines of provinces and districts (~270 KB gzip), on first need: the summary has places to outline
  boundaries: { path: 'ref/boundaries.json', valid: validBoundaries },
  // the main rivers cut into stretches (~65 KB gzip), on first need: a river forecast to rise
  riverLines: { path: 'ref/river_lines.json', valid: validRiverLines },
  // RID's daily figures of the Chao Phraya's stations and gates (D35), and the canals they may fill: the lines
  // (~3 KB) and their outlook by the site's trial rules (rebuilt every round), all small, loaded at once
  flows: { path: 'water/flows.json', valid: validFlows },
  canalLines: { path: 'ref/canals.json', valid: validCanalLines },
  canals: { path: 'summary/canals.json', valid: validCanalOutlook },
  // GISTDA's flooded area seen from satellites, summed by district (~a few KB), loaded at once
  satellite: { path: 'floods/satellite.json', valid: validSatellite },
  // GISTDA's recurrent flooding of the pilot by subdistrict (a statistic, built by hand once), for the pin card
  floodFreq: { path: 'ref/flood_freq.json', valid: validFloodFreq },
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
  const [news, setNews] = useState<RefSlot<SituationReport>>(IDLE);
  const [dams, setDams] = useState<RefSlot<DamReport>>(IDLE);
  const [weather, setWeather] = useState<RefSlot<WeatherToday>>(IDLE);
  const [outlook, setOutlook] = useState<RefSlot<RainOutlook>>(IDLE);
  const [rivers, setRivers] = useState<RefSlot<RiverForecast>>(IDLE);
  const [overview, setOverview] = useState<RefSlot<SummaryOverview>>(IDLE);
  const [boundaries, setBoundaries] = useState<RefSlot<Boundaries>>(IDLE);
  const [riverLines, setRiverLines] = useState<RefSlot<RiverLines>>(IDLE);
  const [flows, setFlows] = useState<RefSlot<RidFlows>>(IDLE);
  const [canalLines, setCanalLines] = useState<RefSlot<CanalLines>>(IDLE);
  const [canals, setCanals] = useState<RefSlot<CanalOutlook>>(IDLE);
  const [satellite, setSatellite] = useState<RefSlot<SatelliteFloods>>(IDLE);
  const [floodFreq, setFloodFreq] = useState<RefSlot<FloodFrequency>>(IDLE);
  const current = useRef<Snapshot | null>(null);
  const settings = useRef<RuntimeConfig | null>(null);
  const flight = useRef<AbortController | null>(null);
  const wanted = useRef(
    new Set<RefName>([
      'cameras',
      'forecast',
      'floods',
      'water',
      'rain',
      'flooding',
      'news',
      'dams',
      'weather',
      'outlook',
      'rivers',
      'overview',
      'flows',
      'canalLines',
      'canals',
      'satellite',
      'floodFreq',
    ]),
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
        fetch,
        undefined,
        // live data is checked against the manifest's hashes (M47); the examples are listed with placeholders
        settings.current!.DATA_MODE === 'live',
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
      news: new RefSync(REF_FILES.news.path, loader('news'), (slot) =>
        setNews(slot as RefSlot<SituationReport>),
      ),
      dams: new RefSync(REF_FILES.dams.path, loader('dams'), (slot) =>
        setDams(slot as RefSlot<DamReport>),
      ),
      weather: new RefSync(REF_FILES.weather.path, loader('weather'), (slot) =>
        setWeather(slot as RefSlot<WeatherToday>),
      ),
      outlook: new RefSync(REF_FILES.outlook.path, loader('outlook'), (slot) =>
        setOutlook(slot as RefSlot<RainOutlook>),
      ),
      rivers: new RefSync(REF_FILES.rivers.path, loader('rivers'), (slot) =>
        setRivers(slot as RefSlot<RiverForecast>),
      ),
      overview: new RefSync(REF_FILES.overview.path, loader('overview'), (slot) =>
        setOverview(slot as RefSlot<SummaryOverview>),
      ),
      boundaries: new RefSync(REF_FILES.boundaries.path, loader('boundaries'), (slot) =>
        setBoundaries(slot as RefSlot<Boundaries>),
      ),
      riverLines: new RefSync(REF_FILES.riverLines.path, loader('riverLines'), (slot) =>
        setRiverLines(slot as RefSlot<RiverLines>),
      ),
      flows: new RefSync(REF_FILES.flows.path, loader('flows'), (slot) =>
        setFlows(slot as RefSlot<RidFlows>),
      ),
      canalLines: new RefSync(REF_FILES.canalLines.path, loader('canalLines'), (slot) =>
        setCanalLines(slot as RefSlot<CanalLines>),
      ),
      canals: new RefSync(REF_FILES.canals.path, loader('canals'), (slot) =>
        setCanals(slot as RefSlot<CanalOutlook>),
      ),
      satellite: new RefSync(REF_FILES.satellite.path, loader('satellite'), (slot) =>
        setSatellite(slot as RefSlot<SatelliteFloods>),
      ),
      floodFreq: new RefSync(REF_FILES.floodFreq.path, loader('floodFreq'), (slot) =>
        setFloodFreq(slot as RefSlot<FloodFrequency>),
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
  const loadBoundaries = useCallback(() => want('boundaries'), [want]);
  const loadRiverLines = useCallback(() => want('riverLines'), [want]);

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
    news: news.value,
    dams: dams.value,
    weather: weather.value,
    outlook: outlook.value,
    outlookState: outlook.state,
    rivers: rivers.value,
    overview: overview.value,
    overviewState: overview.state,
    boundaries: boundaries.value,
    loadBoundaries,
    riverLines: riverLines.value,
    loadRiverLines,
    flows: flows.value,
    canalLines: canalLines.value,
    canals: canals.value,
    satellite: satellite.value,
    floodFreq: floodFreq.value,
  };
}
