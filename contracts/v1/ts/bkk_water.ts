/* Generated from contracts/v1/schema/bkk_water.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type BankDatum = string | null;
export type BankM = number | null;
export type BankSide = string | null;
export type CreditTh = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Coordinates = [number, number];
export type Type = "Point";
export type Id = string;
export type Kind = "measurement";
export type LevelDatum = string | null;
export type LevelM = number | null;
export type LevelSide = string | null;
export type NameTh = string;
export type ObservedAt = string | null;
export type SourceUrl = string;
/**
 * Source quality control passed and evidence scope checked by producer
 */
export type Verified = boolean;
export type CreditTh1 = string;
/**
 * @minItems 2
 */
export type Coordinates1 = [[number, number], [number, number], ...[number, number][]];
export type Type1 = "LineString";
export type Id1 = string;
export type Kind1 = "reported_reach";
export type NameTh1 = string;
export type ObservedAt1 = string | null;
export type SourceUrl1 = string;
/**
 * Explicit source observation for this exact reach, never extrapolated from one gauge
 */
export type Status = "above_bank" | "at_bank" | "below_bank" | "unknown";
/**
 * Source quality control passed and evidence scope checked by producer
 */
export type Verified1 = boolean;
/**
 * Optional verified bank-level evidence. DXS currently supplies none: keep empty, never invent banks or reaches. Register rights and evidence coverage before enabling a source. Consumers expire at 60 minutes.
 */
export type BankObservations = (BankMeasurement | BankReachReport)[];
export type CreditTh2 = string;
export type FetchedAt = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
/**
 * Public page of the department to link out to (never a DXS page)
 */
export type SourceUrl2 = string;
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
export type NameTh2 = string;
/**
 * Time of the latest reading (Thai time)
 */
export type ObservedAt2 = string | null;
/**
 * Number of pumps, for a pumping station
 */
export type Pumps = number | null;
/**
 * Pumps running at the reading (pumpdata true); null when the station gives no pump status. A count of pumps, not a drainage capacity
 */
export type PumpsRunning = number | null;
/**
 * Every station DXS lists, sorted by code
 */
export type Stations = CanalStation[];

export interface CanalLevels {
  bank_observations?: BankObservations;
  credit_th: CreditTh2;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl2;
  stations: Stations;
}
export interface BankMeasurement {
  bank_datum: BankDatum;
  bank_m: BankM;
  bank_side: BankSide;
  credit_th: CreditTh;
  geometry: BankPointGeometry;
  id: Id;
  kind: Kind;
  level_datum: LevelDatum;
  level_m: LevelM;
  level_side: LevelSide;
  name_th: NameTh;
  observed_at: ObservedAt;
  source_url: SourceUrl;
  verified: Verified;
}
export interface BankPointGeometry {
  coordinates: Coordinates;
  type?: Type;
}
export interface BankReachReport {
  credit_th: CreditTh1;
  geometry: BankReachGeometry;
  id: Id1;
  kind: Kind1;
  name_th: NameTh1;
  observed_at: ObservedAt1;
  source_url: SourceUrl1;
  status: Status;
  verified: Verified1;
}
export interface BankReachGeometry {
  coordinates: Coordinates1;
  type?: Type1;
}
export interface CanalStation {
  canal_th: CanalTh;
  code: Code;
  district_th: DistrictTh;
  level_in_m: LevelInM;
  level_out_m: LevelOutM;
  location: Location;
  name_th: NameTh2;
  observed_at: ObservedAt2;
  pumps: Pumps;
  pumps_running?: PumpsRunning;
}
