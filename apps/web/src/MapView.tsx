import { useEffect, useRef, useState } from 'react';
import { Crosshair, Expand, LocateFixed, MapPin, Map as MapIcon, Star } from 'lucide-react';
import type {
  GeoJSONSource,
  ImageSource,
  Map as LibreMap,
  Marker,
  Popup,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, MultiPolygon, Point } from 'geojson';
import { displayStatus, type Alert, type Camera, type RadarFeed } from './data';
import { LEVEL_FILL, LEVEL_LINE, levelOf } from './alerts';
import type { ForecastAreas } from './forecast';
import { agoText, isOngoing, REPORTER_TH, type FloodReport } from './floods';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export interface Layers {
  alerts: boolean;
  radar: boolean;
  cameras: boolean;
  floods: boolean;
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
  layers: Layers;
  pin: LngLat | null;
  /** short name shown on the pin, e.g. ต.คลองหนึ่ง */
  pinLabel: string | null;
  focus: Focus | null;
  onPin: (point: LngLat) => void;
  /** name of the saved place, or null when none is saved */
  favoriteLabel: string | null;
  onFavorite: () => void;
  onList: () => void;
}
const THAILAND: { center: LngLat; zoom: number } = { center: [101, 13.2], zoom: 5 };
const blankStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7ede8' } }],
};
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

function floodPopup(report: FloodReport, now: number): HTMLElement {
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
  root.append(title, when, note, link);
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
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(THAILAND.zoom);
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
        let style: StyleSpecification = blankStyle;
        try {
          const response = await fetch('https://tiles.openfreemap.org/styles/positron', {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
          });
          if (!response.ok) throw new Error('Basemap unavailable');
          style = (await response.json()) as StyleSpecification;
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
        } catch {
          if (!disposed) setNotice('แผนที่ฐานไม่พร้อม · ข้อมูลของเรายังแสดงได้');
        }
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
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
        instance.addControl(
          new maplibre.AttributionControl({
            compact: true,
            customAttribution:
              style === blankStyle
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
          const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
          instance.addSource('alerts', { type: 'geojson', data: empty });
          instance.addLayer({
            id: 'alert-fill',
            type: 'fill',
            source: 'alerts',
            paint: {
              'fill-color': levelMatch(LEVEL_FILL),
              // strong at country scale, light when zoomed in so streets stay readable
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
          instance.addSource('cameras', { type: 'geojson', data: empty });
          instance.addLayer({
            id: 'camera-dot',
            type: 'circle',
            source: 'cameras',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 8],
              'circle-color': ['case', ['==', ['get', 'approximate'], true], '#78909c', '#263238'],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          });
          instance.addSource('floods', { type: 'geojson', data: empty });
          instance.addLayer({
            id: 'flood-dot',
            type: 'circle',
            source: 'floods',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 12, 8],
              'circle-color': '#1565c0',
              'circle-opacity': ['case', ['==', ['get', 'ongoing'], true], 1, 0.45],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          });
          instance.on('click', (event) => {
            const flood = instance.queryRenderedFeatures(event.point, { layers: ['flood-dot'] })[0];
            const report = latest.current.floods.find((r) => r.id === flood?.properties?.id);
            if (report) {
              popup.current?.remove();
              popup.current = new maplibre.Popup({ closeButton: true, maxWidth: '260px' })
                .setLngLat(report.location as LngLat)
                .setDOMContent(floodPopup(report, Date.now()))
                .addTo(instance);
              return;
            }
            const hit = instance.queryRenderedFeatures(event.point, { layers: ['camera-dot'] })[0];
            const id = hit?.properties?.id;
            const camera = latest.current.cameras.find((c) => c.id === id);
            if (camera?.location) {
              popup.current?.remove();
              popup.current = new maplibre.Popup({ closeButton: true, maxWidth: '260px' })
                .setLngLat(camera.location as LngLat)
                .setDOMContent(cameraPopup(camera))
                .addTo(instance);
              return;
            }
            latest.current.onPin([event.lngLat.lng, event.lngLat.lat]);
          });
          for (const layer of ['camera-dot', 'flood-dot'])
            instance.on('mouseenter', layer, () => {
              instance.getCanvas().style.cursor = 'pointer';
            });
          for (const layer of ['camera-dot', 'flood-dot'])
            instance.on('mouseleave', layer, () => {
              instance.getCanvas().style.cursor = '';
            });
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
    (map.current.getSource('alerts') as GeoJSONSource).setData(collection);
  }, [props.alerts, props.selectedAlertId, props.now, props.layers.alerts, ready]);

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
        'camera-dot',
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
            !['alert-line', 'camera-dot', 'flood-dot', 'radar'].includes(layer.id),
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
  }, [props.forecastAreas, props.radarOpacity, props.layers.radar, ready]);

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
    (map.current.getSource('cameras') as GeoJSONSource).setData(collection);
    if (!props.layers.cameras) popup.current?.remove();
  }, [props.cameras, props.layers.cameras, ready]);

  // Flood reports (live), faded once their own report window has passed
  useEffect(() => {
    if (!ready || !map.current) return;
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: props.layers.floods
        ? props.floods.map((report) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: report.location },
            properties: { id: report.id, ongoing: isOngoing(report, props.now) },
          }))
        : [],
    };
    (map.current.getSource('floods') as GeoJSONSource).setData(collection);
  }, [props.floods, props.layers.floods, props.now, ready]);

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
