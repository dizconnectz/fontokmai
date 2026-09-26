/* Generated from contracts/v1/schema/bkk_water.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type FetchedAt = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
/**
 * Public page of the department to link out to (never a DXS page)
 */
export type SourceUrl = string;
export type CanalTh = string | null;
export type Code = string;
export type DistrictTh = string | null;
/**
 * Water level on the inner side (ระดับน้ำด้านใน), metres above mean sea level (ม.รทก.), not the depth of water on a road
 */
export type LevelInM = number | null;
/**
 * Water level on the outer side (ระดับน้ำด้านนอก), m above MSL
 */
export type LevelOutM = number | null;
/**
 * [lon, lat]; null when DXS gives none or it lies outside the Bangkok area
 */
export type Location = [number, number] | null;
/**
 * Station name as DXS gives it, e.g. ส.คลองเตย (ส. = pumping station, ปตร. = water gate, ค. = canal gauge)
 */
export type NameTh = string;
/**
 * Time of the latest reading (Thai time)
 */
export type ObservedAt = string | null;
/**
 * Number of pumps, for a pumping station
 */
export type Pumps = number | null;
/**
 * Every station DXS lists, sorted by code
 */
export type Stations = CanalStation[];

export interface CanalLevels {
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  stations: Stations;
}
export interface CanalStation {
  canal_th: CanalTh;
  code: Code;
  district_th: DistrictTh;
  level_in_m: LevelInM;
  level_out_m: LevelOutM;
  location: Location;
  name_th: NameTh;
  observed_at: ObservedAt;
  pumps: Pumps;
}
