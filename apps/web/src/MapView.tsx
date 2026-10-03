import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Expand, LocateFixed, MapPin, Map as MapIcon, Star } from 'lucide-react';
import areaThaiFont from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-600-normal.woff2?url';
import areaLatinFont from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-600-normal.woff2?url';
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
import {
  displayStatus,
  safeLink,
  type Alert,
  type Camera,
  type CanalOutlook,
  type RadarFeed,
  type RidFlows,
} from './data';
import { LEVEL_FILL, LEVEL_LINE, levelOf } from './alerts';
import type { ForecastAreas } from './forecast';
import { isOngoing, isShown, reportedAt, REPORTER_TH, type FloodReport } from './floods';
import { BARRAGE_LINK, BARRAGES, type Barrage } from './barrages';
import { bankFeatures, bankState, type BankObservation } from './overflow';
import {
  amount,
  damPin,
  carriedFrom,
  carriedText,
  damMissingText,
  damReadingLines,
  damWords,
  shownDam,
  DAY_RAIN_CLASSES,
  DAM_CLASSES,
  lastQuarterText,
  levelChange,
  levelChangeWords,
  levelSigned,
  LEVEL_NO_BANK_TH,
  measuredText,
  mmText,
  damsOldNote,
  releaseChange,
  releaseWords,
  RAIN_HOUR_CLASSES,
  rainPin,
  rainAmountWords,
  reportTime,
  shortCredit,
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
import {
  RIVER_CLASSES,
  RIVER_UNKNOWN_COLOR,
  RIVERS_STALE_MS,
  riverChart,
  riverOutlook,
  riverPin,
  riverWords,
  type RiverForecast,
  type RiverPoint,
} from './rivers';
import { MAP_IMAGE_RATIO, mapImage } from './mapIcons';
import { distanceM } from './roads';
import { WATCH_COLOR, type WatchShapes } from './overview';
import {
  canalLevel,
  canalsOld,
  canalWords,
  factorText,
  flowFeatures,
  flowsOld,
  flowText,
  pointName,
  sitePoints,
  type CanalShapes,
  type FlowPoint,
  type FlowSite,
} from './flows';
import type { RiverStretches } from './rivers';
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
  rivers: boolean;
  /** RID's stations, barrages and gates (D35) */
  flows: boolean;
  /** the canals of the pilot by the site's trial outlook (D35) */
  canals: boolean;
  /** outlines of the places the summary lists */
  watch: boolean;
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
  /** the GloFAS river trend, or null while the timeline shows the forecast */
  rivers: RiverForecast | null;
  /** RID's daily figures of the Chao Phraya (D35), or null while the timeline shows the forecast */
  flows: RidFlows | null;
  /** the canals of the pilot coloured by the outlook, or null (layer off, or the timeline on the forecast) */
  canalShapes: CanalShapes | null;
  /** the outlook the canal lines are coloured by: their popups read its factors */
  canalOutlook: CanalOutlook | null;
  /** outlines of the summary's places (empty when the layer is off) */
  watch: WatchShapes;
  /** stretches of river the model sees rising, or null (layer off, or the timeline on the forecast) */
  riverStretches: RiverStretches | null;
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
  /** where the saved place is: a star pin stays there (user 2026-10-02); null when none, or the pin is on it */
  favoriteLocation: LngLat | null;
  onFavorite: () => void;
  onList: () => void;
  /** a report chosen in the list: fly there and open its popup, without touching the side panel */
  openFlood: { id: string; key: string } | null;
  /** id of the report whose popup is open, or null */
  onFloodPopup: (id: string | null) => void;
  /** true while the map is zoomed out so far that only the severe points show */
  onOverview?: (overview: boolean) => void;
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
/** Use our bundled Thai font even when the external basemap or its glyph service is unavailable. */
function withAreaFonts(style: StyleSpecification): StyleSpecification {
  style['font-faces'] = {
    ...style['font-faces'],
    'Fontokmai Area': [
      { url: areaThaiFont, 'unicode-range': ['U+0E01-0E5B', 'U+200C-200D', 'U+25CC'] },
      { url: areaLatinFont, 'unicode-range': ['U+0000-00FF', 'U+2000-206F'] },
    ],
  };
  return style;
}
function blankStyle(theme: 'light' | 'dark'): StyleSpecification {
  return withAreaFonts({
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': theme === 'dark' ? '#18222b' : '#e7ede8' },
      },
    ],
  });
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
    return withAreaFonts(style);
  } catch {
    return null;
  }
}
/** The picture of a pin of each kind (its feature carries `pin`, or `approximate`/`ongoing` for two kinds). */
function pinIcon(kind: string): unknown {
  return kind === 'camera'
    ? ['case', ['==', ['get', 'approximate'], true], 'pin-camera-approx', 'pin-camera']
    : kind === 'flood'
      ? ['case', ['==', ['get', 'ongoing'], true], 'pin-flood', 'pin-flood-ended']
      : ['get', 'pin'];
}
/**
 * Kinds whose severe points never go into a bubble (user 2026-10-02: on the first view of the country a severe one
 * had to be zoomed into to be seen): an ongoing flood report, a dam over capacity or releasing a lot more, a river
 * the model sees rising a lot, heavy rain at a TMD station or a Bangkok gauge. The ordinary ones still group.
 */
/**
 * Below this zoom (the first view of the country) only the severe points show, out of their bubbles; the others,
 * the grey ones too, from here on (user 2026-10-02: the overview showed too much).
 */
const DETAIL_ZOOM = 8;
const SEVERE_KINDS = [
  ['weather', 'weather'],
  ['dam', 'dams'],
  ['flow', 'flows'],
  ['river', 'rivers'],
  ['rain', 'rain'],
  ['flood', 'floods'],
] as const;
/** Points into their source, the severe ones (`severe` true) into its unclustered twin above every bubble. */
function setPoints(instance: LibreMap, source: string, collection: FeatureCollection<Point>) {
  const severe = collection.features.filter((feature) => feature.properties?.severe === true);
  (instance.getSource(source) as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: collection.features.filter((feature) => feature.properties?.severe !== true),
  });
  (instance.getSource(`${source}-top`) as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: severe,
  });
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
  // stretches of river forecast to rise (model, 7 days): over the rain, under the outlines and the pins
  instance.addSource('river-lines', { type: 'geojson', data: empty });
  instance.addLayer({
    id: 'river-line-casing',
    type: 'line',
    source: 'river-lines',
    // only the stretches forecast to rise stand out; the others are thin, to show where the forecast is
    filter: ['==', ['get', 'rising'], true],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 9, 6, 13, 8],
    },
  });
  instance.addLayer({
    id: 'river-line',
    type: 'line',
    source: 'river-lines',
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      'line-sort-key': [
        'match',
        ['get', 'trend'],
        'rising_fast',
        2,
        'rising',
        1,
        0,
      ] as unknown as number,
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-opacity': ['case', ['==', ['get', 'rising'], true], 1, 0.6],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        ['case', ['==', ['get', 'rising'], true], 2.4, 1.2],
        9,
        ['case', ['==', ['get', 'rising'], true], 3.4, 1.8],
        13,
        ['case', ['==', ['get', 'rising'], true], 5, 2.4],
      ],
    },
  });
  // the canals of the pilot by the site's trial outlook (D35): bold red or orange where its factors add up, thin
  // elsewhere to show which canals it follows
  instance.addSource('canal-lines', { type: 'geojson', data: empty });
  instance.addLayer({
    id: 'canal-line-casing',
    type: 'line',
    source: 'canal-lines',
    filter: ['!=', ['get', 'level'], 'none'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 9, 5.5, 13, 8],
    },
  });
  instance.addLayer({
    id: 'canal-line',
    type: 'line',
    source: 'canal-lines',
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      'line-sort-key': ['get', 'rank'] as unknown as number,
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-opacity': ['case', ['==', ['get', 'level'], 'none'], 0.7, 1],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        5,
        ['case', ['==', ['get', 'level'], 'none'], 1, 2],
        9,
        ['case', ['==', ['get', 'level'], 'none'], 1.6, 3.2],
        13,
        ['case', ['==', ['get', 'level'], 'none'], 2.4, 5],
      ],
    },
  });
  // the summary's places: over the alert zones and the rain, under the pins; the places to watch now on top
  instance.addSource('watch', { type: 'geojson', data: empty });
  const nowFirst = ['case', ['==', ['get', 'when'], 'now'], 1, 0] as unknown as number;
  instance.addLayer({
    id: 'watch-casing',
    type: 'line',
    source: 'watch',
    layout: { 'line-join': 'round', 'line-sort-key': nowFirst },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.9,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.6, 9, 4, 12, 5.4],
    },
  });
  instance.addLayer({
    id: 'watch-line',
    type: 'line',
    source: 'watch',
    layout: { 'line-join': 'round', 'line-sort-key': nowFirst },
    paint: {
      'line-color': ['case', ['==', ['get', 'when'], 'now'], WATCH_COLOR.now, WATCH_COLOR.next],
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 9, 2, 12, 2.8],
      'line-dasharray': [
        'case',
        ['==', ['get', 'when'], 'now'],
        ['literal', [1, 0]],
        ['literal', [2.5, 1.5]],
      ],
    },
  });
  // Polygon placement anchors each name inside its outline; the full place name includes the province.
  // Collision detection hides crowded names until zooming in instead of painting unreadable text.
  instance.addLayer({
    id: 'watch-label',
    type: 'symbol',
    source: 'watch',
    layout: {
      'text-field': ['get', 'place'],
      'text-font': ['Fontokmai Area'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13, 11, 15],
      'text-max-width': 12,
      'text-line-height': 1.25,
      // Pins stand above their location; place the name below its anchor so a central pin cannot cover it.
      'text-anchor': 'top',
      'text-offset': [0, 0.4],
      'text-padding': 3,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': ['case', ['==', ['get', 'when'], 'now'], 0, 1],
    },
    paint: {
      'text-color': ['case', ['==', ['get', 'when'], 'now'], '#971d1d', '#914400'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
      'text-halo-blur': 0.3,
    },
  });
  // cameras at the bottom, flood reports on top; points close together merge into a numbered bubble until
  // zoom 14
  for (const [kind, source] of [
    ['camera', 'cameras'],
    ['weather', 'weather'],
    ['dam', 'dams'],
    ['flow', 'flows'],
    ['river', 'rivers'],
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
      minzoom: DETAIL_ZOOM,
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
      minzoom: DETAIL_ZOOM,
      type: 'symbol',
      source,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': pinIcon(kind) as string,
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
  instance.addSource('bank-evidence', { type: 'geojson', data: empty });
  instance.addLayer({
    id: 'bank-reach',
    type: 'line',
    source: 'bank-evidence',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
  });
  instance.addLayer({
    id: 'bank-point',
    type: 'circle',
    source: 'bank-evidence',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 9,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });
  // the severe points of each kind, never in a bubble, above everything else
  for (const [kind, source] of SEVERE_KINDS) {
    instance.addSource(`${source}-top`, { type: 'geojson', data: empty });
    // a dam releasing a lot more than the report before: a red ring under its pin (user 2026-10-02: show that it
    // is alarming)
    if (kind === 'dam')
      instance.addLayer({
        id: 'dam-alarm',
        type: 'circle',
        source: `${source}-top`,
        filter: ['==', ['get', 'alarm'], true],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 13, 10, 18],
          'circle-color': '#e53935',
          'circle-opacity': 0.22,
          'circle-stroke-color': '#e53935',
          'circle-stroke-width': 2.5,
          'circle-translate': [0, -14],
        },
      });
    instance.addLayer({
      id: `${kind}-top`,
      type: 'symbol',
      source: `${source}-top`,
      layout: {
        'icon-image': pinIcon(kind) as string,
        'icon-offset': [0, 2],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
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
// room a popup keeps on the map: above the pin it points to (head and tip), at the top, and over the key at the
// bottom (one line on a phone)
const POPUP_PIN = 44;
const POPUP_TOP = 8;
const POPUP_GAP = 8;
// what lies over the bottom of the map: the key's line (its opened list is drawn under a popup), the timeline and
// the map buttons
const MAP_BOTTOM_COVERS = ['.legend-strip', '.timeline', '.maplibregl-ctrl-bottom-right'];
/**
 * The height at the bottom of the map that these cover now, beside `card` only what is under it (Codex M43: a
 * fixed allowance left the source link of a long popup under the key and the timeline on a short phone).
 */
function coveredBottom(instance: LibreMap, card?: DOMRect): number {
  const frame = instance.getContainer().getBoundingClientRect();
  let top = frame.bottom;
  for (const selector of MAP_BOTTOM_COVERS) {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (!box || !box.height || box.top >= frame.bottom || box.bottom <= frame.top) continue;
    if (card && (box.right <= card.left || box.left >= card.right)) continue;
    top = Math.min(top, box.top);
  }
  return frame.bottom - top + POPUP_GAP;
}
/** The tallest a popup's card may be on this map now; a longer one scrolls (CSS `--popup-max`). */
function sizePopups(instance: LibreMap) {
  const room =
    instance.getContainer().clientHeight -
    POPUP_PIN -
    POPUP_TOP -
    coveredBottom(instance) -
    POPUP_GAP;
  instance.getContainer().style.setProperty('--popup-max', `${Math.max(120, room)}px`);
}
/**
 * Pan just enough that an open popup is whole on the map, above its pin and clear of what covers the bottom
 * (2026-10-03: a long card was cut off at the bottom of a phone's map). MapLibre puts a popup above its pin
 * whenever there is room above, so the pin goes low enough for the card to fit over it. Not while the map flies:
 * the flight placed it.
 */
function fitPopup(instance: LibreMap, popup: Popup, at: LngLat) {
  if (instance.isMoving()) return;
  sizePopups(instance); // the key and the timeline may have changed since the map opened
  const card = popup.getElement()?.getBoundingClientRect();
  const height = instance.getContainer().clientHeight;
  if (!card?.height || !height) return;
  const y = instance.project(at).y;
  const lowest = height - coveredBottom(instance, card);
  const target = Math.min(Math.max(y, card.height + POPUP_PIN + POPUP_TOP), lowest);
  if (Math.abs(target - y) >= 1) instance.panBy([0, y - target], { duration: 250 });
}
/** Layers that answer a tap with a popup (pins) or a zoom (bubbles), topmost last. */
const POINT_LAYERS = [
  'camera-cluster',
  'camera-pin',
  'weather-cluster',
  'weather-pin',
  'dam-cluster',
  'dam-pin',
  'flow-cluster',
  'flow-pin',
  'river-cluster',
  'river-pin',
  'water-cluster',
  'water-pin',
  'rain-cluster',
  'rain-pin',
  'flood-cluster',
  'flood-pin',
  'bank-reach',
  'bank-point',
  'river-line',
  'canal-line',
  ...SEVERE_KINDS.map(([kind]) => `${kind}-top`),
];
type PointKind =
  'flood' | 'camera' | 'water' | 'rain' | 'dam' | 'flow' | 'canal' | 'weather' | 'river' | 'bank';

function bankPopup(item: BankObservation, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  root.append(
    line(item.name_th, 'strong'),
    line(bankState(item, now).text, 'b'),
    line(
      item.kind === 'measurement'
        ? measuredText(item.observed_at, now)
        : item.observed_at
          ? `รายงานเมื่อ ${reportTime(item.observed_at, now)}`
          : 'ไม่มีเวลารายงาน',
    ),
    line(
      item.kind === 'measurement'
        ? 'เทียบระดับน้ำกับตลิ่งเฉพาะจุด · ทดลอง'
        : 'รายงานเฉพาะช่วงเส้นที่แสดง',
    ),
    line('ไม่ใช่ขอบเขตพื้นที่ท่วม และไม่ใช่ประกาศเตือนภัย'),
    sourceLink(item.source_url, item.credit_th),
  );
  return root;
}

function floodPopup(report: FloodReport, now: number, onHere: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup flood-popup';
  const title = document.createElement('strong');
  title.textContent = report.title_th;
  const when = document.createElement('span');
  when.textContent = `${reportedAt(report.start, now)} · ${REPORTER_TH[report.reporter]}${
    isOngoing(report, now) ? '' : ' · ครบเวลารายงานแล้ว อาจลดลง'
  }`;
  const link = sourceLink(report.url, 'iTIC และ Longdo Traffic');
  const here = document.createElement('button');
  here.type = 'button';
  here.className = 'popup-action';
  here.textContent = 'ดูฝนและประกาศตรงนี้';
  here.addEventListener('click', onHere);
  root.append(title, when, link, here);
  return root;
}

function line(text: string, tag: 'span' | 'small' | 'strong' | 'b' = 'span'): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
/** "ที่มา: กรมอุตุนิยมวิทยา ↗" linked to the source's own page; the full credits are on the sources page */
function sourceLink(href: string, credit: string): HTMLElement {
  return linkOut(href, `ที่มา: ${shortCredit(credit)} ↗`);
}
function linkOut(href: string, text: string): HTMLElement {
  const url = safeLink(href);
  if (!url) return line(text);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}
const district = (name: string | null) =>
  !name ? '' : name.startsWith('เขต') ? name : `เขต${name}`;

/** "not updated by itself" or "not real time, data of <date>" for a file fetched a while ago */
function note(fetchedAt: string, now: number, automatic = false): HTMLElement[] {
  const text = damsOldNote({ fetched_at: fetchedAt, automatic }, now);
  if (!text) return [];
  const element = line(text, 'small');
  element.className = 'popup-old';
  return [element];
}

/** "↑ ระบายเพิ่มมาก จาก 8.1 (28 ก.ย.)" against the report before, when the file has one */
function releaseLine(dam: Dam, file: DamReport): HTMLElement[] {
  const change = file.previous_report_date ? releaseChange(dam) : null;
  if (!change || !file.previous_report_date) return [];
  const arrow = change.direction === 'up' ? '↑ ' : change.direction === 'down' ? '↓ ' : '';
  const words = line(
    `${arrow}${releaseWords(change, file.previous_report_date)}`,
    change.big ? 'b' : 'small',
  );
  if (change.big) {
    words.className = 'release-alarm';
    words.textContent = `⚠ ${words.textContent} · ต้องระวัง`;
  }
  return [words];
}

function damPopup(dam: Dam, file: DamReport, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  const shown = shownDam(dam);
  const carried = carriedFrom(dam);
  const missing = damMissingText(shown);
  root.append(
    line(dam.name_th, 'strong'),
    line([dam.region_th, dam.owner_th].filter(Boolean).join(' · ')),
    ...(shown.percent !== null
      ? [line(`${damWords(shown.percent)} · ${amount(shown.percent)}% ของความจุ`, 'b')]
      : []),
    ...damReadingLines(shown).map((reading) => line(reading)),
    ...(carried ? [line(carriedText(carried), 'small')] : []),
    ...(missing ? [line(missing)] : []),
    ...releaseLine(dam, file),
    line(`${carried ? 'รายงานรอบนี้วันที่' : 'ข้อมูลวันที่'} ${thaiDay(file.report_date)}`),
    ...note(file.fetched_at, now, file.automatic ?? false),
    ...(dam.location_kind === 'reservoir' ? [line('หมุดอยู่กลางอ่างเก็บน้ำ', 'small')] : []),
    sourceLink(file.source_url, file.credit_th),
  );
  return root;
}

function barragePopup(barrage: Barrage): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  const link = document.createElement('a');
  link.href = BARRAGE_LINK;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = `${barrage.look_th} ที่กรมชลประทาน ↗`;
  root.append(
    line(barrage.name_th, 'strong'),
    line(`เขื่อนทดน้ำบน${barrage.river_th} · ${barrage.place_th}`),
    line('ไม่มีอ่างเก็บน้ำ จึงไม่มีตัวเลขความจุ และเว็บนี้ยังไม่มีตัวเลขการระบายน้ำ', 'small'),
    link,
  );
  return root;
}

/** A link to a page of this site, in the same tab */
function pageLink(path: string, text: string): HTMLElement {
  const link = document.createElement('a');
  link.href = `${import.meta.env.BASE_URL}${path}`;
  link.textContent = text;
  return link;
}
function pointList(points: FlowPoint[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'flow-points';
  for (const point of points) {
    const item = document.createElement('li');
    item.append(line(pointName(point), 'b'), line(flowText(point)));
    list.append(item);
  }
  return list;
}

/**
 * A site of RID's daily report (D35): the river or the barrage first, then the gates, each in plain words; many gates
 * fold under one line so that the popup stays short. RID's figures, said as RID's, with their time and source.
 */
function flowPopup(site: FlowSite, file: RidFlows, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup flow-popup';
  const { main, gates } = sitePoints(file, site);
  root.append(line(site.name_th, 'strong'));
  if (main.length) root.append(pointList(main));
  if (gates.length && main.length + gates.length > 4) {
    const fold = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `ประตูรับน้ำ ${gates.length} จุด`;
    fold.append(summary, pointList(gates));
    root.append(fold);
  } else if (gates.length) root.append(pointList(gates));
  root.append(
    line(`ตัวเลขเวลา 06:00 น. ${thaiDay(file.report_date)} · กรมชลฯ รายงานวันละครั้ง`, 'small'),
  );
  if (flowsOld(file, now)) {
    const old = line('รายงานเก่า ยังไม่มีฉบับใหม่', 'small');
    old.className = 'popup-old';
    root.append(old);
  }
  root.append(linkOut(file.source_url, `ที่มา: ${shortCredit(file.credit_th)} (รายงาน PDF) ↗`));
  return root;
}

/** A canal by the site's trial outlook (D35): its level, each factor with its points, and how the score is made. */
function canalPopup(
  id: string,
  name: string,
  outlook: CanalOutlook | null,
  now: number,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup canal-popup';
  root.append(line(name, 'strong'));
  const watch = outlook?.canals.find((canal) => canal.id === id);
  if (!outlook || !watch) root.append(line('ยังไม่มีผลประเมินของคลองนี้'));
  else {
    const level = line(canalWords(watch), 'b');
    level.className = `canal-level ${canalLevel(watch)}`;
    root.append(level);
    if (watch.factors.length) {
      const list = document.createElement('ul');
      list.className = 'flow-points';
      for (const factor of watch.factors) {
        const entry = document.createElement('li');
        entry.textContent = factorText(factor);
        list.append(entry);
      }
      root.append(list);
    } else root.append(line('ยังไม่มีปัจจัยที่ทำให้น้ำในคลองสูงขึ้นจากข้อมูลที่มี'));
    root.append(
      line(
        `เกณฑ์ทดลองของเว็บ ไม่ใช่ประกาศ · คิดเมื่อ ${reportTime(outlook.generated_at, now)}`,
        'small',
      ),
    );
    if (canalsOld(outlook, now)) {
      const old = line('ผลประเมินไม่อัปเดต แสดงผลครั้งก่อน', 'small');
      old.className = 'popup-old';
      root.append(old);
    }
  }
  root.append(pageLink('method/#canals', 'วิธีคิดคะแนน →'));
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
    line(`ฝน 24 ชม. ถึงรอบตรวจเช้า: ${rainAmountWords(station.rain_mm, 24)}`, 'b'),
  );
  if (temps.length) root.append(line(temps.join(' · ')));
  if (station.humidity_pct !== null) root.append(line(`ความชื้น ${station.humidity_pct}%`));
  root.append(
    line(
      station.observed_at ? `ตรวจเมื่อ ${reportTime(station.observed_at, now)}` : 'ไม่มีเวลาตรวจ',
    ),
    ...note(file.fetched_at, now),
    sourceLink(file.source_url, file.credit_th),
  );
  return root;
}

const FLOOD_NEAR_STATION_M = 1_000;

function waterPopup(
  station: CanalStation,
  file: CanalLevels,
  now: number,
  floods: FloodReport[],
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  // the level, and whether it rose or fell since the reading before (user 2026-10-02: a level above the sea alone
  // says neither high nor low); "critical" is never guessed, the department gives no bank level
  const level = line(
    station.level_in_m === null
      ? 'น้ำในคลอง: ไม่มีค่าล่าสุด'
      : `น้ำในคลอง ${levelSigned(station.level_in_m)}`,
    'b',
  );
  const change = levelChange(station);
  if (change) {
    const words = document.createElement('span');
    words.className = change.cm > 1 ? 'level-up' : change.cm < -1 ? 'level-down' : 'level-steady';
    words.textContent = levelChangeWords(change);
    level.append(' · ', words);
  }
  root.append(
    line(station.name_th, 'strong'),
    line([station.canal_th, district(station.district_th)].filter(Boolean).join(' · ')),
    level,
  );
  // the outer side and the pumps on one line, so that the card stays shorter than the map on a phone. How many
  // pumps run, as the station reports it: a count, never turned into a drainage capacity; a station that lists
  // more running pumps than it has is not given a "5 of 4"
  const running = station.pumps_running;
  const station_line = [
    station.level_out_m !== null && `ฝั่งที่ระบายออก ${levelSigned(station.level_out_m)}`,
    running != null &&
      (running > 0 || station.pumps) &&
      (running === 0
        ? `เครื่องสูบน้ำหยุดทั้ง ${station.pumps} เครื่อง`
        : station.pumps && running <= station.pumps
          ? `เครื่องสูบน้ำเดินอยู่ ${running} จาก ${station.pumps} เครื่อง`
          : `เครื่องสูบน้ำเดินอยู่ ${running} เครื่อง`),
  ].filter(Boolean);
  if (station_line.length) root.append(line(station_line.join(' · ')));
  // flood reports of people near the station: what the level cannot say, they sometimes do (only when there are)
  const near = station.location
    ? floods.filter(
        (report) =>
          isOngoing(report, now) &&
          distanceM(station.location!, report.location) <= FLOOD_NEAR_STATION_M,
      ).length
    : 0;
  if (near) {
    const words = line(`มีรายงานน้ำท่วมใกล้จุดนี้ ${near} จุด (ในรัศมี 1 กม.)`);
    words.className = 'release-alarm';
    root.append(words);
  }
  root.append(
    line(LEVEL_NO_BANK_TH, 'small'),
    line(measuredText(station.observed_at, now)),
    ...note(file.fetched_at, now),
    sourceLink(file.source_url, file.credit_th),
  );
  return root;
}

function rainPopup(gauge: RainGauge, file: RainGauges, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  root.append(
    line(gauge.name_th, 'strong'),
    line(district(gauge.district_th)),
    line(`ชั่วโมงล่าสุด: ${rainAmountWords(gauge.rain_1h_mm, 1)}`, 'b'),
    line(`รวม 24 ชม.: ${rainAmountWords(gauge.rain_24h_mm, 24)}`),
    line(
      [
        lastQuarterText(gauge.rain_15min_mm),
        gauge.rain_3h_mm !== null && `3 ชม. ${mmText(gauge.rain_3h_mm)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
    line(measuredText(gauge.observed_at, now)),
    ...note(file.fetched_at, now),
    sourceLink(file.source_url, file.credit_th),
  );
  return root;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** The trend in words over a small chart of the flow's shape (no scale: the model's m³/s is not shown). */
function riverPopup(point: RiverPoint, file: RiverForecast, now: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'camera-popup';
  const outlook = riverOutlook(file, point, now);
  const color =
    RIVER_CLASSES.find((item) => item.trend === outlook?.trend)?.color ?? RIVER_UNKNOWN_COLOR;
  root.append(
    line(`แม่น้ำ${point.name_th}`, 'strong'),
    line(`แนวโน้ม 7 วันข้างหน้า (ทดลอง): ${riverWords(outlook)}`, 'b'),
  );
  if (outlook) {
    const width = 230;
    const height = 54;
    const chart = riverChart(file, point, outlook.today, width, height);
    const figure = svg('svg', {
      viewBox: `0 0 ${width} ${height + 14}`,
      width,
      height: height + 14,
      class: 'river-chart',
      role: 'img',
      'aria-label': `กราฟ ${outlook.today} วันย้อนหลังถึง ${file.days.length - 1 - outlook.today} วันข้างหน้า: ${riverWords(outlook)}`,
    });
    if (chart.band) figure.append(svg('path', { d: chart.band, fill: color, opacity: 0.18 }));
    figure.append(
      svg('path', {
        d: chart.past,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.5,
        opacity: 0.5,
      }),
      svg('path', { d: chart.ahead, fill: 'none', stroke: color, 'stroke-width': 2 }),
      svg('line', {
        x1: chart.todayX,
        x2: chart.todayX,
        y1: 0,
        y2: height,
        stroke: 'currentColor',
        'stroke-dasharray': '3 3',
        opacity: 0.6,
      }),
    );
    // "today" sits at the top of its line, clear of the day labels under the chart
    for (const [x, y, text, anchor] of [
      [0, height + 12, `−${outlook.today} วัน`, 'start'],
      [chart.todayX + 3, 9, 'วันนี้', 'start'],
      [width, height + 12, `+${file.days.length - 1 - outlook.today} วัน`, 'end'],
    ] as const) {
      const label = svg('text', { x, y, 'text-anchor': anchor, 'font-size': 10 });
      label.textContent = text;
      figure.append(label);
    }
    root.append(figure);
  }
  root.append(
    line('ค่าจากแบบจำลอง ใช้ดูแนวโน้ม ไม่ใช่ระดับน้ำที่วัดจริง', 'small'),
    line(`พยากรณ์เมื่อ ${reportTime(file.fetched_at, now)}`),
  );
  if (now - Date.parse(file.fetched_at) > RIVERS_STALE_MS) {
    const stale = line(
      `พยากรณ์ไม่อัปเดต · ข้อมูล ณ วันที่ ${thaiDay(file.days[7] ?? file.days[0])}`,
      'small',
    );
    stale.className = 'popup-old';
    root.append(stale);
  }
  root.append(sourceLink(file.source_url, file.credit_th));
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
  // the department's page lists every camera: say which one to look for there
  link.textContent = camera.page_url.startsWith('https://telemetry.dwr.go.th/reportCctv')
    ? `เปิดหน้ากล้องของกรมทรัพยากรน้ำ แล้วหา “${camera.name_th}” ↗`
    : 'เปิดดูกล้องที่เว็บเจ้าของ ↗';
  root.append(link);
  return root;
}

export default function MapView(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const favoriteMarker = useRef<Marker | null>(null);
  const pinTag = useRef<HTMLSpanElement | null>(null);
  const popup = useRef<Popup | null>(null);
  const popupKind = useRef<PointKind | null>(null);
  /** rebuilds the open popup for a time, or null when what it shows is gone (an expired report, a removed file) */
  const popupRebuild = useRef<((now: number) => HTMLElement | null) | null>(null);
  const popupShown = useRef<HTMLElement | null>(null);
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
        // pins and bubbles are drawn when first needed; since MapLibre 6 only a resolver (not the
        // styleimagemissing event) can supply a picture for the layout that asked for it
        instance.setMissingStyleImageResolver((id) => {
          const picture = mapImage(id);
          if (picture && !instance.hasImage(id))
            instance.addImage(id, picture, { pixelRatio: MAP_IMAGE_RATIO });
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
        // the map's credit folds into its (i) five seconds after the map opens, or at the first touch of the map
        // (user 2026-10-03: small from the start). OpenStreetMap's attribution guidelines want it seen when the
        // map opens and allow it to fold after five seconds or on interaction; the (i) opens it again
        let creditFolded = false;
        const foldCredit = (tries = 0) => {
          if (creditFolded || disposed) return;
          const credit = instance
            .getContainer()
            .querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
          if (!credit) {
            // its text has not arrived yet; MapLibre opens it when it does
            if (tries < 30) window.setTimeout(() => foldCredit(tries + 1), 1_000);
            return;
          }
          creditFolded = true;
          credit.classList.remove('maplibregl-compact-show');
        };
        window.setTimeout(() => foldCredit(), 5_000);
        instance.once('mousedown', () => foldCredit());
        instance.once('touchstart', () => foldCredit());
        instance.once('wheel', () => foldCredit());
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
          if (disposed) return;
          setRendering(false);
          // The canvas description follows labels actually drawn in this view, including collisions.
          const names = instance.getLayer('watch-label')
            ? [
                ...new Set(
                  instance
                    .queryRenderedFeatures({ layers: ['watch-label'] })
                    .map((feature) => feature.properties.place),
                ),
              ]
            : [];
          if (names.length)
            instance
              .getCanvas()
              .setAttribute(
                'aria-description',
                `พื้นที่ในกรอบที่เห็น (การประเมินของเว็บแบบทดลอง): ${names.join(' · ')}`,
              );
          else instance.getCanvas().removeAttribute('aria-description');
        });
        // Do not describe labels from the previous view while new tiles and placements are still loading.
        instance.on('movestart', () => instance.getCanvas().removeAttribute('aria-description'));
        instance.on('zoomend', () => {
          if (!disposed) setZoom(Math.round(instance.getZoom() * 10) / 10);
        });
        instance.getCanvas().addEventListener('webglcontextlost', () => {
          if (!disposed) setUnavailable(true);
        });
        instance.on('load', () => {
          addOverlays(instance);
          sizePopups(instance);
          instance.on('resize', () => sizePopups(instance));
          const open = (
            kind: PointKind,
            at: LngLat,
            content: HTMLElement,
            rebuild: ((now: number) => HTMLElement | null) | null = null,
          ) => {
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
              popupRebuild.current = null;
              popupShown.current = null;
            });
            popup.current = next;
            popupKind.current = kind;
            popupRebuild.current = rebuild;
            popupShown.current = content;
            next.addTo(instance);
            fitPopup(instance, next, at);
          };
          showFlood.current = (report) => {
            const at = report.location as LngLat;
            const here = () => {
              popup.current?.remove();
              latest.current.onPin(at);
            };
            open('flood', at, floodPopup(report, Date.now(), here), (now) => {
              // the report itself, while it is still shown (D33): another report staying is no reason (M17)
              const current = latest.current.floods.find((r) => r.id === report.id);
              return current && isShown(current, now) ? floodPopup(current, now, here) : null;
            });
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
            // a severe pin (never in a bubble) opens like the others of its kind
            const layer = hit?.layer.id
              .replace(/-top$/, '-pin')
              .replace(/^river-line$/, 'river-pin');
            if (layer === 'bank-reach' || layer === 'bank-point') {
              const item = latest.current.water?.bank_observations?.find(
                (v) => v.id === hit?.properties.id,
              );
              if (item)
                return open(
                  'bank',
                  [event.lngLat.lng, event.lngLat.lat],
                  bankPopup(item, latest.current.now),
                  (now) => {
                    const current = latest.current.water?.bank_observations?.find(
                      (v) => v.id === item.id,
                    );
                    return current && latest.current.layers.water ? bankPopup(current, now) : null;
                  },
                );
            }
            if (hit && layer?.endsWith('-cluster')) {
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
            if (layer === 'flow-pin' && latest.current.flows) {
              const file = latest.current.flows;
              const site = file.sites.find((s) => s.id === hit?.properties.code);
              if (site)
                return open(
                  'flow',
                  site.location as LngLat,
                  flowPopup(site, file, Date.now()),
                  (now) => {
                    const flows = latest.current.flows;
                    const current = flows?.sites.find((s) => s.id === site.id);
                    return flows && current ? flowPopup(current, flows, now) : null;
                  },
                );
            }
            if (layer === 'canal-line') {
              const id = String(hit?.properties.id ?? '');
              const name = String(hit?.properties.name ?? '');
              if (id)
                return open(
                  'canal',
                  [event.lngLat.lng, event.lngLat.lat],
                  canalPopup(id, name, latest.current.canalOutlook, Date.now()),
                  (now) =>
                    latest.current.canalShapes?.features.some((f) => f.properties?.id === id)
                      ? canalPopup(id, name, latest.current.canalOutlook, now)
                      : null,
                );
            }
            if (layer === 'dam-pin') {
              const barrage = BARRAGES.find((b) => b.id === hit?.properties.code);
              if (barrage) return open('dam', barrage.location as LngLat, barragePopup(barrage));
            }
            if (layer === 'dam-pin' && latest.current.dams) {
              const file = latest.current.dams;
              const dam = file.dams.find((d) => d.id === hit?.properties.code);
              if (dam?.location)
                return open(
                  'dam',
                  dam.location as LngLat,
                  damPopup(dam, file, Date.now()),
                  (now) => {
                    const dams = latest.current.dams;
                    const current = dams?.dams.find((d) => d.id === dam.id);
                    return dams && current ? damPopup(current, dams, now) : null;
                  },
                );
            }
            if (layer === 'river-pin' && latest.current.rivers) {
              const file = latest.current.rivers;
              const point = file.points.find((p) => p.id === hit?.properties.code);
              if (point)
                return open(
                  'river',
                  point.location as LngLat,
                  riverPopup(point, file, Date.now()),
                  (now) => {
                    const rivers = latest.current.rivers;
                    const current = rivers?.points.find((p) => p.id === point.id);
                    return rivers && current ? riverPopup(current, rivers, now) : null;
                  },
                );
            }
            if (layer === 'weather-pin' && latest.current.weather) {
              const file = latest.current.weather;
              const station = file.stations.find((s) => s.wmo === hit?.properties.code);
              if (station?.location)
                return open(
                  'weather',
                  station.location as LngLat,
                  weatherPopup(station, file, Date.now()),
                  (now) => {
                    const weather = latest.current.weather;
                    const current = weather?.stations.find((s) => s.wmo === station.wmo);
                    return weather && current ? weatherPopup(current, weather, now) : null;
                  },
                );
            }
            if (layer === 'water-pin' && latest.current.water) {
              const file = latest.current.water;
              const station = file.stations.find((s) => s.code === hit?.properties.code);
              if (station?.location)
                return open(
                  'water',
                  station.location as LngLat,
                  waterPopup(station, file, Date.now(), latest.current.floods),
                  (now) => {
                    const water = latest.current.water;
                    const current = water?.stations.find((s) => s.code === station.code);
                    return water && current
                      ? waterPopup(current, water, now, latest.current.floods)
                      : null;
                  },
                );
            }
            if (layer === 'rain-pin' && latest.current.rain) {
              const file = latest.current.rain;
              const gauge = file.gauges.find((g) => g.code === hit?.properties.code);
              if (gauge?.location)
                return open(
                  'rain',
                  gauge.location as LngLat,
                  rainPopup(gauge, file, Date.now()),
                  (now) => {
                    const rain = latest.current.rain;
                    const current = rain?.gauges.find((g) => g.code === gauge.code);
                    return rain && current ? rainPopup(current, rain, now) : null;
                  },
                );
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
          // the saved place: a star pin that stays, and opens the place when tapped
          const star = document.createElement('button');
          star.type = 'button';
          star.className = 'favorite-pin';
          star.innerHTML =
            '<span class="favorite-pin-head"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.1 6.4 20l1.1-6.2L2.9 9.4l6.3-.9z"/></svg></span>';
          star.addEventListener('click', (event) => {
            event.stopPropagation();
            latest.current.onFavorite();
          });
          favoriteMarker.current = new maplibre.Marker({ element: star, anchor: 'bottom' });
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

  // Stretches of river the model sees rising; the casing follows the basemap like the outlines'
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    (instance.getSource('river-lines') as GeoJSONSource | undefined)?.setData(
      props.riverStretches ?? { type: 'FeatureCollection', features: [] },
    );
    if (instance.getLayer('river-line-casing'))
      instance.setPaintProperty(
        'river-line-casing',
        'line-color',
        props.theme === 'dark' ? '#10181f' : '#ffffff',
      );
  }, [props.riverStretches, props.theme, ready, styleVersion]);

  // Outlines of the summary's places; the casing follows the basemap so the line stands out on both
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    (instance.getSource('watch') as GeoJSONSource | undefined)?.setData(props.watch);
    if (instance.getLayer('watch-casing'))
      instance.setPaintProperty(
        'watch-casing',
        'line-color',
        props.theme === 'dark' ? '#10181f' : '#ffffff',
      );
    if (instance.getLayer('watch-label')) {
      instance.setPaintProperty(
        'watch-label',
        'text-halo-color',
        props.theme === 'dark' ? '#10181f' : '#ffffff',
      );
      instance.setPaintProperty(
        'watch-label',
        'text-color',
        props.theme === 'dark'
          ? ['case', ['==', ['get', 'when'], 'now'], '#ffb9b9', '#ffd09e']
          : ['case', ['==', ['get', 'when'], 'now'], '#971d1d', '#914400'],
      );
    }
  }, [props.watch, props.theme, ready, styleVersion]);

  // Radar frame as an image overlay under the outlines and the pins
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
        'river-line-casing',
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
            ![
              'alert-line',
              'river-line-casing',
              'watch-casing',
              'watch-line',
              'watch-label',
              'radar',
              ...POINT_LAYERS,
            ].includes(layer.id),
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
        ? props.floods
            .filter((report) => isShown(report, props.now))
            .map((report) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: report.location },
              properties: {
                id: report.id,
                ongoing: isOngoing(report, props.now),
                severe: isOngoing(report, props.now),
                rank: isOngoing(report, props.now) ? 1 : 0,
              },
            }))
        : [],
    };
    setPoints(map.current, 'floods', collection);
    if (!collection.features.length && popupKind.current === 'flood') popup.current?.remove();
  }, [props.floods, props.layers.floods, props.now, ready, styleVersion]);

  // Large dams (DXS, placed from OpenStreetMap), coloured by how full they are
  useEffect(() => {
    if (!ready || !map.current) return;
    const dams = props.layers.dams ? (props.dams?.dams ?? []) : [];
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: [
        ...dams.flatMap((dam) => {
          if (!dam.location) return [];
          const pin = damPin(shownDam(dam)); // a blank dam keeps the class of its last known figures
          const alarm = !!props.dams?.previous_report_date && !!releaseChange(dam)?.big;
          const severe = pin === 'pin-dam-full' || alarm;
          return [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: dam.location },
              properties: {
                code: dam.id,
                pin,
                severe,
                alarm,
                rank: DAM_CLASSES.findIndex((c) => c.pin === pin),
              },
            },
          ];
        }),
        // the barrages go with the dams, grey, while no figure of theirs is on this site: RID's daily report has
        // them (D35), and then their pins are those of its layer
        ...(dams.length && !props.flows?.sites.length
          ? BARRAGES.map((barrage) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: barrage.location },
              properties: { code: barrage.id, pin: 'pin-dam-unknown', rank: -1 },
            }))
          : []),
      ],
    };
    setPoints(map.current, 'dams', collection);
    if (!collection.features.length && popupKind.current === 'dam') popup.current?.remove();
  }, [props.dams, props.flows, props.layers.dams, ready, styleVersion]);

  // RID's stations, barrages and gates (D35), coloured by RID's own state of the station there
  useEffect(() => {
    if (!ready || !map.current) return;
    const collection = flowFeatures(props.layers.flows ? props.flows : null, props.now);
    setPoints(map.current, 'flows', collection);
    if (!collection.features.length && popupKind.current === 'flow') popup.current?.remove();
  }, [props.flows, props.layers.flows, props.now, ready, styleVersion]);

  // The canals of the pilot by the trial outlook (D35); the casing follows the basemap like the river lines'
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    (instance.getSource('canal-lines') as GeoJSONSource | undefined)?.setData(
      props.canalShapes ?? { type: 'FeatureCollection', features: [] },
    );
    if (instance.getLayer('canal-line-casing'))
      instance.setPaintProperty(
        'canal-line-casing',
        'line-color',
        props.theme === 'dark' ? '#10181f' : '#ffffff',
      );
    if (!props.canalShapes?.features.length && popupKind.current === 'canal')
      popup.current?.remove();
  }, [props.canalShapes, props.theme, ready, styleVersion]);

  // An open popup follows the clock and the files: its age labels change, and it closes when what it shows is
  // gone (a report past its time, a station no longer in the file). Rebuilt only when its words change.
  useEffect(() => {
    const current = popup.current;
    const rebuild = popupRebuild.current;
    if (!current || !rebuild) return;
    const content = rebuild(props.now);
    const focused = current.getElement()?.contains(document.activeElement) ?? false;
    if (!content) {
      current.remove();
      // the popup closed under the keyboard: focus goes back to the map, not to the top of the page
      if (focused) map.current?.getCanvas().focus();
      return;
    }
    const shown = popupShown.current;
    if (content.textContent === shown?.textContent) return;
    if (shown?.isConnected) {
      // setDOMContent would rebuild the close button and focus the first link (Codex M25): the new words go into
      // the element already shown instead, and a control inside them keeps focus by its place among the controls
      const controls = (root: HTMLElement) => [
        ...root.querySelectorAll<HTMLElement>('a[href], button'),
      ];
      const at = focused ? controls(shown).indexOf(document.activeElement as HTMLElement) : -1;
      shown.className = content.className;
      shown.replaceChildren(...content.childNodes);
      if (at >= 0) controls(shown)[at]?.focus();
      current.setLngLat(current.getLngLat());
    } else {
      current.setDOMContent(content);
      popupShown.current = content;
    }
  }, [
    props.now,
    props.floods,
    props.rivers,
    props.water,
    props.rain,
    props.dams,
    props.weather,
    props.flows,
    props.canalShapes,
    props.canalOutlook,
  ]);

  // The GloFAS river trend, coloured by the next 7 days against today (model values)
  useEffect(() => {
    if (!ready || !map.current) return;
    const file = props.layers.rivers ? props.rivers : null;
    const collection: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: (file?.points ?? [])
        .filter((point) => point.kind !== 'reach')
        .map((point) => {
          const pin = riverPin(file!, point, props.now);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: point.location },
            properties: {
              code: point.id,
              pin,
              severe: pin === RIVER_CLASSES[0].pin,
              rank: RIVER_CLASSES.length - RIVER_CLASSES.findIndex((c) => c.pin === pin),
            },
          };
        }),
    };
    setPoints(map.current, 'rivers', collection);
    if (!collection.features.length && popupKind.current === 'river') popup.current?.remove();
  }, [props.rivers, props.layers.rivers, props.now, ready, styleVersion]);

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
              severe: DAY_RAIN_CLASSES.findIndex((c) => c.pin === pin) >= 3,
              rank: DAY_RAIN_CLASSES.findIndex((c) => c.pin === pin),
            },
          },
        ];
      }),
    };
    setPoints(map.current, 'weather', collection);
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
    const banks = bankFeatures(props.layers.water ? props.water : null, props.now);
    (map.current.getSource('bank-evidence') as GeoJSONSource | undefined)?.setData(banks);
    if (!banks.features.length && popupKind.current === 'bank') popup.current?.remove();
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
              severe: RAIN_HOUR_CLASSES.findIndex((item) => item.pin === pin) >= 4,
              rank: RAIN_HOUR_CLASSES.findIndex((item) => item.pin === pin),
            },
          },
        ];
      }),
    };
    setPoints(map.current, 'rain', collection);
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

  // The saved place stays on the map as a star pin
  useEffect(() => {
    const instance = map.current;
    const marker = favoriteMarker.current;
    if (!ready || !instance || !marker) return;
    if (!props.favoriteLocation) {
      marker.remove();
      return;
    }
    marker.setLngLat(props.favoriteLocation).addTo(instance);
    const name = `ที่ของฉัน ${props.favoriteLabel ?? ''}`.trim();
    marker.getElement().setAttribute('aria-label', name);
    marker.getElement().title = name;
  }, [props.favoriteLocation?.[0], props.favoriteLocation?.[1], props.favoriteLabel, ready]);

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

  // the key says why few pins show on the first view
  useEffect(() => {
    latest.current.onOverview?.(zoom < DETAIL_ZOOM);
  }, [zoom]);

  // for the tests: which outlines and stretches the map has, made when they change and not on every render
  const watchCodes = useMemo(
    () => props.watch.features.map((feature) => feature.properties.code).join(' '),
    [props.watch],
  );
  const riverCodes = useMemo(
    () =>
      (props.riverStretches?.features ?? [])
        .map((feature) => `${feature.properties.code}:${feature.properties.trend}`)
        .join(' '),
    [props.riverStretches],
  );
  const canalCodes = useMemo(
    () =>
      (props.canalShapes?.features ?? [])
        .map((feature) => `${feature.properties?.id}:${feature.properties?.level}`)
        .join(' '),
    [props.canalShapes],
  );

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
      data-watch={watchCodes}
      data-rivers={riverCodes}
      data-canals={canalCodes}
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
