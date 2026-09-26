import type { Bounds, FoundPlace, LngLat } from './places';

// Landmark search: Photon by komoot on OpenStreetMap data (ODbL). Free, no key, fair use only,
// so the search box waits for a pause in typing and remembers answers (docs/sources.md).
export const PHOTON_URL = 'https://photon.komoot.io/api/';
const THAILAND = { west: 97.3, south: 5.6, east: 105.7, north: 20.5 };
const LIMIT = 5;
// half-size of the area to show around a point without an extent, in degrees, by Photon type
const SPAN: Record<string, number> = {
  state: 0.4,
  county: 0.1,
  city: 0.06,
  district: 0.015,
  locality: 0.015,
};
const LONG_PREFIX: [RegExp, string][] = [
  [/^ตำบล\s*/, 'ต.'],
  [/^อำเภอ\s*/, 'อ.'],
  [/^จังหวัด\s*/, 'จ.'],
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').trim().slice(0, 120) : '';
}
function short(value: string): string {
  return LONG_PREFIX.reduce((out, [pattern, prefix]) => out.replace(pattern, prefix), value);
}
function inThailand(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= THAILAND.west &&
    lon <= THAILAND.east &&
    lat >= THAILAND.south &&
    lat <= THAILAND.north
  );
}
/** Photon extent is [west, north, east, south]; a point gets a small area around it. */
function boundsOf(location: LngLat, extent: unknown, type: string): Bounds {
  if (Array.isArray(extent) && extent.length === 4) {
    const [west, north, east, south] = extent.map(Number);
    if (inThailand(west, north) && inThailand(east, south) && west <= east && south <= north) {
      const grow = (low: number, high: number) =>
        high - low < 0.004 ? [(low + high) / 2 - 0.002, (low + high) / 2 + 0.002] : [low, high];
      const [x0, x1] = grow(west, east);
      const [y0, y1] = grow(south, north);
      return [
        [x0, y0],
        [x1, y1],
      ];
    }
  }
  const span = SPAN[type] ?? 0.003;
  return [
    [location[0] - span, location[1] - span],
    [location[0] + span, location[1] + span],
  ];
}

/** Places from a Photon GeoJSON answer; anything malformed or outside Thailand is dropped. */
export function parsePhoton(value: unknown): FoundPlace[] {
  const features = (value as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const found: FoundPlace[] = [];
  for (const feature of features as {
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: Record<string, unknown>;
  }[]) {
    const coordinates = feature?.geometry?.coordinates;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates)) continue;
    const [lon, lat] = coordinates.map(Number);
    const properties = feature.properties ?? {};
    const name = text(properties.name);
    if (!name || !inThailand(lon, lat)) continue;
    const location: LngLat = [lon, lat];
    // bus stops and entrances are often named after the landmark next to them: keep the first one
    if (
      found.some(
        (f) =>
          f.title === name && Math.abs(f.location[0] - lon) + Math.abs(f.location[1] - lat) < 0.01,
      )
    )
      continue;
    const area = [properties.district, properties.city, properties.county, properties.state]
      .map((part) => short(text(part)))
      .filter((part, i, all) => part && part !== name && all.indexOf(part) === i);
    const type = text(properties.type);
    found.push({
      id: `osm:${text(properties.osm_type)}${text(String(properties.osm_id ?? ''))}:${lon},${lat}`,
      title: name,
      detail: area.join(' '),
      kind: 'สถานที่',
      scale: 'point',
      location,
      bounds: boundsOf(location, properties.extent, type),
      maxZoom: 16,
      province: null,
      source: 'osm',
    });
    if (found.length === LIMIT) break;
  }
  return found;
}

export async function searchPhoton(
  query: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<FoundPlace[]> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(LIMIT * 2));
  url.searchParams.set(
    'bbox',
    [THAILAND.west, THAILAND.south, THAILAND.east, THAILAND.north].join(','),
  );
  const response = await fetcher(url.href, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
  return parsePhoton(await response.json());
}
