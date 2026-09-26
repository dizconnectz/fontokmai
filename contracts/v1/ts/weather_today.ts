/* Generated from contracts/v1/schema/weather_today.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type FetchedAt = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
export type SourceUrl = string;
export type HumidityPct = number | null;
export type Location = [number, number] | null;
export type MaxC = number | null;
export type MinC = number | null;
export type NameTh = string;
export type ObservedAt = string | null;
export type ProvinceTh = string | null;
/**
 * Rain reported with the morning observation (the 24 hours to it)
 */
export type RainMm = number | null;
export type TemperatureC = number | null;
export type Wmo = string;
export type Stations = WeatherStation[];

export interface WeatherToday {
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  stations: Stations;
}
export interface WeatherStation {
  humidity_pct: HumidityPct;
  location: Location;
  max_c: MaxC;
  min_c: MinC;
  name_th: NameTh;
  observed_at: ObservedAt;
  province_th: ProvinceTh;
  rain_mm: RainMm;
  temperature_c: TemperatureC;
  wmo: Wmo;
}
