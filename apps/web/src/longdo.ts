/**
 * Longdo Water (water.longdo.com) colours Bangkok's canals by how far the water is below the bank, from BMA's own
 * bank and threshold levels, which DXS does not give this site (user 2026-10-04: "เอาทั้งลิงก์"). Only a link out:
 * its SDK would make our visitors' browsers call ThaiWater's API, which this site is not allowed to use (D27).
 */
export const LONGDO_WATER_TH = 'ดูระยะถึงตลิ่งที่ Longdo Water ↗';

/** Longdo Water opened at a place, coloured by the distance to the bank ([lon, lat]) */
export function longdoWaterUrl(location: readonly number[], zoom = 15): string {
  const [lon, lat] = location;
  const params = new URLSearchParams({
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    zoom: String(zoom),
    mode: 'bank',
  });
  return `https://water.longdo.com/?${params}`;
}
