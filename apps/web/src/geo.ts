import type { RadarFeed } from '../../../contracts/v1/ts/radar';

type Ring = number[][];

// Ray casting on [lon, lat] rings; points on an edge may fall either way, which is fine for a pin.
function inRing(point: number[], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
export function inMultiPolygon(point: number[], polygons: Ring[][]): boolean {
  return polygons.some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)),
  );
}

/** Pixel of [lon, lat] in a radar frame of width × height, or null outside the image. */
export function radarPixel(
  corners: number[][],
  width: number,
  height: number,
  point: number[],
): { x: number; y: number } | null {
  const [west, north] = corners[0];
  const [east, south] = corners[2];
  if (point[0] < west || point[0] >= east || point[1] > north || point[1] <= south) return null;
  return {
    x: Math.floor(((point[0] - west) / (east - west)) * width),
    y: Math.floor(((north - point[1]) / (north - south)) * height),
  };
}

export type RadarLegendItem = RadarFeed['legend'][number];
/** Legend class of an RGBA pixel: frames show legend colours blended over white (legend_opacity). */
export function radarClass(
  rgba: ArrayLike<number>,
  legend: RadarLegendItem[],
  opacity: number,
): RadarLegendItem | null {
  if (rgba[3] < 16) return null;
  let best: RadarLegendItem | null = null;
  let bestDistance = Infinity;
  for (const item of legend) {
    const hex = item.color.slice(1);
    const expected = [0, 2, 4].map(
      (i) => parseInt(hex.slice(i, i + 2), 16) * opacity + 255 * (1 - opacity),
    );
    const distance = expected.reduce((sum, value, i) => sum + (value - rgba[i]) ** 2, 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

/** Plain Thai words for a rain-rate class (mm/hr lower bound of the radar legend). */
export function rainWords(minMmPerHr: number | null): string {
  if (minMmPerHr === null) return 'ไม่มีข้อมูลเรดาร์ตรงจุดนี้';
  if (minMmPerHr < 1) return 'ฝนเล็กน้อย';
  if (minMmPerHr < 4) return 'ฝนเบา';
  if (minMmPerHr < 16) return 'ฝนปานกลาง';
  if (minMmPerHr < 48) return 'ฝนหนัก';
  return 'ฝนหนักมาก';
}
