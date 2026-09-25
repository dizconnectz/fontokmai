import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera as CameraIcon,
  CircleHelp,
  CloudRain,
  Droplets,
  Info,
  Layers as LayersIcon,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatTime, isStale, radarAgeMinutes, staleAfter, visibleAlerts } from './data';
import { useData } from './useData';
import MapBoundary from './MapBoundary';
import { AlertDetails, Overview, PinCard, RoadCard } from './Panel';
import { LEVEL_FILL, LEVEL_LABEL, type Level } from './alerts';
import { searchRoads } from './roads';
import type { Focus, Layers, LngLat } from './MapView';

const MapView = lazy(() => import('./MapView'));
// "/" in development, "/fontokmai/" on GitHub Pages (WEB_BASE at build time)
const BASE = import.meta.env.BASE_URL;
const disclaimer =
  'fontokmai ไม่ได้เกี่ยวข้องหรือได้รับการสนับสนุนจากกรมอุตุนิยมวิทยาหรือหน่วยงานเจ้าของข้อมูล';
const LEGEND_LEVELS: Level[] = ['extreme', 'severe', 'moderate'];

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
  const { snapshot, config, error, loading, now, refresh, cameras, roads, roadsState, loadRoads } =
    data;
  const [layers, setLayers] = useState<Layers>({ alerts: true, radar: true, cameras: true });
  const [radarFrame, setRadarFrame] = useState<number | null>(null);
  const [radarOpacity, setRadarOpacity] = useState(0.75);
  const [pin, setPinState] = useState<LngLat | null>(readPin);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('alert'),
  );
  const [roadKey, setRoadKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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
  const panel = useRef<HTMLElement>(null);

  const alerts = useMemo(() => visibleAlerts(snapshot?.feed, now), [snapshot, now]);
  // the flood history is only needed once a pin exists (also for a pin that came with the link)
  useEffect(() => {
    if (pin && snapshot) void loadRoads();
  }, [pin, snapshot, loadRoads]);
  const selected = alerts.find((a) => a.event_id === selectedId);
  const road = roads?.roads.find((r) => r.key === roadKey) ?? null;
  const frames = snapshot?.radar?.frames ?? [];
  const frameIndex =
    radarFrame === null ? frames.length - 1 : Math.min(radarFrame, frames.length - 1);
  const stale = snapshot ? isStale(snapshot.manifest, now) : false;
  const partial =
    snapshot?.manifest.completeness === 'partial' ||
    snapshot?.manifest.source_status.some((s) => s.status !== 'ok');
  const isExample = config?.DATA_MODE === 'example' || snapshot?.manifest.writer === 'example';
  const radarAge = radarAgeMinutes(snapshot?.radar, now);
  const results = useMemo(
    () => (roads && query ? searchRoads(roads, query).slice(0, 8) : []),
    [roads, query],
  );

  const setPin = (point: LngLat | null) => {
    setPinState(point);
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
  const openRoad = (key: string) => {
    const found = roads?.roads.find((r) => r.key === key);
    setRoadKey(key);
    setQuery('');
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
        <div className="road-search">
          <label className="search-box">
            <Search size={17} />
            <span className="sr-only">ค้นหาถนนที่เคยน้ำท่วม</span>
            <input
              type="search"
              value={query}
              placeholder="ถนนนี้เคยท่วมไหม เช่น สุขุมวิท"
              onFocus={() => void loadRoads()}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
            />
          </label>
          {query && (
            <div className="search-results" role="region" aria-label="ผลค้นหาถนน">
              {roadsState === 'loading' && <p>กำลังโหลดประวัติน้ำท่วมถนน…</p>}
              {roadsState === 'missing' && <p>ยังไม่มีข้อมูลประวัติน้ำท่วมถนน</p>}
              {roads && results.length === 0 && (
                <p>ไม่พบรายงานของถนนนี้ใน กทม.–ปริมณฑล · ไม่ได้แปลว่าไม่เคยท่วม</p>
              )}
              {results.map((result) => (
                <button key={result.key} onClick={() => openRoad(result.key)}>
                  <strong>{result.kind === 'road' ? `ถ.${result.name_th}` : result.name_th}</strong>
                  <span>
                    {result.flood_days} วัน · ล่าสุด {Number(result.last_date.slice(0, 4)) + 543}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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
        <a className="help-link" href={`${BASE}method/`} aria-label="อ่านแผนที่อย่างไร">
          <CircleHelp size={20} />
        </a>
      </header>

      <main className="stage">
        <MapBoundary onList={() => panel.current?.focus()}>
          <Suspense fallback={<div className="map-loading">กำลังเตรียมแผนที่…</div>}>
            <MapView
              alerts={alerts}
              now={now}
              selectedAlertId={selectedId}
              radar={snapshot?.radar ?? null}
              dataBase={config?.DATA_BASE_URL ?? null}
              radarFrame={frameIndex}
              radarOpacity={radarOpacity}
              cameras={cameras?.cameras ?? []}
              layers={layers}
              pin={pin}
              focus={focus}
              onPin={setPin}
              onList={() => panel.current?.focus()}
            />
          </Suspense>
        </MapBoundary>

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
              <CloudRain size={16} /> ฝนตอนนี้ (เรดาร์)
            </button>
            <button aria-pressed={layers.cameras} onClick={() => toggle('cameras')}>
              <CameraIcon size={16} /> กล้อง CCTV
            </button>
            {layers.radar && frames.length > 1 && (
              <label className="slider">
                <span>เวลาเรดาร์ {formatTime(frames[frameIndex].time).replace(/^.* /, '')} น.</span>
                <input
                  type="range"
                  min={0}
                  max={frames.length - 1}
                  step={1}
                  value={frameIndex}
                  onChange={(event) => setRadarFrame(Number(event.target.value))}
                />
              </label>
            )}
            {layers.radar && frames.length > 0 && (
              <label className="slider">
                <span>ความทึบเรดาร์ {Math.round(radarOpacity * 100)}%</span>
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

        <div className="map-legend" aria-label="คำอธิบายสี">
          {layers.alerts && (
            <div className="legend-row">
              {LEGEND_LEVELS.map((level) => (
                <span key={level}>
                  <i style={{ background: LEVEL_FILL[level] }} /> {LEVEL_LABEL[level]}
                </span>
              ))}
            </div>
          )}
          {layers.radar && snapshot?.radar && snapshot.radar.frames.length > 0 && (
            <div className="legend-row radar-scale">
              <span>ฝน</span>
              <span
                className="radar-gradient"
                style={{
                  background: `linear-gradient(90deg, ${[...snapshot.radar.legend]
                    .reverse()
                    .filter((item) => item.min_mm_per_hr !== null)
                    .map((item) => item.color)
                    .join(', ')})`,
                }}
              />
              <span>หนัก</span>
              {radarAge !== null && radarAge > 45 && <b className="stale-mark">เก่า</b>}
            </div>
          )}
          {layers.cameras && (
            <div className="legend-row">
              <span>
                <i className="legend-camera" /> กล้อง (แตะเพื่อเปิดดู)
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
            snapshot={snapshot}
            alerts={alerts}
            now={now}
            dataBase={config?.DATA_BASE_URL ?? null}
            radarFrame={frameIndex}
            roads={roads}
            roadsState={roadsState}
            cameras={cameras?.cameras ?? []}
            onClose={() => setPin(null)}
            onSelectAlert={selectAlert}
            onRoad={(r) => openRoad(r.key)}
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
              onSelectAlert={selectAlert}
            />
          </>
        )}

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
