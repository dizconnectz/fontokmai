import { contours } from 'd3-contour';
import type { FeatureCollection, MultiPolygon } from 'geojson';
import type { RainForecast } from '../../../contracts/v1/ts/forecast';
import type { RadarLegendItem } from './geo';

export type { RainForecast };

/** Values of one hour on the lattice (NaN where the lattice has no point). */
interface Grid {
  cols: number;
  rows: number;
  values: Float32Array;
}
const grids = new WeakMap<RainForecast, Map<number, Grid>>();
function gridOf(forecast: RainForecast, hour: number): Grid {
  let byHour = grids.get(forecast);
  if (!byHour) grids.set(forecast, (byHour = new Map()));
  let grid = byHour.get(hour);
  if (!grid) {
    const cols = Math.max(...forecast.points.map((p) => p[0])) + 1;
    const rows = Math.max(...forecast.points.map((p) => p[1])) + 1;
    const values = new Float32Array(cols * rows).fill(NaN);
    forecast.points.forEach(([col, row], i) => {
      const tenths = forecast.rain[hour]?.[i];
      if (tenths !== null && tenths !== undefined) values[row * cols + col] = tenths / 10;
    });
    grid = { cols, rows, values };
    byHour.set(hour, grid);
  }
  return grid;
}

/**
 * Rain (mm in the hour) at fractional lattice coordinates: bilinear between the four points around,
 * using the ones that exist; NaN when the nearest lattice point has no data (outside the forecast area).
 */
function sample(grid: Grid, col: number, row: number): number {
  const nearest = Math.round(row) * grid.cols + Math.round(col);
  if (
    Math.round(col) < 0 ||
    Math.round(row) < 0 ||
    Math.round(col) >= grid.cols ||
    Math.round(row) >= grid.rows ||
    Number.isNaN(grid.values[nearest])
  )
    return NaN;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  let sum = 0;
  let weights = 0;
  for (const [c, r] of [
    [c0, r0],
    [c0 + 1, r0],
    [c0, r0 + 1],
    [c0 + 1, r0 + 1],
  ]) {
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
    const value = grid.values[r * grid.cols + c];
    if (Number.isNaN(value)) continue;
    const weight = (1 - Math.abs(col - c)) * (1 - Math.abs(row - r));
    sum += value * weight;
    weights += weight;
  }
  return weights > 0 ? sum / weights : NaN;
}

/** Forecast rain (mm in the hour ending at hours[hour]) at [lon, lat], or null outside the forecast area. */
export function forecastAt(forecast: RainForecast, hour: number, point: number[]): number | null {
  const { west, south, step } = forecast.lattice;
  const value = sample(gridOf(forecast, hour), (point[0] - west) / step, (point[1] - south) / step);
  return Number.isNaN(value) ? null : value;
}

export interface ForecastDay {
  date: string;
  rainMm: number | null;
  probability: number | null;
  code: number | null;
}
/** The seven days of the lattice point nearest to [lon, lat] (within one lattice step), or null. */
export function daysAt(forecast: RainForecast, point: number[]): ForecastDay[] | null {
  const { west, south, step } = forecast.lattice;
  const col = Math.round((point[0] - west) / step);
  const row = Math.round((point[1] - south) / step);
  const index = forecast.points.findIndex((p) => p[0] === col && p[1] === row);
  if (index < 0) return null;
  return forecast.days.map((date, d) => ({
    date,
    rainMm: forecast.day_rain[d][index] === null ? null : forecast.day_rain[d][index]! / 10,
    probability: forecast.day_probability[d][index],
    code: forecast.day_code[d][index],
  }));
}

/** TMD words for a day's rain total (24-hour classes of the design, section 12). */
export function dayRainWords(mm: number | null): string {
  if (mm === null) return 'ไม่มีข้อมูล';
  if (mm < 0.1) return 'ไม่มีฝน';
  if (mm <= 10) return 'ฝนเล็กน้อย';
  if (mm <= 35) return 'ฝนปานกลาง';
  if (mm <= 90) return 'ฝนหนัก';
  return 'ฝนหนักมาก';
}

// TMD radar legend (radar.json carries the same list), for the key when radar.json is absent
export const RAIN_LEGEND: RadarLegendItem[] = [
  { min_mm_per_hr: 80, color: '#DD0000', label: '> 80' },
  { min_mm_per_hr: 56, color: '#FE45A2', label: '56' },
  { min_mm_per_hr: 48, color: '#FF86FF', label: '48' },
  { min_mm_per_hr: 40, color: '#FF8000', label: '40' },
  { min_mm_per_hr: 32, color: '#FFFF00', label: '32' },
  { min_mm_per_hr: 24, color: '#7CCE02', label: '24' },
  { min_mm_per_hr: 16, color: '#46FF09', label: '16' },
  { min_mm_per_hr: 12, color: '#00E10C', label: '12' },
  { min_mm_per_hr: 8, color: '#00B347', label: '8' },
  { min_mm_per_hr: 4, color: '#009375', label: '4' },
  { min_mm_per_hr: 2, color: '#0006F0', label: '2' },
  { min_mm_per_hr: 1, color: '#003C6C', label: '1' },
  { min_mm_per_hr: 0.1, color: '#0077C6', label: '0.1' },
];

// Forecast areas are drawn as vector shapes, so their edges stay sharp at every zoom (an image of the
// 25 km model grid blurs when the map zooms in). Rain under 0.5 mm in the hour is left out: a model spreads
// drizzle over wide areas and a pale wash over the whole map hides more than it tells. These colours are
// the forecast's own scale (contract section 12), not the radar legend; the map key switches with the mode.
export const FORECAST_LEVELS: { min: number; color: string }[] = [
  { min: 0.5, color: '#cfe8fb' },
  { min: 1, color: '#9fd0f5' },
  { min: 2, color: '#5eaee9' },
  { min: 4, color: '#2f86d8' },
  { min: 8, color: '#2fb15a' },
  { min: 16, color: '#f2c500' },
  { min: 32, color: '#f76707' },
  { min: 48, color: '#e03131' },
  { min: 80, color: '#9c36b5' },
];
const UPSAMPLE = 4;
export type ForecastAreas = FeatureCollection<MultiPolygon, { min: number; color: string }>;
const areas = new WeakMap<RainForecast, Map<number, ForecastAreas>>();
/**
 * One forecast hour as nested areas (rain ≥ each level), from the same bilinear field forecastAt() reads:
 * the grid is sampled four times finer, then traced with marching squares.
 */
export function forecastAreas(forecast: RainForecast, hour: number): ForecastAreas {
  let byHour = areas.get(forecast);
  if (!byHour) areas.set(forecast, (byHour = new Map()));
  const known = byHour.get(hour);
  if (known) return known;
  const grid = gridOf(forecast, hour);
  const width = (grid.cols - 1) * UPSAMPLE + 1;
  const height = (grid.rows - 1) * UPSAMPLE + 1;
  const values = new Array<number>(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = sample(grid, x / UPSAMPLE, y / UPSAMPLE);
      values[y * width + x] = Number.isNaN(value) ? 0 : value;
    }
  const { west, south, step } = forecast.lattice;
  const size = step / UPSAMPLE;
  // d3-contour puts value i at coordinate i + 0.5
  const lonLat = ([x, y]: number[]) => [west + (x - 0.5) * size, south + (y - 0.5) * size];
  const shapes = contours()
    .size([width, height])
    .thresholds(FORECAST_LEVELS.map((level) => level.min))(values);
  const result: ForecastAreas = {
    type: 'FeatureCollection',
    features: shapes
      .filter((shape) => shape.coordinates.length > 0)
      .map((shape) => ({
        type: 'Feature' as const,
        properties: {
          min: shape.value,
          color: FORECAST_LEVELS.find((level) => level.min === shape.value)!.color,
        },
        geometry: {
          type: 'MultiPolygon' as const,
          coordinates: shape.coordinates.map((polygon) => polygon.map((ring) => ring.map(lonLat))),
        },
      })),
  };
  byHour.set(hour, result);
  return result;
}
