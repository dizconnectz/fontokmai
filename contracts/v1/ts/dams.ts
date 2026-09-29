/* Generated from contracts/v1/schema/dams.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
/**
 * Provinces the dam's river runs through, down to the sea or out of Thailand, e.g. ท้ายน้ำ: นครนายก → ปราจีนบุรี → ฉะเชิงเทรา · ออกทะเลที่ อ.บางปะกง จ.ฉะเชิงเทรา (HydroRIVERS river network); places to follow when the dam releases water, not a flood forecast. Null when the dam has no place or river
 */
export type DownstreamTh = string | null;
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
/**
 * Release on previous_report_date of the file, million cubic metres; null when there is no earlier report or the dam had no figure then. Release up a lot (the site's trial rule, /method): at least 1 million m³ a day more and at least half as much again
 */
export type PreviousOutflowMcm = number | null;
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
/**
 * Day of the report the releases are compared with: the last one this site published before report_date, at most 3 days before it (GetDam gives only the latest day; the Bangkok update does not run every day). Null when there is none
 */
export type PreviousReportDate = string | null;
export type ReportDate = string;
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface DamReport {
  credit_th: CreditTh;
  dams: Dams;
  fetched_at: FetchedAt;
  location_credit_th: LocationCreditTh;
  notes_th: NotesTh;
  previous_report_date?: PreviousReportDate;
  report_date: ReportDate;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface Dam {
  downstream_th?: DownstreamTh;
  id: Id;
  inflow_mcm: InflowMcm;
  location: Location;
  location_kind: LocationKind;
  name_th: NameTh;
  outflow_mcm: OutflowMcm;
  owner_th: OwnerTh;
  percent: Percent;
  previous_outflow_mcm?: PreviousOutflowMcm;
  region_th: RegionTh;
  storage_mcm: StorageMcm;
  volume_mcm: VolumeMcm;
}
