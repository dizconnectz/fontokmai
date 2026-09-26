import type { Place, PlaceGazetteer } from '../../../contracts/v1/ts/places';
import { distanceM } from './roads';

export type { Place, PlaceGazetteer };
export type LngLat = [number, number];
export type Bounds = [LngLat, LngLat];

/** Something the search can fly to: a DOPA area or a landmark from OpenStreetMap. */
export interface FoundPlace {
  id: string;
  /** "อ.คลองหลวง" or "Future Park Rangsit" */
  title: string;
  /** "จ.ปทุมธานี" or "ต.ประชาธิปัตย์ อ.ธัญบุรี จ.ปทุมธานี" */
  detail: string;
  /** Short kind shown next to the result: จังหวัด, อำเภอ, เขต, ตำบล, แขวง, สถานที่ */
  kind: string;
  /** an area (its point is only a centre) or a point such as a building */
  scale: Place['kind'] | 'point';
  location: LngLat;
  bounds: Bounds;
  maxZoom: number;
  /** DOPA province name, so official alerts can also be matched by the provinces they list */
  province: string | null;
  source: 'dopa' | 'osm';
}

// Words people type before a name; the gazetteer keeps bare names (contract README section 11).
const PREFIX = /^(?:ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.)\s*/;
const ALIASES: Record<string, string> = {
  กทม: 'กรุงเทพมหานคร',
  'กทม.': 'กรุงเทพมหานคร',
  กรุงเทพฯ: 'กรุงเทพมหานคร',
  โคราช: 'นครราชสีมา',
};
const KIND_RANK: Record<Place['kind'], number> = { province: 0, district: 1, subdistrict: 2 };
// A name shared by a province and 27 subdistricts (หนองบัว…) most often means the larger area.
const KIND_BONUS: Record<Place['kind'], number> = { province: 1.1, district: 0.5, subdistrict: 0 };
// padding around the subdistrict points of an area, in degrees (the points sit inside the boundary)
const PAD: Record<Place['kind'], number> = { province: 0.08, district: 0.03, subdistrict: 0.02 };

/** Search words of a query: NFC, lower case, without ต./อำเภอ/จ. and the like. */
export function placeTokens(query: string): string[] {
  return query
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => ALIASES[word] ?? word.replace(PREFIX, ''))
    .map((word) => ALIASES[word] ?? word)
    .filter(Boolean);
}

interface Entry {
  place: Place;
  /** own name first, then the district and province names */
  chain: string[];
}
const indexes = new WeakMap<PlaceGazetteer, Entry[]>();
function indexOf(gazetteer: PlaceGazetteer): Entry[] {
  let entries = indexes.get(gazetteer);
  if (!entries) {
    const names = new Map(gazetteer.places.map((p) => [p.code, p.name]));
    entries = gazetteer.places.map((place) => ({
      place,
      chain: [place.code, place.code.slice(0, 4), place.code.slice(0, 2)]
        .filter((code, i, all) => all.indexOf(code) === i)
        .map((code) => names.get(code) ?? ''),
    }));
    indexes.set(gazetteer, entries);
  }
  return entries;
}

function nameScore(word: string, name: string): number {
  if (name === word) return 3;
  if (name.startsWith(word)) return 2;
  return name.includes(word) ? 1 : 0;
}
/**
 * Every word must be part of the place's own name or of a parent's name, and at least one word
 * part of its own name. The score is the mean per word: 3 exact, 2 prefix, 1 inside, 0.5 parent.
 */
function matchScore(words: string[], chain: string[]): number {
  let score = 0;
  let own = false;
  for (const word of words) {
    const self = nameScore(word, chain[0]);
    if (self) {
      own = true;
      score += self;
    } else if (chain.slice(1).some((name) => name.includes(word))) score += 0.5;
    else return 0;
  }
  return own ? score / words.length : 0;
}

/** Areas for a typed query, best first (rules in contract README section 11). */
export function searchPlaces(gazetteer: PlaceGazetteer, query: string, limit = 6): Place[] {
  const words = placeTokens(query);
  if (!words.length) return [];
  // "บาง นา" should still find บางนา first
  const joined = words.length > 1 ? [words.join('')] : null;
  const hits: { place: Place; score: number }[] = [];
  for (const { place, chain } of indexOf(gazetteer)) {
    const score = Math.max(matchScore(words, chain), joined ? matchScore(joined, chain) : 0);
    if (score > 0) hits.push({ place, score: score + KIND_BONUS[place.kind] });
  }
  return hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_RANK[a.place.kind] - KIND_RANK[b.place.kind] ||
        a.place.label.length - b.place.label.length ||
        (a.place.code < b.place.code ? -1 : 1),
    )
    .slice(0, limit)
    .map((hit) => hit.place);
}

/** Map extent to show an area: its subdistrict points plus a margin. */
export function placeBounds(gazetteer: PlaceGazetteer, place: Place): Bounds {
  const points =
    place.kind === 'subdistrict'
      ? [place.location]
      : gazetteer.places
          .filter((p) => p.kind === 'subdistrict' && p.code.startsWith(place.code))
          .map((p) => p.location);
  if (!points.length) points.push(place.location);
  const pad = PAD[place.kind];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    [Math.min(...xs) - pad, Math.min(...ys) - pad],
    [Math.max(...xs) + pad, Math.max(...ys) + pad],
  ];
}

const KIND_TH = {
  province: ['จังหวัด', 'จังหวัด'],
  district: ['อำเภอ', 'เขต'],
  subdistrict: ['ตำบล', 'แขวง'],
} as const;
export function foundFromPlace(gazetteer: PlaceGazetteer, place: Place): FoundPlace {
  const bangkok = place.code.startsWith('10');
  const [title, ...rest] = place.kind === 'province' ? [place.label] : place.label.split(' ');
  return {
    id: `dopa:${place.code}`,
    title,
    detail: rest.join(' '),
    kind: KIND_TH[place.kind][bangkok ? 1 : 0],
    scale: place.kind,
    location: place.location as LngLat,
    bounds: placeBounds(gazetteer, place),
    maxZoom: 14,
    province: gazetteer.places.find((p) => p.code === place.code.slice(0, 2))?.name ?? null,
    source: 'dopa',
  };
}

/** Subdistrict whose DOPA point is closest to a pin, to name the area around it. */
export function nearestSubdistrict(
  gazetteer: PlaceGazetteer,
  point: number[],
  maxM = 8_000,
): { place: Place; distance: number } | null {
  let best: { place: Place; distance: number } | null = null;
  for (const place of gazetteer.places) {
    if (place.kind !== 'subdistrict') continue;
    // cheap box test first (0.1° is about 11 km)
    if (
      Math.abs(place.location[0] - point[0]) > 0.1 ||
      Math.abs(place.location[1] - point[1]) > 0.1
    )
      continue;
    const distance = distanceM(point, place.location);
    if (distance <= maxM && (!best || distance < best.distance)) best = { place, distance };
  }
  return best;
}
