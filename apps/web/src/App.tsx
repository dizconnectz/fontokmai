import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Camera as CameraIcon,
  CircleHelp,
  Moon,
  Sun,
  CloudRain,
  Droplets,
  Info,
  Layers as LayersIcon,
  Palette,
  Waves,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatTime, isStale, radarAgeMinutes, staleAfter, visibleAlerts } from './data';
import { useData } from './useData';
import MapBoundary from './MapBoundary';
import { AlertDetails, Hotlines, Overview, PinCard, RoadCard } from './Panel';
import PlaceSearch from './PlaceSearch';
import { applyTheme, storedTheme, storeTheme, systemTheme, type Theme } from './theme';
import { loadFavorite, saveFavorite, type Favorite } from './favorite';
import { distanceM } from './roads';
import Timeline, { type TimeStep } from './Timeline';
import { FORECAST_LEVELS, forecastAreas, RAIN_LEGEND } from './forecast';
import { feedTrust, LEVEL_FILL, LEVEL_LABEL, worstLevel, type Level } from './alerts';
import { nearestSubdistrict, type FoundPlace } from './places';
import type { Focus, Layers, LngLat } from './MapView';

const MapView = lazy(() => import('./MapView'));
// "/" in development, "/fontokmai/" on GitHub Pages (WEB_BASE at build time)
const BASE = import.meta.env.BASE_URL;
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
  } = data;
  const [layers, setLayers] = useState<Layers>({
    alerts: true,
    radar: true,
    cameras: true,
    floods: true,
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
  // on a phone the colour key folds into a chip so it does not cover the pin; always open on wider screens
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

        <div className={`map-legend ${legendOpen ? 'open' : ''}`} aria-label="คำอธิบายสี">
          <button
            className="legend-toggle"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((open) => !open)}
          >
            <Palette size={15} /> สีบนแผนที่
          </button>
          {layers.alerts && (
            <div className="legend-row">
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
              <span
                className="radar-gradient"
                style={{
                  background: `linear-gradient(90deg, ${(step.kind === 'forecast'
                    ? FORECAST_LEVELS.map((level) => level.color)
                    : [...rainLegend]
                        .reverse()
                        .filter((item) => item.min_mm_per_hr !== null && item.min_mm_per_hr > 0)
                        .map((item) => item.color)
                  ).join(', ')})`,
                }}
              />
              <span>หนัก</span>
              {step.kind === 'radar' && radarAge !== null && radarAge > 45 && (
                <b className="stale-mark">เก่า</b>
              )}
            </div>
          )}
          {layers.floods && step.kind !== 'forecast' && (
            <div className="legend-row">
              <span>
                <i className="legend-pin legend-flood" /> รายงานน้ำท่วม (สีอ่อน = ครบเวลารายงานแล้ว)
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
          {layers.cameras && (
            <div className="legend-row">
              <span>
                <i className="legend-pin legend-camera" /> กล้อง (แตะหมุดเพื่อเปิดดู)
                {camerasState === 'error' && ' · โหลดทะเบียนกล้องไม่สำเร็จ'}
              </span>
            </div>
          )}
        </div>
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
              favoriteLabel={favorite?.label ?? null}
              onFavorite={openFavorite}
              onSelectAlert={selectAlert}
              openFloodId={floodPopupId}
              onFlood={(report) => openFloodReport(report.id)}
            />
          </>
        )}

        <Hotlines />

        <section
          id="data-status"
          className="panel-section data-status"
          aria-labelledby="data-status-heading"
        >
          <h2 id="data-status-heading">สถานะข้อมูล</h2>
          <div className="source-times">
            {snapshot?.manifest.source_status.map((source) => (
              <div key={source.source_id}>
                <span>
                  {source.source_id === 'tmd_cap'
                    ? 'ประกาศกรมอุตุฯ'
                    : source.source_id === 'tmd_radar'
                      ? 'เรดาร์กรมอุตุฯ'
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
        </section>

        <footer className="panel-footer">
          <p>
            <strong>fontokmai by Takuma</strong> · {disclaimer}
          </p>
          <nav aria-label="ลิงก์ท้ายเว็บ">
            <a href={`${BASE}sources/`}>แหล่งข้อมูล</a>
            <a href={`${BASE}method/`}>วิธีอ่านข้อมูล</a>
            <a href={`${BASE}LICENSE`}>License</a>
            <a href={`${BASE}NOTICE`}>เครดิต</a>
          </nav>
        </footer>
      </aside>
    </div>
  );
}
