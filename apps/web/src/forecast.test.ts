import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dayRainWords,
  daysAt,
  forecastAt,
  RAIN_LEGEND,
  rainClass,
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

  it('colours a rain rate with the radar legend and names a day total like TMD', () => {
    expect(rainClass(0.05, RAIN_LEGEND)).toBeNull();
    expect(rainClass(0.5, RAIN_LEGEND)?.label).toBe('0.1');
    expect(rainClass(5, RAIN_LEGEND)?.label).toBe('4');
    expect(rainClass(120, RAIN_LEGEND)?.label).toBe('> 80');
    expect(dayRainWords(0)).toBe('ไม่มีฝน');
    expect(dayRainWords(10)).toBe('ฝนเล็กน้อย');
    expect(dayRainWords(10.1)).toBe('ฝนปานกลาง');
    expect(dayRainWords(35.1)).toBe('ฝนหนัก');
    expect(dayRainWords(90.1)).toBe('ฝนหนักมาก');
    expect(dayRainWords(null)).toBe('ไม่มีข้อมูล');
  });
});
