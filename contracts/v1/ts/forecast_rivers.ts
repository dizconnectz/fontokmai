/* Generated from contracts/v1/schema/forecast_rivers.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
/**
 * Thai calendar days, oldest first: 7 days before the day of the fetch, that day, then 29 more (the API's forecast_days=30 counts the day of the fetch)
 */
export type Days = string[];
/**
 * When fontokmai fetched this forecast
 */
export type FetchedAt = string;
export type NameTh = string;
export type NotesTh = string[];
/**
 * discharge[d]: river discharge of the model's control run in m³/s on days[d] (model value, not measured)
 */
export type Discharge = (number | null)[];
/**
 * Stable id of the point, e.g. cp-bangkok
 */
export type Id = string;
/**
 * station = a point chosen by hand, a pin on the map and on the summary's list; reach = a point about every 50 km between them (added 2026-10-02) that only colours its stretch of ref/river_lines.json
 */
export type Kind = "station" | "reach";
/**
 * [lon, lat] asked of the model, chosen once so that its 0.05° GloFAS cell lies on the main stream
 *
 * @minItems 2
 * @maxItems 2
 */
export type Location = [number, number];
/**
 * Median of the ensemble forecast in m³/s
 */
export type Median = (number | null)[];
/**
 * Where on which river, e.g. เจ้าพระยา ที่กรุงเทพฯ
 */
export type NameTh1 = string;
/**
 * 25th percentile of the ensemble in m³/s
 */
export type P25 = (number | null)[];
/**
 * 75th percentile of the ensemble in m³/s
 */
export type P75 = (number | null)[];
export type RiverTh = string;
export type Points = RiverPoint[];
export type Product = "glofas_open_meteo";
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface RiverForecast {
  credit_th: CreditTh;
  days: Days;
  fetched_at: FetchedAt;
  name_th: NameTh;
  notes_th: NotesTh;
  points: Points;
  product?: Product;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface RiverPoint {
  discharge: Discharge;
  id: Id;
  kind?: Kind;
  location: Location;
  median: Median;
  name_th: NameTh1;
  p25: P25;
  p75: P75;
  river_th: RiverTh;
}
