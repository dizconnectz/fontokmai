import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Boundaries, FloodFrequency, PlaceGazetteer, SatelliteFloods } from './data';

// GISTDA's flooded area seen from satellites (contract section 28): an agency's map of water, summed by district,
// never a figure of this site. A district without water in the file was not seen flooded in the window, which is
// not the same as dry: a satellite does not pass over every place every day.
export type { SatelliteFloods };
export type SatelliteDistrict = SatelliteFloods['districts'][number];
/** Checked every 3 hours; older than this the layer is said to be old. */
export const SATELLITE_STALE_MS = 36 * 3_600_000;
/** How far a flooded district may be from the saved place to be "near" it (to its subdistrict points). */
export const NEAR_KM = 10;

/** Classes of the flooded area of a district (km²), the largest first: the colour of its outline on the map. */
export const SATELLITE_CLASSES: { min: number; color: string; label: string }[] = [
  { min: 20, color: '#08306b', label: '20+' },
  { min: 5, color: '#2171b5', label: '5–20' },
  { min: 1, color: '#4292c6', label: '1–5' },
  { min: 0, color: '#9ecae1', label: '<1' },
];

export function satelliteColor(areaKm2: number): string {
  return SATELLITE_CLASSES.find((item) => areaKm2 >= item.min)!.color;
}

export function satelliteOld(file: SatelliteFloods, now: number): boolean {
  return now - Date.parse(file.fetched_at) > SATELLITE_STALE_MS;
}

export type SatelliteShapes = FeatureCollection<
  MultiPolygon,
  { code: string; color: string; area: number }
>;
/** The outlines of the districts with water, coloured by its area. */
export function satelliteShapes(file: SatelliteFloods, boundaries: Boundaries): SatelliteShapes {
  const outlines = new Map(boundaries.areas.map((area) => [area.code, area.outline]));
  return {
    type: 'FeatureCollection',
    features: file.districts.flatMap((district) => {
      const outline = outlines.get(district.code) as MultiPolygon | Polygon | undefined;
      if (!outline) return [];
      const coordinates =
        outline.type === 'Polygon'
          ? [outline.coordinates]
          : (outline.coordinates as number[][][][]);
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'MultiPolygon' as const, coordinates },
          properties: {
            code: district.code,
            color: satelliteColor(district.area_km2),
            area: district.area_km2,
          },
        },
      ];
    }),
  };
}

function km(a: number[], b: number[]): number {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return 6371 * Math.hypot(x, y);
}

export interface SatelliteNear {
  /** the district of the point, when GISTDA saw water in it */
  here: SatelliteDistrict | null;
  /** other districts with water within NEAR_KM of the point, the nearest first */
  near: { district: SatelliteDistrict; km: number }[];
}
/**
 * Water GISTDA saw in the district of a point (named by its nearest subdistrict, as the saved place's line does)
 * and in districts whose subdistrict points lie within NEAR_KM of it.
 */
export function satelliteNear(
  file: SatelliteFloods,
  places: PlaceGazetteer,
  point: number[],
  district: string | null,
): SatelliteNear {
  const flooded = new Map(file.districts.map((d) => [d.code, d]));
  const here = district ? (flooded.get(district) ?? null) : null;
  const nearest = new Map<string, number>();
  for (const place of places.places) {
    if (place.kind !== 'subdistrict') continue;
    const code = place.code.slice(0, 4);
    if (code === district || !flooded.has(code)) continue;
    const distance = km(point, place.location);
    if (distance <= NEAR_KM && distance < (nearest.get(code) ?? Infinity))
      nearest.set(code, distance);
  }
  return {
    here,
    near: [...nearest]
      .map(([code, distance]) => ({ district: flooded.get(code)!, km: distance }))
      .sort((a, b) => a.km - b.km),
  };
}

const AREA = (km2: number) =>
  km2 >= 10
    ? Math.round(km2).toLocaleString('th-TH')
    : km2.toLocaleString('th-TH', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** "น้ำท่วมราว 12 ตร.กม. · ประชากรในพื้นที่ราว 3,400 คน" in plain words */
export function satelliteWords(district: SatelliteDistrict): string {
  const area = district.area_km2 < 0.1 ? 'น้อยกว่า 0.1' : AREA(district.area_km2);
  const people =
    district.population && district.population > 0
      ? ` · ประชากรในพื้นที่น้ำราว ${district.population.toLocaleString('th-TH')} คน`
      : '';
  return `น้ำท่วมราว ${area} ตร.กม.${people}`;
}

const SHORT_DAY = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
});
/** "GISTDA · ภาพดาวเทียมถึง 2 ต.ค." for the credit line */
export function satelliteSource(file: SatelliteFloods): string {
  const day = file.latest_scene_day
    ? ` · ภาพดาวเทียมล่าสุด ${SHORT_DAY.format(Date.parse(`${file.latest_scene_day}T12:00:00+07:00`))}`
    : '';
  return `ที่มา: GISTDA (ข้อมูลเปิดภาครัฐ)${day} · ในรอบ ${file.window_days} วัน`;
}

export type FloodFrequencyArea = FloodFrequency['subdistricts'][number];

export interface FrequencyHere {
  /** the subdistrict in GISTDA's statistic, or null when the statistic covers its province but has no land of it */
  area: FloodFrequencyArea | null;
}
/**
 * GISTDA's recurrent flooding of the subdistrict with this DOPA code; undefined when the file does not cover its
 * province (nothing is said then: not covered is not "never flooded").
 */
export function frequencyAt(file: FloodFrequency, subdistrict: string): FrequencyHere | undefined {
  if (!file.provinces.includes(subdistrict.slice(0, 2))) return undefined;
  return { area: file.subdistricts.find((s) => s.code === subdistrict) ?? null };
}

const RAI = (rai: number) =>
  rai >= 10
    ? Math.round(rai).toLocaleString('th-TH')
    : rai.toLocaleString('th-TH', { maximumFractionDigits: 1 });

/** "เคยท่วมรวมราว 120 ไร่ · บางส่วนท่วมซ้ำถึง 4 ครั้ง (ท่วม 2 ครั้งขึ้นไปราว 30 ไร่)" */
export function frequencyWords(area: FloodFrequencyArea): string {
  const repeated = area.rai_by_freq.slice(1).reduce((sum, rai) => sum + rai, 0);
  const again =
    area.max_freq > 1
      ? ` · บางส่วนท่วมซ้ำถึง ${area.max_freq} ครั้ง (ท่วม 2 ครั้งขึ้นไปราว ${RAI(repeated)} ไร่)`
      : ' · ท่วมครั้งเดียว ไม่พบท่วมซ้ำ';
  return `เคยท่วมรวมราว ${RAI(area.area_rai)} ไร่${again}`;
}

const CLOCK = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Why the satellite map has nothing to draw, said when its button is pressed (user 2026-10-05: on a day GISTDA maps
 * no water the button vanished and looked broken); null when there are districts to show.
 */
export function satelliteEmptyWords(file: SatelliteFloods, now: number): string | null {
  const at = `ข้อมูล ${CLOCK.format(Date.parse(file.fetched_at))} น.`;
  if (satelliteOld(file, now)) return `แผนที่น้ำท่วมจากดาวเทียมไม่อัปเดต (${at}) จึงไม่แสดง`;
  if (!file.districts.length)
    return `ดาวเทียมไม่พบพื้นที่น้ำท่วมในรอบ ${file.window_days} วัน (${at}) · ไม่ได้แปลว่าไม่มีน้ำท่วม`;
  return null;
}
