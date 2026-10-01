import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Camera as CameraIcon,
  ChevronUp,
  CircleHelp,
  Moon,
  Sun,
  CloudRain,
  Droplet,
  Droplets,
  Info,
  Layers as LayersIcon,
  SquareDashed,
  Waves,
  RefreshCw,
  ShieldAlert,
  Umbrella,
  Dam,
  Thermometer,
  TrendingUp,
  X,
} from 'lucide-react';
import { formatTime, isStale, radarAgeMinutes, staleAfter, visibleAlerts } from './data';
import { Fold } from './Fold';
import { useData } from './useData';
import MapBoundary from './MapBoundary';
import { AlertDetails, Hotlines, Overview, PinCard, RoadCard } from './Panel';
import PlaceSearch from './PlaceSearch';
import { applyTheme, storedTheme, storeTheme, systemTheme, type Theme } from './theme';
import { loadFavorite, saveFavorite, type Favorite } from './favorite';
import FavoriteForecast from './FavoriteForecast';
import { distanceM } from './roads';
import Timeline, { type TimeStep } from './Timeline';
import { FORECAST_LEVELS, forecastAreas, RAIN_LEGEND } from './forecast';
import { RIVER_CLASSES } from './rivers';
import { dateTime, feedTrust, LEVEL_FILL, LEVEL_LABEL, worstLevel, type Level } from './alerts';
import { nearestSubdistrict, type FoundPlace } from './places';
import {
  DAM_CLASSES,
  DAY_RAIN_CLASSES,
  RAIN_HOUR_CLASSES,
  RAIN_OLD_COLOR,
  roadKey as roadNameKey,
} from './bkk';
import type { Focus, Layers, LngLat } from './MapView';
import { outlineBounds, WATCH_COLOR, watchAreas, watchShapes } from './overview';

const MapView = lazy(() => import('./MapView'));
// "/" in development, "/fontokmai/" on GitHub Pages (WEB_BASE at build time)
const BASE = import.meta.env.BASE_URL;
import { BANK_COLORS } from './overflow';

const disclaimer =
  'fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยาหรือหน่วยงานเจ้าของข้อมูล';
const LEGEND_LEVELS: Level[] = ['extreme', 'severe', 'moderate'];
// a forecast is refreshed every 6 hours; older than 12 hours means two refreshes failed
const FORECAST_STALE_MS = 12 * 3_600_000;

function readPin(): LngLat | null {
  const raw = new URLSearchParams(location.search).get('pin');
  const [lat, lon] = (raw ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? [lon, lat]
    : null;
}
function setParam(name: string, value: string | null) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  history.replaceState(null, '', url);
}

export default function App() {
  const data = useData();
  const {
    snapshot,
    config,
    error,
    loading,
    now,
    refresh,
    cameras,
    camerasState,
    roads,
    roadsState,
    loadRoads,
    places,
    placesState,
    loadPlaces,
    forecast,
    forecastState,
    floods,
    floodsState,
    water,
    waterState,
    rain,
    rainState,
    flooding,
    news,
    dams,
    weather,
    rivers,
    overview,
    boundaries,
    loadBoundaries,
  } = data;
  const [layers, setLayers] = useState<Layers>({
    alerts: true,
    radar: true,
    cameras: true,
    floods: true,
    water: true,
    rain: true,
    dams: true,
    weather: true,
    rivers: true,
    watch: true,
  });
  // the time the map shows: null = now (the latest radar frame); otherwise a radar or forecast time
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [radarOpacity, setRadarOpacity] = useState(0.75);
  const [pin, setPinState] = useState<LngLat | null>(readPin);
  // the place chosen in the search box, while the pin stays where the search put it
  const [pinPlace, setPinPlace] = useState<FoundPlace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('alert'),
  );
  const [roadKey, setRoadKey] = useState<string | null>(null);
  // a shared link with ?pin= opens zoomed in on that pin
  const [focus, setFocus] = useState<Focus | null>(() => {
    const start = readPin();
    return start
      ? {
          key: 'start',
          bounds: [
            [start[0] - 0.03, start[1] - 0.03],
            [start[0] + 0.03, start[1] + 0.03],
          ],
        }
      : null;
  });
  const [layersOpen, setLayersOpen] = useState(false);
  // a flood report chosen in the list opens on the map only; the list stays where it is
  const [openFlood, setOpenFlood] = useState<{ id: string; key: string } | null>(null);
  const [floodPopupId, setFloodPopupId] = useState<string | null>(null);
  // on a phone the map sits above the list: a chip on the map leads back to the chosen report
  const [backToList, setBackToList] = useState<string | null>(null);
  // a road of the department's report to show on the map once the road history has loaded
  const [roadToShow, setRoadToShow] = useState<string | null>(null);
  const [favorite, setFavoriteState] = useState<Favorite | null>(loadFavorite);
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  useEffect(() => applyTheme(theme), [theme]);
  // without a choice of their own, follow the device when it switches between light and dark
  useEffect(() => {
    if (storedTheme() || typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      if (!storedTheme()) setTheme(query.matches ? 'dark' : 'light');
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  // the colour bars always show; what each pin means folds behind a button (it would cover the map)
  const [legendOpen, setLegendOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);

  const alerts = useMemo(() => visibleAlerts(snapshot?.feed, now), [snapshot, now]);
  // the coloured strip under the header: the most severe official alert in effect now
  const worstNow = worstLevel(alerts);
  const situation: Level | 'ok' | 'unknown' =
    worstNow ?? (feedTrust(snapshot, now) === 'ok' ? 'ok' : 'unknown');
  const situationText =
    situation === 'ok'
      ? 'ตอนนี้ไม่มีประกาศเตือนภัยที่มีผล'
      : situation === 'unknown'
        ? 'ยังตรวจประกาศตอนนี้ไม่ได้'
        : `ประกาศที่รุนแรงที่สุดตอนนี้: ${LEVEL_LABEL[situation]}`;
  // the flood history and area names are only needed once a pin exists (also one from a link)
  useEffect(() => {
    if (pin && snapshot) {
      void loadRoads();
      void loadPlaces();
    }
  }, [pin, snapshot, loadRoads, loadPlaces]);
  const selected = alerts.find((a) => a.event_id === selectedId);
  const road = roads?.roads.find((r) => r.key === roadKey) ?? null;
  const frames = useMemo(() => snapshot?.radar?.frames ?? [], [snapshot]);
  const steps = useMemo<TimeStep[]>(() => {
    const past: TimeStep[] = frames.map((frame, i) => ({
      kind: 'radar',
      time: Date.parse(frame.time),
      frame: i,
      latest: i === frames.length - 1,
    }));
    const future: TimeStep[] = (forecast?.hours ?? []).flatMap((hour, i) => {
      const time = Date.parse(hour);
      return time > now ? [{ kind: 'forecast' as const, time, hour: i }] : [];
    });
    return [...(past.length ? past : [{ kind: 'now' as const, time: now }]), ...future];
  }, [frames, forecast, now]);
  const nowIndex = Math.max(frames.length - 1, 0);
  const chosen = selectedTime === null ? -1 : steps.findIndex((s) => s.time === selectedTime);
  const stepIndex = chosen >= 0 ? chosen : nowIndex;
  const step = steps[stepIndex];
  const rainLegend = snapshot?.radar?.legend ?? RAIN_LEGEND;
  // the files of Bangkok's DXS arrive when someone in Thailand sends them (D31), not every round: their newest time
  // is the one way to see that an update arrived
  const dxsAt = [water, rain, flooding, news, dams, weather]
    .map((file) => (file ? Date.parse(file.fetched_at) : NaN))
    .filter((time) => !Number.isNaN(time))
    .reduce((newest, time) => Math.max(newest, time), 0);
  // an empty legend means the producer could not match the frame to TMD's colour bar: no scale is drawn
  const keyColours =
    step.kind === 'forecast'
      ? FORECAST_LEVELS.map((level) => level.color)
      : [...rainLegend]
          .reverse()
          .filter((item) => item.min_mm_per_hr !== null && item.min_mm_per_hr > 0)
          .map((item) => item.color);
  const colourKey = layers.alerts || (layers.radar && (step.kind !== 'now' || frames.length > 0));
  const bankKey = layers.water && step.kind !== 'forecast' && !!water?.bank_observations?.length;
  const pinKey =
    layers.cameras ||
    (step.kind !== 'forecast' &&
      (layers.floods ||
        (layers.water && !!water) ||
        (layers.rain && !!rain) ||
        (layers.dams && !!dams) ||
        (layers.rivers && !!rivers) ||
        (layers.weather && !!weather)));
  // outlines of the summary's places; the file of outlines loads once there is something to outline
  const areas = useMemo(
    () => (layers.watch ? watchAreas(overview, now) : []),
    [layers.watch, overview, now],
  );
  const outlining = areas.length > 0;
  useEffect(() => {
    if (outlining) void loadBoundaries();
  }, [outlining, loadBoundaries]);
  // the clock ticks every 15 s: the map's outlines change only when the places do
  const areaKey = areas.map((area) => `${area.when}:${area.code}`).join(' ');
  const watch = useMemo(() => watchShapes(areas, boundaries), [areaKey, boundaries]);
  const watchKey = watch.features.length > 0;
  const forecastLayer = useMemo(
    () => (step.kind === 'forecast' && forecast ? forecastAreas(forecast, step.hour) : null),
    [step, forecast],
  );
  // alert zones as they stand at the chosen time (only alerts already issued)
  const mapTime = step.kind === 'forecast' ? step.time - 1_800_000 : now;
  const mapAlerts = useMemo(
    () => (mapTime === now ? alerts : visibleAlerts(snapshot?.feed, mapTime)),
    [alerts, snapshot, mapTime, now],
  );
  const stale = snapshot ? isStale(snapshot.manifest, now) : false;
  const partial =
    snapshot?.manifest.completeness === 'partial' ||
    snapshot?.manifest.source_status.some((s) => s.status !== 'ok');
  const isExample = config?.DATA_MODE === 'example' || snapshot?.manifest.writer === 'example';
  const radarAge = radarAgeMinutes(snapshot?.radar, now);
  // a pin dropped on the map is named after the nearest subdistrict point
  const nearby = useMemo(
    () => (pin && places && !pinPlace ? nearestSubdistrict(places, pin) : null),
    [pin, places, pinPlace],
  );
  const pinTitle = pinPlace?.title ?? (nearby ? nearby.place.label.split(' ')[0] : null);

  const setPin = (point: LngLat | null, place: FoundPlace | null = null) => {
    setBackToList(null);
    setPinState(point);
    setPinPlace(place);
    setSelectedId(null);
    setRoadKey(null);
    setParam('alert', null);
    setParam('pin', point ? `${point[1].toFixed(5)},${point[0].toFixed(5)}` : null);
    if (point) void loadRoads();
  };
  const selectAlert = (id: string | null) => {
    setSelectedId(id);
    setRoadKey(null);
    setParam('alert', id);
    panel.current?.scrollTo({ top: 0 });
  };
  const setFavorite = (next: Favorite | null) => {
    saveFavorite(next);
    setFavoriteState(next);
  };
  const pinIsFavorite = !!favorite && !!pin && distanceM(favorite.location, pin) < 30;
  const openFavorite = () => {
    if (!favorite) return;
    setPin(favorite.location);
    const [lon, lat] = favorite.location;
    setFocus({
      key: `favorite:${Date.now()}`,
      bounds: [
        [lon - 0.02, lat - 0.02],
        [lon + 0.02, lat + 0.02],
      ],
    });
    panel.current?.scrollTo({ top: 0 });
  };
  const openPlace = (place: FoundPlace) => {
    setPin(place.location, place);
    setFocus({ key: `${place.id}:${Date.now()}`, bounds: place.bounds, maxZoom: place.maxZoom });
    panel.current?.scrollTo({ top: 0 });
  };
  const openRoad = (key: string) => {
    const found = roads?.roads.find((r) => r.key === key);
    setRoadKey(key);
    if (found?.points.length) {
      const xs = found.points.map((p) => p[0]);
      const ys = found.points.map((p) => p[1]);
      setFocus({
        key,
        bounds: [
          [Math.min(...xs), Math.min(...ys)],
          [Math.max(...xs), Math.max(...ys)],
        ],
      });
    }
    panel.current?.scrollTo({ top: 0 });
  };
  const openFloodReport = (id: string) => {
    // the reports are drawn for now, not for a forecast hour, and only while their layer is on
    setSelectedTime(null);
    setPlaying(false);
    setLayers((current) => (current.floods ? current : { ...current, floods: true }));
    setOpenFlood({ id, key: `${id}:${Date.now()}` });
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches) {
      setBackToList(id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  useEffect(() => {
    if (!roadToShow || !roads) return;
    const found = roads.roads.find((r) => roadNameKey(r.name_th) === roadNameKey(roadToShow));
    setRoadToShow(null);
    if (!found?.points.length) return;
    const xs = found.points.map((p) => p[0]);
    const ys = found.points.map((p) => p[1]);
    setFocus({
      key: `road:${found.key}:${Date.now()}`,
      bounds: [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
    });
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches)
      window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [roadToShow, roads]);
  const toggle = (name: keyof Layers) =>
    setLayers((current) => ({ ...current, [name]: !current[name] }));

  return (
    <div className="app-shell">
      <a href="#panel" className="skip-link">
        ข้ามไปแถบข้อมูล
      </a>
      <header className="topbar">
        <a className="brand" href={BASE}>
          <span className="brand-symbol">
            <Droplets size={22} strokeWidth={1.8} />
          </span>
          <span>
            <strong>ฝนตกไหม</strong>
            <small>fontokmai</small>
          </span>
        </a>
        <PlaceSearch
          places={places}
          placesState={placesState}
          roads={roads}
          roadsState={roadsState}
          onOpen={() => {
            void loadPlaces();
            void loadRoads();
          }}
          onPlace={openPlace}
          onRoad={openRoad}
        />
        <div className={`data-chip ${stale || partial || error ? 'attention' : ''}`} role="status">
          <span className="status-dot" />
          {!snapshot
            ? loading
              ? 'กำลังโหลด…'
              : 'ยังไม่มีข้อมูล'
            : stale
              ? 'ข้อมูลไม่อัปเดต'
              : `ข้อมูล ${formatTime(snapshot.manifest.generated_at).replace(/^.* /, '')} น.`}
          <button
            className={`icon-button ${loading ? 'is-loading' : ''}`}
            disabled={loading}
            onClick={() => void refresh()}
            aria-label="ตรวจข้อมูลอีกครั้ง"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <button
          className="theme-toggle"
          aria-label={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            storeTheme(next);
            setTheme(next);
          }}
        >
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <a className="help-link" href={`${BASE}method/`} aria-label="อ่านแผนที่อย่างไร">
          <CircleHelp size={20} />
        </a>
      </header>
      <div className={`situation-strip situation-${situation}`} role="note" title={situationText}>
        <span className="sr-only">{situationText}</span>
      </div>

      <main
        className={`stage ${steps.length > 1 ? 'has-timeline' : ''} ${step.kind === 'forecast' ? 'forecast-mode' : ''}`}
      >
        <MapBoundary onList={() => panel.current?.focus()}>
          <Suspense fallback={<div className="map-loading">กำลังเตรียมแผนที่…</div>}>
            <MapView
              alerts={mapAlerts}
              now={mapTime}
              selectedAlertId={selectedId}
              radar={snapshot?.radar ?? null}
              dataBase={config?.DATA_BASE_URL ?? null}
              radarFrame={step.kind === 'radar' ? step.frame : null}
              forecastAreas={forecastLayer}
              radarOpacity={radarOpacity}
              cameras={cameras?.cameras ?? []}
              floods={step.kind === 'forecast' ? [] : (floods?.reports ?? [])}
              water={step.kind === 'forecast' ? null : water}
              rain={step.kind === 'forecast' ? null : rain}
              dams={step.kind === 'forecast' ? null : dams}
              weather={step.kind === 'forecast' ? null : weather}
              rivers={step.kind === 'forecast' ? null : rivers}
              watch={watch}
              layers={layers}
              pin={pin}
              pinLabel={pinTitle}
              focus={focus}
              onPin={(point) => setPin(point)}
              favoriteLabel={favorite?.label ?? null}
              onFavorite={openFavorite}
              theme={theme}
              onList={() => panel.current?.focus()}
              openFlood={openFlood}
              onFloodPopup={setFloodPopupId}
            />
          </Suspense>
        </MapBoundary>

        {backToList && (
          <button
            className="back-to-list"
            onClick={() => {
              document
                .getElementById(`flood-${backToList}`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              setBackToList(null);
            }}
          >
            <ArrowDown size={16} /> กลับไปที่รายการน้ำท่วม
          </button>
        )}

        <Timeline
          steps={steps}
          index={stepIndex}
          nowIndex={nowIndex}
          now={now}
          playing={playing}
          forecastStale={
            forecast !== null && now - Date.parse(forecast.fetched_at) > FORECAST_STALE_MS
          }
          onChange={(index) => setSelectedTime(index === nowIndex ? null : steps[index].time)}
          onPlay={setPlaying}
        />

        <div className={`layer-control ${layersOpen ? 'open' : ''}`}>
          <button
            className="layer-toggle"
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((open) => !open)}
          >
            <LayersIcon size={18} /> ชั้นข้อมูล
          </button>
          <div className="layer-options" role="group" aria-label="เลือกชั้นข้อมูลบนแผนที่">
            <button aria-pressed={layers.alerts} onClick={() => toggle('alerts')}>
              <ShieldAlert size={16} /> ประกาศเตือนภัย
            </button>
            <button aria-pressed={layers.radar} onClick={() => toggle('radar')}>
              <CloudRain size={16} /> ฝน (เรดาร์และพยากรณ์)
            </button>
            <button aria-pressed={layers.cameras} onClick={() => toggle('cameras')}>
              <CameraIcon size={16} /> กล้อง CCTV
            </button>
            <button aria-pressed={layers.floods} onClick={() => toggle('floods')}>
              <Waves size={16} /> รายงานน้ำท่วมตอนนี้
            </button>
            {/* the Bangkok layers appear once their files are published */}
            {water && (
              <button aria-pressed={layers.water} onClick={() => toggle('water')}>
                <Droplet size={16} /> ระดับน้ำคลอง กทม.
              </button>
            )}
            {rain && (
              <button aria-pressed={layers.rain} onClick={() => toggle('rain')}>
                <Umbrella size={16} /> ฝนวัดจริง กทม.
              </button>
            )}
            {dams && (
              <button aria-pressed={layers.dams} onClick={() => toggle('dams')}>
                <Dam size={16} /> เขื่อนใหญ่
              </button>
            )}
            {weather && (
              <button aria-pressed={layers.weather} onClick={() => toggle('weather')}>
                <Thermometer size={16} /> สถานีกรมอุตุฯ
              </button>
            )}
            {rivers && (
              <button aria-pressed={layers.rivers} onClick={() => toggle('rivers')}>
                <TrendingUp size={16} /> แนวโน้มน้ำแม่น้ำ
              </button>
            )}
            {overview && (
              <button aria-pressed={layers.watch} onClick={() => toggle('watch')}>
                <SquareDashed size={16} /> กรอบพื้นที่ที่ต้องระวัง
              </button>
            )}
            {layers.radar && (
              <label className="slider">
                <span>ความทึบชั้นฝน {Math.round(radarOpacity * 100)}%</span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={radarOpacity}
                  onChange={(event) => setRadarOpacity(Number(event.target.value))}
                />
              </label>
            )}
          </div>
        </div>

        {(colourKey || pinKey || bankKey || watchKey) && (
          <div className={`map-legend ${legendOpen ? 'open' : ''}`} aria-label="คำอธิบายสี">
            {watchKey && (
              <div className="legend-row legend-watch" aria-label="กรอบพื้นที่จากการ์ดสรุป">
                <span>
                  <i className="legend-outline" style={{ borderColor: WATCH_COLOR.now }} />{' '}
                  ต้องระวังตอนนี้
                </span>
                <span>
                  <i className="legend-outline next" style={{ borderColor: WATCH_COLOR.next }} />{' '}
                  เตรียมรับมือ
                </span>
                <small>เกณฑ์ของเว็บ ไม่ใช่ประกาศ</small>
              </div>
            )}
            {bankKey && (
              <div className="legend-row bank-key" aria-label="สีระดับน้ำเทียบตลิ่ง">
                <span>ตลิ่ง:</span>
                <span>
                  <i style={{ background: BANK_COLORS.above_bank }} /> เกิน
                </span>
                <span>
                  <i style={{ background: BANK_COLORS.at_bank }} /> ถึง
                </span>
                <span>
                  <i style={{ background: BANK_COLORS.below_bank }} /> ต่ำกว่า
                </span>
                <span>
                  <i style={{ background: BANK_COLORS.unknown }} /> ไม่ทราบ
                </span>
              </div>
            )}
            {layers.alerts && (
              <div className="legend-row legend-levels">
                {LEGEND_LEVELS.map((level) => (
                  <span key={level}>
                    <i style={{ background: LEVEL_FILL[level] }} /> {LEVEL_LABEL[level]}
                  </span>
                ))}
              </div>
            )}
            {layers.radar && (step.kind !== 'now' || frames.length > 0) && (
              <div className="legend-row radar-scale">
                <span>{step.kind === 'forecast' ? 'พยากรณ์ฝน' : 'ฝน'}</span>
                {keyColours.length ? (
                  <>
                    <span
                      className="radar-gradient"
                      style={{ background: `linear-gradient(90deg, ${keyColours.join(', ')})` }}
                    />
                    <span>หนัก</span>
                  </>
                ) : (
                  <span>สีตามภาพของกรมอุตุฯ</span>
                )}
                {step.kind === 'radar' && radarAge !== null && radarAge > 45 && (
                  <b className="stale-mark">เก่า</b>
                )}
              </div>
            )}
            {layers.radar && step.kind === 'forecast' && (
              <div className="legend-row legend-note">
                <small>ระบายสีตั้งแต่ 0.5 มม./ชม. · ไม่มีสีไม่ได้แปลว่าไม่มีฝน</small>
              </div>
            )}
            <div id="legend-pins" className="legend-pins" hidden={!legendOpen}>
              {layers.floods && step.kind !== 'forecast' && (
                <div className="legend-row">
                  <span>
                    <i className="legend-pin legend-flood" /> รายงานน้ำท่วม (สีอ่อน =
                    ครบเวลารายงานแล้ว)
                  </span>
                </div>
              )}
              {(layers.cameras || (layers.floods && step.kind !== 'forecast')) && (
                <div className="legend-row">
                  <span>
                    <i className="legend-bubble">3</i> จุดที่อยู่ใกล้กัน แตะเพื่อซูมเข้า
                  </span>
                </div>
              )}
              {layers.water && water && step.kind !== 'forecast' && (
                <div className="legend-row">
                  <span>
                    <i className="legend-pin legend-water" /> ระดับน้ำคลอง กทม. (เทา =
                    ไม่มีค่าล่าสุด)
                  </span>
                </div>
              )}
              {layers.rain && rain && step.kind !== 'forecast' && (
                <div className="legend-row rain-hour">
                  <span>ฝนวัดจริง 1 ชม. (มม.)</span>
                  {RAIN_HOUR_CLASSES.map((item) => (
                    <span key={item.pin}>
                      <i className="legend-pin" style={{ background: item.color }} /> {item.label}
                      {item.range && <small>{item.range}</small>}
                    </span>
                  ))}
                  <span>
                    <i className="legend-pin" style={{ background: RAIN_OLD_COLOR }} />{' '}
                    ไม่มีค่าล่าสุด
                  </span>
                </div>
              )}
              {layers.dams && dams && step.kind !== 'forecast' && (
                <div className="legend-row rain-hour">
                  <span>เขื่อน (น้ำในอ่าง)</span>
                  {DAM_CLASSES.map((item) => (
                    <span key={item.pin}>
                      <i className="legend-pin" style={{ background: item.color }} /> {item.label}
                      {item.range && <small>{item.range}</small>}
                    </span>
                  ))}
                </div>
              )}
              {layers.weather && weather && step.kind !== 'forecast' && (
                <div className="legend-row rain-hour">
                  <span>สถานีกรมอุตุฯ ฝน 24 ชม. (มม.)</span>
                  {DAY_RAIN_CLASSES.map((item) => (
                    <span key={item.pin}>
                      <i className="legend-pin" style={{ background: item.color }} /> {item.label}
                      {item.range && <small>{item.range}</small>}
                    </span>
                  ))}
                </div>
              )}
              {layers.rivers && rivers && step.kind !== 'forecast' && (
                <div className="legend-row rain-hour">
                  <span>แนวโน้มน้ำแม่น้ำ 7 วัน (แบบจำลอง · ทดลอง)</span>
                  {RIVER_CLASSES.map((item) => (
                    <span key={item.pin}>
                      <i className="legend-pin" style={{ background: item.color }} /> {item.label}
                    </span>
                  ))}
                </div>
              )}
              {layers.cameras && (
                <div className="legend-row">
                  <span>
                    <i className="legend-pin legend-camera" /> กล้อง (แตะหมุดเพื่อเปิดดู)
                    {camerasState === 'error' && ' · โหลดทะเบียนกล้องไม่สำเร็จ'}
                  </span>
                </div>
              )}
            </div>
            {pinKey && (
              <button
                className="legend-toggle"
                aria-expanded={legendOpen}
                aria-controls="legend-pins"
                onClick={() => setLegendOpen((open) => !open)}
              >
                <ChevronUp size={14} className="legend-toggle-chevron" aria-hidden="true" />
                <Info size={16} className="legend-toggle-info" aria-hidden="true" />
                <span className="legend-toggle-text">{legendOpen ? 'ย่อ' : 'ความหมายหมุด'}</span>
              </button>
            )}
          </div>
        )}
      </main>

      <aside id="panel" className="panel" ref={panel} tabIndex={-1} aria-label="ข้อมูล">
        {isExample && (
          <div className="notice example-banner" role="note">
            <Info size={17} />
            <div>
              <strong>กำลังแสดงชุดข้อมูลตัวอย่าง</strong>
              <span>สำหรับทดสอบเว็บ ไม่ใช่สถานการณ์ปัจจุบัน</span>
            </div>
          </div>
        )}
        {!config && !error && (
          <p className="notice" role="status">
            กำลังอ่านการตั้งค่าแหล่งข้อมูล…
          </p>
        )}
        {error && (
          <div className="notice warning" role="status">
            <Info size={17} />
            <div>
              <strong>
                {error.code === 'mixed' ? 'กำลังอัปเดต · ไฟล์ข้อมูลยังไม่ตรงกัน' : error.message}
              </strong>
              <span>
                {snapshot
                  ? 'แสดงชุดข้อมูลล่าสุดที่โหลดครบ กรุณาตรวจเวลาข้อมูล'
                  : 'ยังไม่มีชุดข้อมูลที่ตรวจสอบครบ จึงยังแสดงประกาศไม่ได้'}
              </span>
            </div>
          </div>
        )}
        {stale && (
          <div className="notice warning" role="status">
            <RefreshCw size={16} />
            <div>
              <strong>
                ข้อมูลไม่อัปเดต ตั้งแต่ {formatTime(staleAfter(snapshot!.manifest))} น.
              </strong>
              <span>สถานะประกาศอาจเปลี่ยนแล้ว โปรดตรวจสอบกับกรมอุตุนิยมวิทยา</span>
            </div>
          </div>
        )}
        {partial && (
          <div className="notice warning" role="status">
            <Info size={16} />
            <div>
              <strong>แหล่งข้อมูลส่งข้อมูลไม่ครบ</strong>
              <span>กำลังแสดงข้อมูลที่เก็บไว้ พร้อมเวลาที่ดึงสำเร็จครั้งล่าสุดด้านล่าง</span>
            </div>
          </div>
        )}

        {favorite && (
          <FavoriteForecast
            favorite={favorite}
            forecast={forecast}
            state={forecastState}
            now={now}
            onOpen={openFavorite}
          />
        )}

        {road && roads ? (
          <RoadCard road={road} history={roads} onClose={() => setRoadKey(null)} />
        ) : selected ? (
          <AlertDetails alert={selected} now={now} onClose={() => selectAlert(null)} />
        ) : pin ? (
          <PinCard
            pin={pin}
            place={pinPlace}
            nearby={nearby}
            snapshot={snapshot}
            alerts={alerts}
            now={now}
            dataBase={config?.DATA_BASE_URL ?? null}
            step={step}
            forecast={forecast}
            forecastState={forecastState}
            roads={roads}
            roadsState={roadsState}
            cameras={cameras?.cameras ?? []}
            camerasState={camerasState}
            floods={floods}
            floodsState={floodsState}
            water={water}
            waterState={waterState}
            rain={rain}
            rainState={rainState}
            flooding={flooding}
            onClose={() => setPin(null)}
            onSelectAlert={selectAlert}
            onRoad={(r) => openRoad(r.key)}
            favorite={pinIsFavorite}
            onFavorite={() =>
              setFavorite(
                pinIsFavorite
                  ? null
                  : {
                      location: pin,
                      label:
                        pinPlace?.title ??
                        (nearby ? nearby.place.label.split(' ')[0] : null) ??
                        `${pin[1].toFixed(4)}, ${pin[0].toFixed(4)}`,
                    },
              )
            }
          />
        ) : (
          <>
            {selectedId && (
              <div className="notice" role="status">
                <Info size={16} />
                <span>
                  ประกาศจากลิงก์นี้ไม่มีในรายการที่มีผล อาจสิ้นสุด ถูกยกเลิก
                  หรือไม่อยู่ในชุดข้อมูลนี้
                </span>
                <button className="icon-button" aria-label="ปิด" onClick={() => selectAlert(null)}>
                  <X size={16} />
                </button>
              </div>
            )}
            <Overview
              snapshot={snapshot}
              alerts={alerts}
              now={now}
              loading={loading}
              floods={floods}
              floodsState={floodsState}
              onSelectAlert={selectAlert}
              openFloodId={floodPopupId}
              onFlood={(report) => openFloodReport(report.id)}
              flooding={flooding}
              onRoadName={(name) => {
                setRoadToShow(name);
                void loadRoads();
              }}
              news={news}
              dams={dams}
              water={water}
              onBank={(item) => {
                const coords =
                  item.kind === 'measurement'
                    ? [item.geometry.coordinates]
                    : item.geometry.coordinates;
                const xs = coords.map((p) => p[0]),
                  ys = coords.map((p) => p[1]);
                setSelectedTime(null);
                setLayers((current) => ({ ...current, water: true }));
                setFocus({
                  key: `bank:${item.id}:${Date.now()}`,
                  maxZoom: 14,
                  bounds: [
                    [Math.min(...xs) - 0.002, Math.min(...ys) - 0.002],
                    [Math.max(...xs) + 0.002, Math.max(...ys) + 0.002],
                  ],
                });
                if (typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches)
                  window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              summary={overview}
              onPlace={(item) => {
                // a district close, a province or river wider: the half size follows the item's zoom
                const half = 0.05 * 2 ** (12 - item.zoom);
                const [lon, lat] = item.location;
                setFocus({
                  key: `summary:${item.place_th}:${Date.now()}`,
                  bounds: [
                    [lon - half, lat - half],
                    [lon + half, lat + half],
                  ],
                  maxZoom: item.zoom,
                });
                if (typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches)
                  window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onPlaces={(items) => {
                // the districts of a province together: their outlines whole, or the box around their places
                const xs = items.map((item) => item.location[0]);
                const ys = items.map((item) => item.location[1]);
                const codes = items.flatMap((item) => (item.area_code ? [item.area_code] : []));
                const outlined = codes.length === items.length && outlineBounds(codes, boundaries);
                setFocus({
                  key: `summary-province:${items[0].place_th}:${Date.now()}`,
                  bounds: outlined || [
                    [Math.min(...xs) - 0.08, Math.min(...ys) - 0.08],
                    [Math.max(...xs) + 0.08, Math.max(...ys) + 0.08],
                  ],
                  maxZoom: 11,
                });
                if (typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches)
                  window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onDam={(location) => {
                setFocus({
                  key: `dam:${location.join(',')}:${Date.now()}`,
                  bounds: [
                    [location[0] - 0.05, location[1] - 0.05],
                    [location[0] + 0.05, location[1] + 0.05],
                  ],
                  maxZoom: 11,
                });
                setLayers((current) => (current.dams ? current : { ...current, dams: true }));
                if (typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches)
                  window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </>
        )}

        <Hotlines />

        <Fold
          id="data-status"
          headingId="data-status-heading"
          className="data-status"
          heading="สถานะข้อมูล"
        >
          <div className="source-times">
            {snapshot?.manifest.source_status.map((source) => (
              <div key={source.source_id}>
                <span>
                  {source.source_id === 'tmd_cap'
                    ? 'ประกาศกรมอุตุฯ'
                    : source.source_id === 'tmd_radar'
                      ? 'เรดาร์กรมอุตุฯ'
                      : source.source_id === 'longdo_floods'
                        ? 'รายงานน้ำท่วม (Longdo)'
                        : source.source_id === 'bma_dxs'
                          ? 'น้ำและฝน กทม. (DXS)'
                          : source.source_id}
                  :{' '}
                  {source.status === 'ok'
                    ? 'ดึงสำเร็จในรอบข้อมูลนี้'
                    : source.status === 'degraded'
                      ? 'ดึงได้บางฉบับ'
                      : 'ดึงข้อมูลไม่สำเร็จ'}
                </span>
                <small>
                  สำเร็จล่าสุด {formatTime(source.last_success_at)}
                  {source.last_success_at ? ' น.' : ''}
                </small>
              </div>
            )) ?? <span>ยังไม่มีข้อมูล</span>}
            {dxsAt > 0 &&
              !snapshot?.manifest.source_status.some(
                (source) => source.source_id === 'bma_dxs',
              ) && (
                <div data-testid="dxs-status">
                  <span>น้ำและฝน กทม. เขื่อน สถานีอุตุฯ (DXS): ข้อมูล ณ {dateTime(dxsAt)}</span>
                  <small>อัปเดตเป็นครั้งๆ ไม่ใช่ทุก 15 นาที</small>
                </div>
              )}
          </div>
          {snapshot?.feed && (
            <details className="history-details">
              <summary>ประกาศที่สิ้นสุดในชุดข้อมูล ({snapshot.feed.tombstones.length})</summary>
              <p>
                รายการสิ้นสุดจากต้นทาง ไม่แสดงเป็นประกาศที่มีผล · ตั้งแต่{' '}
                {formatTime(snapshot.feed.history_since)} น.
              </p>
              <ul>
                {snapshot.feed.tombstones.map((item) => (
                  <li key={item.event_id}>
                    <code>{item.event_id}</code>
                    <span>
                      {item.lifecycle_status === 'cancelled' ? 'ยกเลิก' : 'หมดอายุ'} ·{' '}
                      {formatTime(item.ended_at)} น.
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="quiet">
            เว็บตรวจข้อมูลทุก 1 นาทีเมื่อเปิดแท็บ · เวลาไทย (UTC+7) ·
            ความครบของไฟล์ไม่ใช่การรับรองความแม่น
          </p>
        </Fold>

        <footer className="panel-footer">
          <p>
            <strong>fontokmai by Takuma</strong> · {disclaimer}
          </p>
          <nav aria-label="ลิงก์ท้ายเว็บ">
            <a href={`${BASE}about/`}>เกี่ยวกับ</a>
            <a href={`${BASE}sources/`}>แหล่งข้อมูลและเครดิต</a>
            <a href={`${BASE}method/`}>วิธีอ่านข้อมูล</a>
            <a href={`${BASE}LICENSE`}>License</a>
            <a href={`${BASE}NOTICE`}>เครดิต</a>
          </nav>
        </footer>
      </aside>
    </div>
  );
}
