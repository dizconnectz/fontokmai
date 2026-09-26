/* Generated from contracts/v1/schema/dams.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type Id = string;
/**
 * Inflow of the day, million cubic metres
 */
export type InflowMcm = number | null;
/**
 * [lon, lat] from OpenStreetMap; null when not found
 */
export type Location = [number, number] | null;
/**
 * dam = on the dam wall, reservoir = the middle of its lake (used when the wall is not mapped)
 */
export type LocationKind = ("dam" | "reservoir") | null;
export type NameTh = string;
/**
 * Release of the day, million cubic metres
 */
export type OutflowMcm = number | null;
export type OwnerTh = string | null;
/**
 * volume as a percentage of storage
 */
export type Percent = number | null;
export type RegionTh = string | null;
/**
 * Capacity at normal storage level, million cubic metres
 */
export type StorageMcm = number | null;
/**
 * Water in the reservoir on the report day, million cubic metres
 */
export type VolumeMcm = number | null;
export type Dams = Dam[];
export type FetchedAt = string;
export type LocationCreditTh = string;
export type NotesTh = string[];
export type ReportDate = string;
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface DamReport {
  credit_th: CreditTh;
  dams: Dams;
  fetched_at: FetchedAt;
  location_credit_th: LocationCreditTh;
  notes_th: NotesTh;
  report_date: ReportDate;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface Dam {
  id: Id;
  inflow_mcm: InflowMcm;
  location: Location;
  location_kind: LocationKind;
  name_th: NameTh;
  outflow_mcm: OutflowMcm;
  owner_th: OwnerTh;
  percent: Percent;
  region_th: RegionTh;
  storage_mcm: StorageMcm;
  volume_mcm: VolumeMcm;
}
