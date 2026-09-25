import type { RoadFloodHistory, RoadFloodRoad } from '../../../contracts/v1/ts/road_flood_history';

// Same rules as pipeline/src/fontokmai/feeds/road_names.py (contract README section 8);
// examples/road-flood-history/expected.json checks both sides.
const EDGE = ' -–,.:;';
function stripEdges(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && EDGE.includes(text[start])) start++;
  while (end > start && EDGE.includes(text[end - 1])) end--;
  return text.slice(start, end);
}
function plain(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replaceAll('*', ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function cleanName(raw: string): string {
  const text = stripEdges(plain(raw))
    .replace(/^(?:ถนน|ถ\.|ถ\s)\s*/, '')
    .replace(/^(?:ซอย|ซ\.)\s*/, 'ซอย');
  return stripEdges(text);
}
export function searchKey(text: string): string {
  return cleanName(text)
    .replace(/[ \-–—]/g, '')
    .toLowerCase();
}
const byKey = (a: RoadFloodRoad, b: RoadFloodRoad) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function searchRoads(history: RoadFloodHistory, query: string): RoadFloodRoad[] {
  const key = searchKey(query);
  if (!key) return [];
  return history.roads
    .filter((road) => road.key.includes(key))
    .sort(
      (a, b) =>
        b.flood_days - a.flood_days || b.last_date.localeCompare(a.last_date) || byKey(a, b),
    );
}

const EARTH_RADIUS_M = 6_371_008.8;
export function distanceM(a: number[], b: number[]): number {
  const rad = Math.PI / 180;
  const [lon1, lat1, lon2, lat2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface NearRoad {
  road: RoadFloodRoad;
  distance: number;
}
export function roadsNear(history: RoadFloodHistory, pin: number[], radiusM = 2000): NearRoad[] {
  const hits: NearRoad[] = [];
  for (const road of history.roads) {
    if (!road.points.length) continue;
    const distance = Math.min(...road.points.map((point) => distanceM(pin, point)));
    if (distance <= radiusM) hits.push({ road, distance });
  }
  return hits.sort(
    (a, b) =>
      Math.round(a.distance) - Math.round(b.distance) ||
      b.road.flood_days - a.road.flood_days ||
      byKey(a.road, b.road),
  );
}
