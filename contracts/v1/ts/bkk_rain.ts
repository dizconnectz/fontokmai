/* Generated from contracts/v1/schema/bkk_rain.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type FetchedAt = string;
export type Code = string;
export type DistrictTh = string | null;
/**
 * [lon, lat]; null when DXS gives none or it lies outside the Bangkok area
 */
export type Location = [number, number] | null;
export type NameTh = string;
/**
 * Time of the latest reading (Thai time)
 */
export type ObservedAt = string | null;
export type Rain15MinMm = number | null;
export type Rain1HMm = number | null;
export type Rain24HMm = number | null;
export type Rain3HMm = number | null;
/**
 * Every gauge DXS lists, sorted by code
 */
export type Gauges = RainGauge[];
export type NotesTh = string[];
export type SchemaVersion = "1";
/**
 * Public page of the department to link out to (never a DXS page)
 */
export type SourceUrl = string;

export interface RainGauges {
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  gauges: Gauges;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface RainGauge {
  code: Code;
  district_th: DistrictTh;
  location: Location;
  name_th: NameTh;
  observed_at: ObservedAt;
  rain_15min_mm: Rain15MinMm;
  rain_1h_mm: Rain1HMm;
  rain_24h_mm: Rain24HMm;
  rain_3h_mm: Rain3HMm;
}
