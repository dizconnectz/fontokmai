/* Generated from contracts/v1/schema/outlook.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
/**
 * @minItems 14
 * @maxItems 14
 */
export type Days = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string
];
export type Experimental = true;
export type FetchedAt = string;
export type NotesTh = string[];
export type MissingModels = ("ecmwf_ifs025" | "gfs05")[];
export type ExpectedMembers = number;
export type FetchedAt1 = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type GridLocation = [number, number];
export type IssuedAt = string | null;
export type Id = string;
export type RainMm = (number | null)[];
export type Members = EnsembleMember[];
export type Model = "ecmwf_ifs025" | "gfs05";
export type Models = PointEnsemble[];
export type AreaId = string;
export type AreaTh = string;
export type BankDatum = string | null;
export type BankM = number | null;
export type CreditTh1 = string;
export type FlowCapacityM3S = number | null;
export type GateOperationKnown = boolean;
export type Id1 = string;
/**
 * @minItems 2
 * @maxItems 2
 */
export type Location = [number, number];
export type NameTh = string;
export type PumpCapacityM3S = number | null;
export type SourceUrl = string;
export type Points = OutlookPoint[];
export type Product = "pilot_rain_ensemble";
export type SchemaVersion = "1";
export type SourceUrl1 = string;
export type SpatialScope = "sampled_points";

export interface RainOutlook {
  credit_th?: CreditTh;
  days: Days;
  experimental?: Experimental;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  points: Points;
  product?: Product;
  schema_version?: SchemaVersion;
  source_url?: SourceUrl1;
  spatial_scope?: SpatialScope;
}
export interface OutlookPoint {
  missing_models: MissingModels;
  models: Models;
  point: HydrologyPoint;
}
export interface PointEnsemble {
  expected_members: ExpectedMembers;
  fetched_at: FetchedAt1;
  grid_location: GridLocation;
  issued_at?: IssuedAt;
  members: Members;
  model: Model;
}
export interface EnsembleMember {
  id: Id;
  rain_mm: RainMm;
}
export interface HydrologyPoint {
  area_id: AreaId;
  area_th: AreaTh;
  bank_datum?: BankDatum;
  bank_m?: BankM;
  credit_th: CreditTh1;
  flow_capacity_m3s?: FlowCapacityM3S;
  gate_operation_known?: GateOperationKnown;
  id: Id1;
  location: Location;
  name_th: NameTh;
  pump_capacity_m3s?: PumpCapacityM3S;
  source_url: SourceUrl;
}
