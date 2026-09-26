import { useEffect, useRef, useState } from 'react';
import { Crosshair, Expand, LocateFixed, MapPin, Map as MapIcon, Star } from 'lucide-react';
import type {
  GeoJSONSource,
  ImageSource,
  Map as LibreMap,
  Marker,
  Popup,
  PositionAnchor,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, MultiPolygon, Point } from 'geojson';
import { displayStatus, formatTime, type Alert, type Camera, type RadarFeed } from './data';
import { LEVEL_FILL, LEVEL_LINE, levelOf } from './alerts';
import type { ForecastAreas } from './forecast';
import { agoText, isOngoing, REPORTER_TH, type FloodReport } from './floods';
import {
  amount,
  damPin,
  DAY_RAIN_CLASSES,
  DAM_CLASSES,
  levelText,
  mmText,
  oldNote,
  RAIN_HOUR_CLASSES,
  rainPin,
  thaiDay,
  waterPin,
  weatherPin,
  type CanalLevels,
  type CanalStation,
  type Dam,
  type DamReport,
  type RainGauge,
  type RainGauges,
  type WeatherStation,
  type WeatherToday,
} from './bkk';
import { MAP_IMAGE_RATIO, mapImage } from './mapIcons';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export interface Layers {
  alerts: boolean;
  radar: boolean;
  cameras: boolean;
  floods: boolean;
  water: boolean;
  rain: boolean;
  dams: boolean;
  weather: boolean;
}
export type LngLat = [number, number];
export interface Focus {
  key: string;
  bounds: [LngLat, LngLat];
  /** closest zoom for this focus (default 14): a building may go closer than an area */
  maxZoom?: number;
}
interface Props {
  alerts: Alert[];
  now: number;
  selectedAlertId: string | null;
  radar: RadarFeed | null;
  dataBase: string | null;
  /** radar frame to show, or null when the timeline is on a forecast hour */
  radarFrame: number | null;
  /** forecast rain areas of the chosen hour, or null */
  forecastAreas: ForecastAreas | null;
  radarOpacity: number;
  cameras: Camera[];
  /** flood reports to draw (empty while the timeline shows the forecast) */
  floods: FloodReport[];
  /** Bangkok canal levels and rain gauges (DXS), or null while the timeline shows the forecast */
  water: CanalLevels | null;
  rain: RainGauges | null;
  /** large dams and TMD's morning station reports (DXS), or null while the timeline shows the forecast */
  dams: DamReport | null;
  weather: WeatherToday | null;
  layers: Layers;
  pin: LngLat | null;
  /** short name shown on the pin, e.g. ต.คลองหนึ่ง */
  pinLabel: string | null;
  focus: Focus | null;
  onPin: (point: LngLat) => void;
  /** light or dark basemap */
  theme: 'light' | 'dark';
  /** name of the saved place, or null when none is saved */
  favoriteLabel: string | null;
  onFavorite: () => void;
  onList: () => void;
  /** a report chosen in the list: fly there and open its popup, without touching the side panel */
  openFlood: { id: string; key: string } | null;
  /** id of the report whose popup is open, or null */
  onFloodPopup: (id: string | null) => void;
}
const THAILAND: { center: LngLat; zoom: number } = { center: [101, 13.2], zoom: 5 };
// strong at country scale, light when zoomed in so streets stay readable
const ALERT_FILL_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  [
    'case',
    ['==', ['get', 'selected'], true],
    0.42,
    ['==', ['get', 'status'], 'pending'],
    0.12,
    0.28,
  ],
  11,
  ['case', ['==', ['get', 'selected'], true], 0.2, ['==', ['get', 'status'], 'pending'], 0.05, 0.1],
];
const levelMatch = (colors: Record<string, string>) =>
  [
    'match',
    ['get', 'level'],
    ...Object.entries(colors).flatMap(([level, color]) => [level, color]),
    colors.unknown,
  ] as unknown as string;

const BASEMAP = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
function blankStyle(theme: 'light' | 'dark'): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': theme === 'dark' ? '#18222b' : '#e7ede8' },
      },
    ],
  };
}
/** OpenFreeMap style with Thai place names first, or null when it cannot be loaded. */
async function loadBasemap(
  theme: 'light' | 'dark',
  signal: AbortSignal,
): Promise<StyleSpecification | null> {
  try {
    const response = await fetch(BASEMAP[theme], {
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    });
    if (!response.ok) return null;
    const style = (await response.json()) as StyleSpecification;
    for (const layer of style.layers) {
      if (
        layer.type === 'symbol' &&
        layer.layout?.['text-field'] &&
        JSON.stringify(layer.layout['text-field']).includes('name')
      )
        layer.layout['text-field'] = [
          'coalesce',
          ['get', 'name:th'],
          ['get', 'name'],
          ['get', 'name:en'],
        ];
    }
    return style;
  } catch {
    return null;
  }
}
/** Our sources and layers; added on load and again after the basemap changes with the theme. */
function addOverlays(instance: LibreMap) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  instance.addSource('alerts', { type: 'geojson', data: empty });
  instance.addLayer({
    id: 'alert-fill',
    type: 'fill',
    source: 'alerts',
    paint: {
      'fill-color': levelMatch(LEVEL_FILL),
      'fill-opacity': ALERT_FILL_OPACITY as unknown as number,
    },
  });
  instance.addLayer({
    id: 'alert-line',
    type: 'line',
    source: 'alerts',
    paint: {
      'line-color': levelMatch(LEVEL_LINE),
      'line-opacity': 0.8,
      'line-width': ['case', ['==', ['get', 'selected'], true], 2.4, 0.8],
      'line-dasharray': [
        'case',
        ['==', ['get', 'status'], 'pending'],
        ['literal', [2, 2]],
        ['literal', [1, 0]],
      ],
    },
  });
  // cameras at the bottom, flood reports on top; points close together merge into a numbered bubble until
  // zoom 14
  for (const [kind, source] of [
    ['camera', 'cameras'],
    ['weather', 'weather'],
    ['dam', 'dams'],
    ['water', 'water'],
    ['rain', 'rain'],
    ['flood', 'floods'],
  ] as const) {
    instance.addSource(source, {
      type: 'geojson',
      data: empty,
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 13,
    });
    instance.addLayer({
      id: `${kind}-cluster`,
      type: 'symbol',
      source,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': ['concat', `cluster-${kind}-`, ['get', 'point_count_abbreviated']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    instance.addLayer({
      id: `${kind}-pin`,
      type: 'symbol',
      source,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image':
          kind === 'camera'
            ? ['case', ['==', ['get', 'approximate'], true], 'pin-camera-approx', 'pin-camera']
            : kind === 'flood'
              ? ['case', ['==', ['get', 'ongoing'], true], 'pin-flood', 'pin-flood-ended']
              : ['get', 'pin'],
        // the picture has 2 px under the tip
        'icon-offset': [0, 2],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // the more important on top: an ongoing report, a fresh reading, heavier rain
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 0],
      },
    });
  }
}
// popups open above the pin head, or below the tip when there is no room above
const PIN_POPUP_OFFSET: Record<PositionAnchor, [number, number]> = {
  center: [0, -18],
  top: [0, 4],
  'top-left': [0, 4],
  'top-right': [0, 4],
  bottom: [0, -34],
  'bottom-left': [0, -34],
  'bottom-right': [0, -34],
  left: [14, -18],
  right: [-14, -18],
};
/** Layers that answer a tap with a popup (pins) or a zoom (bubbles), topmost last. */
const POINT_LAYERS = [
  'camera-cluster',
  'camera-pin',
  'weather-cluster',
  'weather-pin',
  'dam-cluster',
  'dam-pin',
  'water-cluster',
  'water-pin',
  'rain-cluster',
  'rain-pin',
  'flood-cluster',
  'flood-pin',
];
type PointKind = 'flood' | 'camera' | 'water' | 'rain' | 'dam' | 'weather';

function floodPopup(report: FloodReport, now: number, onHere: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup flood-popup';
  const title = document.createElement('strong');
  title.textContent = report.title_th;
  const when = document.createElement('span');
  when.textContent = `${agoText(report.start, now)} · ${REPORTER_TH[report.reporter]}${
    isOngoing(report, now) ? '' : ' · ครบเวลารายงานแล้ว อาจลดลง'
  }`;
  const note = document.createElement('small');
  note.textContent = 'เป็นรายงาน ไม่ใช่การตรวจวัด · iTIC และ Longdo Traffic (CC BY 4.0)';
  const link = document.createElement('a');
  link.href = report.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'ดูรายงานต้นทาง ↗';
  const here = document.createElement('button');
  here.type = 'button';
  here.className = 'popup-action';
  here.textContent = 'ดูฝนและประกาศตรงนี้';
  here.addEventListener('click', onHere);
  root.append(title, when, note, link, here);
  return root;
}

function line(text: string, tag: 'span' | 'small' | 'strong' = 'span'): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function linkOut(href: string, text: string): HTMLElement {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}
const district = (name: string | null) =>
  !name ? '' : name.startsWith('เขต') ? name : `เขต${name}`;
function measured(observedAt: string | null, now: number): string {
  return observedAt
    ? `วัดเมื่อ ${formatTime(observedAt)} น. (${agoText(observedAt, now)})`
    : 'ไม่มีค่าล่าสุด';
}

/** "not updated by itself" or "not real time, data of <date>" for a file fetched a while ago */
function note(fetchedAt: string, now: number): HTMLElement[] {
  const text = oldNote(fetchedAt, now);
  if (!text) return [];
  const element = line(text, 'small');
  element.className = 'popup-old';
  return [element];
}

function damPopup(dam: Dam, file: DamReport, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  root.append(
    line(dam.name_th, 'strong'),
    line([dam.region_th, dam.owner_th].filter(Boolean).join(' · ')),
    line(dam.percent === null ? 'ไม่มีค่าร้อยละ' : `น้ำ ${amount(dam.percent)}% ของความจุ`),
    line(`ปริมาณน้ำ ${amount(dam.volume_mcm)} / ${amount(dam.storage_mcm)} ล้าน ลบ.ม.`),
    line(`ไหลเข้า ${amount(dam.inflow_mcm)} · ระบาย ${amount(dam.outflow_mcm)} ล้าน ลบ.ม./วัน`),
    line(`ข้อมูลวันที่ ${thaiDay(file.report_date)}`),
    ...note(file.fetched_at, now),
    line(
      `${dam.location_kind === 'reservoir' ? 'หมุดอยู่กลางอ่างเก็บน้ำ · ' : ''}${file.credit_th} · ${file.location_credit_th}`,
      'small',
    ),
    linkOut(file.source_url, 'ข้อมูลน้ำของกรมชลประทาน ↗'),
  );
  return root;
}

function weatherPopup(station: WeatherStation, file: WeatherToday, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  const temps = [
    station.temperature_c !== null ? `อุณหภูมิ ${station.temperature_c} °C` : null,
    station.max_c !== null ? `สูงสุด ${station.max_c}` : null,
    station.min_c !== null ? `ต่ำสุด ${station.min_c}` : null,
  ].filter(Boolean);
  root.append(
    line(`สถานีอุตุฯ ${station.name_th}`, 'strong'),
    line(station.province_th ?? ''),
    line(`ฝน ${mmText(station.rain_mm)} (รายงานรอบเช้า)`),
  );
  if (temps.length) root.append(line(temps.join(' · ')));
  if (station.humidity_pct !== null) root.append(line(`ความชื้น ${station.humidity_pct}%`));
  root.append(
    line(station.observed_at ? `ตรวจเมื่อ ${formatTime(station.observed_at)} น.` : 'ไม่มีเวลาตรวจ'),
    ...note(file.fetched_at, now),
    line(file.credit_th, 'small'),
    linkOut(file.source_url, 'เว็บกรมอุตุนิยมวิทยา ↗'),
  );
  return root;
}

function waterPopup(station: CanalStation, file: CanalLevels, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  root.append(
    line(station.name_th, 'strong'),
    line([station.canal_th, district(station.district_th)].filter(Boolean).join(' · ')),
    line(`ระดับน้ำด้านใน ${levelText(station.level_in_m)}`),
  );
  if (station.level_out_m !== null)
    root.append(line(`ระดับน้ำด้านนอก ${levelText(station.level_out_m)}`));
  root.append(
    line(measured(station.observed_at, now)),
    ...note(file.fetched_at, now),
    line(`ม.รทก. = เทียบระดับทะเลปานกลาง ไม่ใช่ความลึกน้ำท่วมบนถนน · ${file.credit_th}`, 'small'),
    linkOut(file.source_url, 'ดูระดับน้ำทุกสถานีของ กทม. ↗'),
  );
  return root;
}

function rainPopup(gauge: RainGauge, file: RainGauges, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  root.append(
    line(gauge.name_th, 'strong'),
    line(district(gauge.district_th)),
    line(`ฝน 1 ชม. ${mmText(gauge.rain_1h_mm)} · 24 ชม. ${mmText(gauge.rain_24h_mm)}`),
    line(`15 นาที ${mmText(gauge.rain_15min_mm)} · 3 ชม. ${mmText(gauge.rain_3h_mm)}`),
    line(measured(gauge.observed_at, now)),
    ...note(file.fetched_at, now),
    line(`วัดจริงที่สถานี ไม่ใช่ค่าจากเรดาร์ · ${file.credit_th}`, 'small'),
    linkOut(file.source_url, 'หน้าข้อมูลฝนของ กทม. ↗'),
  );
  return root;
}

function cameraPopup(camera: Camera): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  const title = document.createElement('strong');
  title.textContent = camera.name_th;
  const owner = document.createElement('span');
  owner.textContent = camera.owner_th;
  root.append(title, owner);
  if (camera.position === 'approximate') {
    const approx = document.createElement('small');
    approx.textContent = 'ตำแหน่งโดยประมาณ';
    root.append(approx);
  }
  if (camera.note_th) {
    const note = document.createElement('small');
    note.textContent = camera.note_th;
    root.append(note);
  }
  const link = document.createElement('a');
  link.href = camera.page_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'เปิดดูกล้องที่เว็บเจ้าของ ↗';
  root.append(link);
  return root;
}

export default function MapView(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const pinTag = useRef<HTMLSpanElement | null>(null);
  const popup = useRef<Popup | null>(null);
  const popupKind = useRef<PointKind | null>(null);
  const showFlood = useRef<(report: FloodReport) => void>(() => undefined);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(THAILAND.zoom);
  // bumps after the basemap changes with the theme, so every overlay effect puts its data back
  const [styleVersion, setStyleVersion] = useState(0);
  const shownTheme = useRef<'light' | 'dark'>(props.theme);
  const [rendering, setRendering] = useState(true);
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const start = async () => {
      try {
        const maplibre = await import('maplibre-gl');
        maplibre.setWorkerUrl(workerUrl);
        const theme = latest.current.theme;
        const loaded = await loadBasemap(theme, controller.signal);
        if (!loaded && !disposed) setNotice('แผนที่ฐานไม่พร้อม · ข้อมูลของเรายังแสดงได้');
        const style = loaded ?? blankStyle(theme);
        shownTheme.current = theme;
        if (disposed || !element.current) return;
        const instance = new maplibre.Map({
          container: element.current,
          style,
          center: THAILAND.center,
          zoom: THAILAND.zoom,
          minZoom: 3,
          maxZoom: 17,
          attributionControl: false,
          locale: {
            'NavigationControl.ZoomIn': 'ขยายแผนที่',
            'NavigationControl.ZoomOut': 'ย่อแผนที่',
            'NavigationControl.ResetBearing': 'หันทิศเหนือ',
            'AttributionControl.ToggleAttribution': 'เครดิตแผนที่',
          },
        });
        map.current = instance;
        instance.on('styleimagemissing', (event) => {
          const picture = mapImage(event.id);
          if (picture && !instance.hasImage(event.id))
            instance.addImage(event.id, picture, { pixelRatio: MAP_IMAGE_RATIO });
        });
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
        instance.addControl(
          new maplibre.AttributionControl({
            compact: true,
            customAttribution: !loaded
              ? '<a href="https://openfreemap.org/">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              : undefined,
          }),
          'bottom-right',
        );
        instance
          .getCanvas()
          .setAttribute(
            'aria-label',
            'แผนที่ประเทศไทย แตะหรือคลิกเพื่อปักหมุดและดูข้อมูลของจุดนั้น ใช้ปุ่มลูกศรเลื่อนแผนที่',
          );
        instance.on('error', (event) => {
          if (disposed) return;
          setNotice('แผนที่บางส่วนโหลดไม่สำเร็จ · ข้อมูลยังอ่านได้ในแถบข้าง');
          if (event.error.message.includes('Worker failed')) setUnavailable(true);
        });
        instance.on('idle', () => {
          if (!disposed) setRendering(false);
        });
        instance.on('zoomend', () => {
          if (!disposed) setZoom(Math.round(instance.getZoom() * 10) / 10);
        });
        instance.getCanvas().addEventListener('webglcontextlost', () => {
          if (!disposed) setUnavailable(true);
        });
        instance.on('load', () => {
          addOverlays(instance);
          const open = (kind: PointKind, at: LngLat, content: HTMLElement) => {
            popup.current?.remove();
            const next = new maplibre.Popup({
              closeButton: true,
              maxWidth: '270px',
              offset: PIN_POPUP_OFFSET,
            })
              .setLngLat(at)
              .setDOMContent(content);
            next.on('close', () => {
              if (popup.current !== next) return;
              popup.current = null;
              if (popupKind.current === 'flood') latest.current.onFloodPopup(null);
              popupKind.current = null;
            });
            popup.current = next;
            popupKind.current = kind;
            next.addTo(instance);
          };
          showFlood.current = (report) => {
            const at = report.location as LngLat;
            open(
              'flood',
              at,
              floodPopup(report, Date.now(), () => {
                popup.current?.remove();
                latest.current.onPin(at);
              }),
            );
            latest.current.onFloodPopup(report.id);
          };
          instance.on('click', (event) => {
            const { x, y } = event.point;
            const layers = POINT_LAYERS.filter((id) => instance.getLayer(id));
            // a little slack around each pin for fingers
            const hit = layers.length
              ? instance.queryRenderedFeatures(
                  [
                    [x - 4, y - 4],
                    [x + 4, y + 4],
                  ],
                  { layers },
                )[0]
              : undefined;
            const layer = hit?.layer.id;
            if (hit && (layer === 'flood-cluster' || layer === 'camera-cluster')) {
              const center = (hit.geometry as Point).coordinates as LngLat;
              void (instance.getSource(hit.source) as GeoJSONSource)
                .getClusterExpansionZoom(hit.properties.cluster_id as number)
                .then((zoom) => instance.easeTo({ center, zoom: Math.min(zoom + 0.5, 16) }))
                .catch(() => instance.easeTo({ center, zoom: instance.getZoom() + 2 }));
              return;
            }
            if (layer === 'flood-pin') {
              const report = latest.current.floods.find((r) => r.id === hit?.properties.id);
              if (report) return showFlood.current(report);
            }
            if (layer === 'dam-pin' && latest.current.dams) {
              const file = latest.current.dams;
              const dam = file.dams.find((d) => d.id === hit?.properties.code);
              if (dam?.location)
                return open('dam', dam.location as LngLat, damPopup(dam, file, Date.now()));
            }
            if (layer === 'weather-pin' && latest.current.weather) {
              const file = latest.current.weather;
              const station = file.stations.find((s) => s.wmo === hit?.properties.code);
              if (station?.location)
                return open(
                  'weather',
                  station.location as LngLat,
                  weatherPopup(station, file, Date.now()),
                );
            }
            if (layer === 'water-pin' && latest.current.water) {
              const file = latest.current.water;
              const station = file.stations.find((s) => s.code === hit?.properties.code);
              if (station?.location)
                return open(
                  'water',
                  station.location as LngLat,
                  waterPopup(station, file, Date.now()),
                );
            }
            if (layer === 'rain-pin' && latest.current.rain) {
              const file = latest.current.rain;
              const gauge = file.gauges.find((g) => g.code === hit?.properties.code);
              if (gauge?.location)
                return open('rain', gauge.location as LngLat, rainPopup(gauge, file, Date.now()));
            }
            if (layer === 'camera-pin') {
              const camera = latest.current.cameras.find((c) => c.id === hit?.properties.id);
              if (camera?.location)
                return open('camera', camera.location as LngLat, cameraPopup(camera));
            }
            latest.current.onPin([event.lngLat.lng, event.lngLat.lat]);
          });
          for (const layer of POINT_LAYERS) {
            instance.on('mouseenter', layer, () => {
              instance.getCanvas().style.cursor = 'pointer';
            });
            instance.on('mouseleave', layer, () => {
              instance.getCanvas().style.cursor = '';
            });
          }
          const marker = document.createElement('div');
          marker.className = 'pin';
          marker.setAttribute('aria-hidden', 'true');
          const tag = document.createElement('span');
          tag.className = 'pin-tag';
          const head = document.createElement('span');
          head.className = 'pin-marker';
          marker.append(tag, head);
          pinTag.current = tag;
          pinMarker.current = new maplibre.Marker({ element: marker, anchor: 'bottom' });
          if (!disposed) setReady(true);
        });
      } catch {
        if (!disposed) setUnavailable(true);
      }
    };
    void start();
    return () => {
      disposed = true;
      controller.abort();
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Switch the basemap with the theme; our layers are added again on top of the new style
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || shownTheme.current === props.theme) return;
    const theme = props.theme;
    shownTheme.current = theme;
    const controller = new AbortController();
    void loadBasemap(theme, controller.signal).then((style) => {
      if (controller.signal.aborted || map.current !== instance) return;
      instance.once('style.load', () => {
        addOverlays(instance);
        setStyleVersion((version) => version + 1);
      });
      instance.setStyle(style ?? blankStyle(theme), { diff: false });
    });
    return () => controller.abort();
  }, [props.theme, ready]);

  // Official alert zones coloured by CAP severity
  useEffect(() => {
    if (!ready || !map.current) return;
    setRendering(true);
    const collection: FeatureCollection<MultiPolygon> = {
      type: 'FeatureCollection',
      features: props.layers.alerts
        ? props.alerts.flatMap((alert) =>
            alert.geometry
              ? [
                  {
                    type: 'Feature' as const,
                    geometry: {
                      type: 'MultiPolygon' as const,
                      coordinates: alert.geometry.coordinates,
                    },
                    properties: {
                      eventId: alert.event_id,
                      level: levelOf(alert),
                      status: displayStatus(alert, props.now),
                      selected: alert.event_id === props.selectedAlertId,
                    },
                  },
                ]
              : [],
          )
        : [],
    };
    (map.current.getSource('alerts') as GeoJSONSource | undefined)?.setData(collection);
  }, [props.alerts, props.selectedAlertId, props.now, props.layers.alerts, ready, styleVersion]);

  // Radar frame as an image overlay under the camera dots
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const frame = props.radarFrame === null ? undefined : props.radar?.frames[props.radarFrame];
    const visible = props.layers.radar && frame && props.dataBase;
    if (!visible) {
      if (instance.getLayer('radar')) instance.setLayoutProperty('radar', 'visibility', 'none');
      return;
    }
    const url = new URL(frame.path, props.dataBase!).href;
    const coordinates = props.radar!.coordinates as [LngLat, LngLat, LngLat, LngLat];
    const source = instance.getSource('radar') as ImageSource | undefined;
    if (!source) {
      instance.addSource('radar', { type: 'image', url, coordinates });
      instance.addLayer(
        {
          id: 'radar',
          type: 'raster',
          source: 'radar',
          paint: { 'raster-opacity': props.radarOpacity, 'raster-resampling': 'linear' },
        },
        'camera-cluster',
      );
    } else {
      source.updateImage({ url, coordinates });
      instance.setLayoutProperty('radar', 'visibility', 'visible');
      instance.setPaintProperty('radar', 'raster-opacity', props.radarOpacity);
    }
  }, [
    props.radar,
    props.radarFrame,
    props.radarOpacity,
    props.layers.radar,
    props.dataBase,
    ready,
    styleVersion,
  ]);

  // Forecast rain of the chosen hour: vector areas under the basemap roads and labels, so the edges stay
  // sharp at every zoom and street names remain readable on top of the colour
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const shapes = props.layers.radar ? props.forecastAreas : null;
    if (!instance.getSource('forecast')) {
      instance.addSource('forecast', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      const basemap = instance
        .getStyle()
        .layers.find(
          (layer) =>
            (layer.type === 'line' || layer.type === 'symbol') &&
            !['alert-line', 'radar', ...POINT_LAYERS].includes(layer.id),
        );
      instance.addLayer(
        {
          id: 'forecast',
          type: 'fill',
          source: 'forecast',
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': props.radarOpacity },
        },
        basemap?.id ?? 'alert-fill',
      );
    }
    (instance.getSource('forecast') as GeoJSONSource).setData(
      shapes ?? { type: 'FeatureCollection', features: [] },
    );
    instance.setPaintProperty('forecast', 'fill-opacity', props.radarOpacity);
    // alert zones stay as outlines with a faint fill, so the forecast colours read clearly
    if (instance.getLayer('alert-fill'))
      instance.setPaintProperty(
        'alert-fill',
        'fill-opacity',
        shapes ? 0.06 : (ALERT_FILL_OPACITY as unknown as number),
      );
  }, [props.forecastAreas, props.radarOpacity, props.layers.radar, ready, styleVersion]);

  // Camera dots
  useEffect(() => {
    if (!ready || !map.current) return;
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: props.layers.cameras
        ? props.cameras.flatMap((camera) =>
            camera.location
              ? [
                  {
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: camera.location },
                    properties: { id: camera.id, approximate: camera.position === 'approximate' },
                  },
                ]
              : [],
          )
        : [],
    };
    (map.current.getSource('cameras') as GeoJSONSource | undefined)?.setData(collection);
    if (!props.layers.cameras && popupKind.current === 'camera') popup.current?.remove();
  }, [props.cameras, props.layers.cameras, ready, styleVersion]);

  // Flood reports (live), faded once their own report window has passed
  useEffect(() => {
    if (!ready || !map.current) return;
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: props.layers.floods
        ? props.floods.map((report) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: report.location },
            properties: {
              id: report.id,
              ongoing: isOngoing(report, props.now),
              rank: isOngoing(report, props.now) ? 1 : 0,
            },
          }))
        : [],
    };
    (map.current.getSource('floods') as GeoJSONSource | undefined)?.setData(collection);
    if (!collection.features.length && popupKind.current === 'flood') popup.current?.remove();
  }, [props.floods, props.layers.floods, props.now, ready, styleVersion]);

  // Large dams (DXS, placed from OpenStreetMap), coloured by how full they are
  useEffect(() => {
    if (!ready || !map.current) return;
    const dams = props.layers.dams ? (props.dams?.dams ?? []) : [];
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: dams.flatMap((dam) => {
        if (!dam.location) return [];
        const pin = damPin(dam);
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: dam.location },
            properties: { code: dam.id, pin, rank: DAM_CLASSES.findIndex((c) => c.pin === pin) },
          },
        ];
      }),
    };
    (map.current.getSource('dams') as GeoJSONSource | undefined)?.setData(collection);
    if (!collection.features.length && popupKind.current === 'dam') popup.current?.remove();
  }, [props.dams, props.layers.dams, ready, styleVersion]);

  // TMD stations (DXS), coloured by the rain of their morning report
  useEffect(() => {
    if (!ready || !map.current) return;
    const stations = props.layers.weather ? (props.weather?.stations ?? []) : [];
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: stations.flatMap((station) => {
        if (!station.location) return [];
        const pin = weatherPin(station);
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: station.location },
            properties: {
              code: station.wmo,
              pin,
              rank: DAY_RAIN_CLASSES.findIndex((c) => c.pin === pin),
            },
          },
        ];
      }),
    };
    (map.current.getSource('weather') as GeoJSONSource | undefined)?.setData(collection);
    if (!collection.features.length && popupKind.current === 'weather') popup.current?.remove();
  }, [props.weather, props.layers.weather, ready, styleVersion]);

  // Bangkok canal levels (DXS): grey without a recent reading
  useEffect(() => {
    if (!ready || !map.current) return;
    const stations = props.layers.water ? (props.water?.stations ?? []) : [];
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: stations.flatMap((station) => {
        if (!station.location) return [];
        const pin = waterPin(station, props.now);
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: station.location },
            properties: { code: station.code, pin, rank: pin === 'pin-water' ? 1 : 0 },
          },
        ];
      }),
    };
    (map.current.getSource('water') as GeoJSONSource | undefined)?.setData(collection);
    if (!collection.features.length && popupKind.current === 'water') popup.current?.remove();
  }, [props.water, props.layers.water, props.now, ready, styleVersion]);

  // Bangkok rain gauges (DXS), coloured by the rain of the last hour
  useEffect(() => {
    if (!ready || !map.current) return;
    const gauges = props.layers.rain ? (props.rain?.gauges ?? []) : [];
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: gauges.flatMap((gauge) => {
        if (!gauge.location) return [];
        const pin = rainPin(gauge, props.now);
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: gauge.location },
            properties: {
              code: gauge.code,
              pin,
              rank: RAIN_HOUR_CLASSES.findIndex((item) => item.pin === pin),
            },
          },
        ];
      }),
    };
    (map.current.getSource('rain') as GeoJSONSource | undefined)?.setData(collection);
    if (!collection.features.length && popupKind.current === 'rain') popup.current?.remove();
  }, [props.rain, props.layers.rain, props.now, ready, styleVersion]);

  // A report chosen in the list: fly there and open its popup. Only a new choice moves the map,
  // never a refresh of the reports.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !props.openFlood) return;
    const report = latest.current.floods.find((r) => r.id === props.openFlood?.id);
    if (!report) return;
    // the pin ends a little below the middle, so its popup has room under the map buttons
    instance.flyTo({
      center: report.location as LngLat,
      zoom: Math.max(instance.getZoom(), 15),
      offset: [0, Math.round(instance.getContainer().clientHeight * 0.22)],
      duration: 700,
    });
    showFlood.current(report);
  }, [props.openFlood, ready]);

  // Pin marker
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !pinMarker.current) return;
    if (props.pin) pinMarker.current.setLngLat(props.pin).addTo(instance);
    else pinMarker.current.remove();
    if (pinTag.current) {
      pinTag.current.textContent = props.pinLabel ?? '';
      pinTag.current.hidden = !props.pinLabel;
    }
  }, [props.pin, props.pinLabel, ready]);

  // Fit to the selected alert once per selection. The alert list is rebuilt every clock tick and
  // every refresh, and must never pull the map back while someone is zoomed in looking around.
  const fittedAlert = useRef<string | null>(null);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (!props.selectedAlertId) {
      fittedAlert.current = null;
      return;
    }
    if (fittedAlert.current === props.selectedAlertId) return;
    const selected = props.alerts.find((a) => a.event_id === props.selectedAlertId);
    // an alert from a shared link may arrive with a later refresh; fit when it does
    if (!selected?.geometry) return;
    fittedAlert.current = props.selectedAlertId;
    const points = selected.geometry.coordinates.flat(2);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    instance.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: 50, maxZoom: 8, duration: 0 },
    );
  }, [props.selectedAlertId, props.alerts, ready]);
  useEffect(() => {
    if (!ready || !map.current || !props.focus) return;
    map.current.fitBounds(props.focus.bounds, {
      padding: 60,
      maxZoom: props.focus.maxZoom ?? 14,
      duration: 600,
    });
  }, [props.focus, ready]);

  const pinCenter = () => {
    const center = map.current?.getCenter();
    if (center) props.onPin([center.lng, center.lat]);
  };
  const locate = () => {
    if (!navigator.geolocation) {
      setNotice('อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: LngLat = [position.coords.longitude, position.coords.latitude];
        props.onPin(point);
        map.current?.flyTo({ center: point, zoom: 12 });
      },
      () => setNotice('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง · ปักหมุดบนแผนที่แทนได้'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div
      className="map-surface"
      data-testid="map-surface"
      data-zoom={zoom}
      aria-busy={!ready || rendering}
    >
      <div ref={element} className="map-canvas" />
      {!ready && !unavailable && (
        <div className="map-loading">
          <MapIcon size={22} />
          <span>กำลังเปิดแผนที่ประเทศไทย…</span>
        </div>
      )}
      {unavailable && (
        <div className="map-unavailable">
          <MapPin size={32} />
          <h3>อุปกรณ์นี้เปิดแผนที่ไม่ได้</h3>
          <p>ประกาศและข้อมูลทั้งหมดอ่านได้ในแถบข้อมูล</p>
          <button className="primary-button" onClick={props.onList}>
            ดูรายการประกาศ
          </button>
        </div>
      )}
      {notice && !unavailable && (
        <div className="map-notice" role="status">
          {notice}
        </div>
      )}
      {ready && !unavailable && (
        <div className="map-actions">
          <button onClick={locate} aria-label="ปักหมุดที่ตำแหน่งของฉัน">
            <LocateFixed size={18} />
            <span>ตำแหน่งฉัน</span>
          </button>
          <button onClick={pinCenter} aria-label="ปักหมุดที่กลางแผนที่">
            <Crosshair size={18} />
            <span>ปักหมุดกลางจอ</span>
          </button>
          <button
            aria-label="กลับไปดูแผนที่ประเทศไทย"
            onClick={() => map.current?.jumpTo(THAILAND)}
          >
            <Expand size={17} />
            <span>ทั้งประเทศ</span>
          </button>
          {props.favoriteLabel && (
            <button
              className="favorite-action"
              aria-label={`ไปที่ของฉัน ${props.favoriteLabel}`}
              onClick={props.onFavorite}
            >
              <Star size={17} />
              <span>ที่ของฉัน</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
