/* Generated from contracts/v1/schema/forecast.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
/**
 * day_code[d][p]: WMO weather code of the day
 */
export type DayCode = (number | null)[][];
/**
 * day_probability[d][p]: highest hourly chance of rain during the day, in %
 */
export type DayProbability = (number | null)[][];
/**
 * day_rain[d][p]: forecast rain of the day in 0.1 mm
 */
export type DayRain = (number | null)[][];
/**
 * Thai calendar days, today first
 */
export type Days = string[];
/**
 * When fontokmai fetched this forecast
 */
export type FetchedAt = string;
/**
 * End of each one-hour rain total (Thai time), oldest first
 */
export type Hours = string[];
/**
 * Latitude of row 0
 */
export type South = number;
/**
 * Spacing in degrees: point [col, row] is at [west + col*step, south + row*step]
 */
export type Step = number;
/**
 * Longitude of column 0
 */
export type West = number;
export type NameTh = string;
export type NotesTh = string[];
/**
 * [col, row] of every point with data, sorted by row then column
 */
export type Points = [number, number][];
export type Product = "open_meteo_best_match";
/**
 * rain[h][p]: forecast rain in 0.1 mm during the hour that ends at hours[h], at points[p]
 */
export type Rain = (number | null)[][];
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface RainForecast {
  credit_th: CreditTh;
  day_code: DayCode;
  day_probability: DayProbability;
  day_rain: DayRain;
  days: Days;
  fetched_at: FetchedAt;
  hours: Hours;
  lattice: ForecastLattice;
  name_th: NameTh;
  notes_th: NotesTh;
  points: Points;
  product?: Product;
  rain: Rain;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface ForecastLattice {
  south: South;
  step: Step;
  west: West;
}
