import { useEffect, useRef, useState } from 'react';
import { Expand, MapPin, Map as MapIcon } from 'lucide-react';
import type { GeoJSONSource, Map as LibreMap, StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection, MultiPolygon } from 'geojson';
import { displayStatus, type Alert } from './data';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

interface Props {
  alerts: Alert[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
  onList: () => void;
}
const blankStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7ede8' } }],
};

export default function AlertMap(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const start = async () => {
      try {
        const { Map, NavigationControl, AttributionControl, setWorkerUrl } =
          await import('maplibre-gl');
        setWorkerUrl(workerUrl);
        let style: StyleSpecification = blankStyle;
        try {
          const response = await fetch('https://tiles.openfreemap.org/styles/positron', {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
          });
          if (!response.ok) throw new Error('Basemap unavailable');
          style = (await response.json()) as StyleSpecification;
          // Preserve road refs and other labels; prefer native Thai names where available.
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
          if (!disposed) setNotice('แผนที่ฐานไม่พร้อม · ยังดูขอบเขตประกาศและรายการได้');
        }
        if (disposed || !element.current) return;
        const instance = new Map({
          container: element.current,
          style,
          center: [101, 14.7],
          zoom: 4.8,
          minZoom: 3,
          maxZoom: 15,
          attributionControl: false,
          locale: {
            'NavigationControl.ZoomIn': 'ขยายแผนที่',
            'NavigationControl.ZoomOut': 'ย่อแผนที่',
            'NavigationControl.ResetBearing': 'หันทิศเหนือ',
            'AttributionControl.ToggleAttribution': 'เครดิตแผนที่',
          },
        });
        map.current = instance;
        instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        instance.addControl(
          new AttributionControl({
            compact: false,
            customAttribution:
              style === blankStyle
                ? '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                : undefined,
          }),
          'bottom-right',
        );
        instance
          .getCanvas()
          .setAttribute(
            'aria-label',
            'แผนที่ขอบเขตประกาศกรมอุตุนิยมวิทยา ใช้ปุ่มลูกศรเลื่อนแผนที่ หรือเลือกมุมมองรายการ',
          );
        instance.on('error', (event) => {
          if (disposed) return;
          setNotice('แผนที่บางส่วนโหลดไม่สำเร็จ · ดูรายละเอียดจากรายการได้');
          if (event.error.message.includes('Worker failed')) setUnavailable(true);
        });
        instance.on('idle', () => {
          if (!disposed) setRendering(false);
        });
        instance.getCanvas().addEventListener('webglcontextlost', () => {
          if (!disposed) setUnavailable(true);
        });
        instance.on('load', () => {
          instance.addSource('official-alerts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          instance.addLayer({
            id: 'alert-fill',
            type: 'fill',
            source: 'official-alerts',
            paint: {
              'fill-color': ['case', ['==', ['get', 'status'], 'pending'], '#617fa2', '#d69c31'],
              'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.25, 0.09],
            },
          });
          instance.addLayer({
            id: 'alert-line',
            type: 'line',
            source: 'official-alerts',
            paint: {
              'line-color': ['case', ['==', ['get', 'status'], 'pending'], '#3d608c', '#a46a13'],
              'line-opacity': 0.65,
              'line-width': ['case', ['==', ['get', 'selected'], true], 2, 0.7],
            },
          });
          instance.on('click', 'alert-fill', (event) => {
            const id = event.features?.[0]?.properties?.eventId;
            if (typeof id === 'string') latest.current.onSelect(id);
          });
          instance.on('mouseenter', 'alert-fill', () => {
            instance.getCanvas().style.cursor = 'pointer';
          });
          instance.on('mouseleave', 'alert-fill', () => {
            instance.getCanvas().style.cursor = '';
          });
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
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    setRendering(true);
    const collection: FeatureCollection<MultiPolygon> = {
      type: 'FeatureCollection',
      features: props.alerts.flatMap((alert) =>
        alert.geometry
          ? [
              {
                type: 'Feature' as const,
                id: alert.event_id,
                geometry: {
                  type: 'MultiPolygon' as const,
                  coordinates: alert.geometry.coordinates,
                },
                properties: {
                  eventId: alert.event_id,
                  status: displayStatus(alert, props.now),
                  selected: alert.event_id === props.selectedId,
                },
              },
            ]
          : [],
      ),
    };
    (map.current.getSource('official-alerts') as GeoJSONSource).setData(collection);
  }, [props.alerts, props.selectedId, props.now, ready]);

  useEffect(() => {
    const selected = props.alerts.find((a) => a.event_id === props.selectedId);
    if (!ready || !selected?.geometry || !map.current) return;
    const points = selected.geometry.coordinates.flat(2);
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    if (points.length)
      map.current.fitBounds(
        [
          [Math.min(...xs), Math.min(...ys)],
          [Math.max(...xs), Math.max(...ys)],
        ],
        { padding: 60, maxZoom: 8, duration: 0 },
      );
  }, [props.selectedId, props.alerts, ready]);

  return (
    <div className="map-surface" data-testid="map-surface" aria-busy={!ready || rendering}>
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
          <p>ประกาศทั้งหมดอ่านได้ในมุมมองรายการ</p>
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
        <button
          className="map-reset"
          aria-label="กลับไปดูแผนที่ประเทศไทย"
          onClick={() => map.current?.jumpTo({ center: [101, 14.7], zoom: 4.8 })}
        >
          <Expand size={17} /> ประเทศไทย
        </button>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-active" /> ขอบเขตประกาศ
        </span>
        <span>
          <i className="legend-pending" /> เริ่มมีผลภายหลัง
        </span>
        <small>ไม่ใช่พื้นที่ตรวจพบน้ำท่วม · ที่มา: กรมอุตุนิยมวิทยา</small>
      </div>
    </div>
  );
}
