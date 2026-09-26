import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dayRainWords,
  daysAt,
  forecastAreas,
  forecastAt,
  FORECAST_LEVELS,
  type RainForecast,
} from './forecast';

// 12 lattice points around Bangkok (contracts/v1/examples/forecast), 0.25° apart from 100.25 E, 13.5 N
const forecast = JSON.parse(
  readFileSync(
    new URL('../../../contracts/v1/examples/forecast/rain.json', import.meta.url),
    'utf8',
  ),
) as RainForecast;
const index = (col: number, row: number) =>
  forecast.points.findIndex((p) => p[0] === col && p[1] === row);

describe('rain forecast on the lattice', () => {
  it('reads a lattice point exactly and blends between neighbours', () => {
    const bangkok = index(1, 1);
    expect(forecastAt(forecast, 0, [100.5, 13.75])).toBeCloseTo(forecast.rain[0][bangkok]! / 10);
    const east = forecast.rain[0][index(2, 1)]! / 10;
    const west = forecast.rain[0][bangkok]! / 10;
    expect(forecastAt(forecast, 0, [100.625, 13.75])).toBeCloseTo((east + west) / 2);
  });

  it('has no value outside the forecast area', () => {
    expect(forecastAt(forecast, 0, [99.0, 18.8])).toBeNull();
    expect(daysAt(forecast, [99.0, 18.8])).toBeNull();
  });

  it('gives the seven days of the nearest point', () => {
    const days = daysAt(forecast, [100.52, 13.74])!;
    const bangkok = index(1, 1);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      date: forecast.days[0],
      rainMm: forecast.day_rain[0][bangkok]! / 10,
      probability: forecast.day_probability[0][bangkok],
      code: forecast.day_code[0][bangkok],
    });
  });

  it('names a day total like TMD', () => {
    expect(dayRainWords(0)).toBe('ไม่มีฝน');
    expect(dayRainWords(10)).toBe('ฝนเล็กน้อย');
    expect(dayRainWords(10.1)).toBe('ฝนปานกลาง');
    expect(dayRainWords(35.1)).toBe('ฝนหนัก');
    expect(dayRainWords(90.1)).toBe('ฝนหนักมาก');
    expect(dayRainWords(null)).toBe('ไม่มีข้อมูล');
  });
});

// contracts/v1/README.md section 12: the forecast has its own colour scale, starting at 0.5 mm/h
describe('forecast colours (contract section 12)', () => {
  const flat = (mmPerHour: number): RainForecast => ({
    ...forecast,
    rain: forecast.rain.map((hour) =>
      hour.map((value) => (value === null ? null : mmPerHour * 10)),
    ),
  });

  it('keeps the colour scale written in the contract', () => {
    expect(FORECAST_LEVELS).toEqual([
      { min: 0.5, color: '#cfe8fb' },
      { min: 1, color: '#9fd0f5' },
      { min: 2, color: '#5eaee9' },
      { min: 4, color: '#2f86d8' },
      { min: 8, color: '#2fb15a' },
      { min: 16, color: '#f2c500' },
      { min: 32, color: '#f76707' },
      { min: 48, color: '#e03131' },
      { min: 80, color: '#9c36b5' },
    ]);
  });

  it('leaves rain under 0.5 mm/h uncoloured and colours 0.5 mm/h with the first level', () => {
    expect(forecastAreas(flat(0.4), 0).features).toEqual([]);
    const light = forecastAreas(flat(0.5), 0).features;
    expect(light.map((shape) => shape.properties)).toEqual([{ min: 0.5, color: '#cfe8fb' }]);
  });

  it('nests the levels: heavy rain is also inside every lighter area', () => {
    const heavy = forecastAreas(flat(20), 0).features.map((shape) => shape.properties.min);
    expect(heavy).toEqual([0.5, 1, 2, 4, 8, 16]);
  });
});
