/* Generated from contracts/v1/schema/dams.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * True when the server fetches this file by itself every 2 hours from RID's open API (added 2026-10-02); False when it comes with the Bangkok update run by hand (DXS, D31). The web judges its age by this
 */
export type Automatic = boolean;
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
 * When this site fetched that report
 */
export type FetchedAt = string;
export type InflowMcm1 = number | null;
export type OutflowMcm = number | null;
export type Percent = number | null;
/**
 * Day of the department's report these figures are from
 */
export type ReportDate = string;
export type VolumeMcm = number | null;
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
export type OutflowMcm1 = number | null;
export type OwnerTh = string | null;
/**
 * volume as a percentage of storage
 */
export type Percent1 = number | null;
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
export type VolumeMcm1 = number | null;
export type Dams = Dam[];
export type FetchedAt1 = string;
export type LocationCreditTh = string;
export type NotesTh = string[];
/**
 * Day of the report the releases are compared with, at most 3 days before report_date: from RID's history, the latest earlier day with figures for most dams (automatic); from DXS, which gives only the latest day, the last one this site published (by hand). Null when there is none
 */
export type PreviousReportDate = string | null;
export type ReportDate1 = string;
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface DamReport {
  automatic?: Automatic;
  credit_th: CreditTh;
  dams: Dams;
  fetched_at: FetchedAt1;
  location_credit_th: LocationCreditTh;
  notes_th: NotesTh;
  previous_report_date?: PreviousReportDate;
  report_date: ReportDate1;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface Dam {
  downstream_th?: DownstreamTh;
  id: Id;
  inflow_mcm: InflowMcm;
  /**
   * Only when this report has none of percent, volume_mcm, inflow_mcm and outflow_mcm for the dam: its latest figures from an earlier report this site published, at most 7 days before report_date, with their own day and fetch time. Shown dated, never as this report's (user 2026-10-01: the department's report of a day can be blank for most dams until later in the day)
   */
  last_known?: DamFigures | null;
  location: Location;
  location_kind: LocationKind;
  name_th: NameTh;
  outflow_mcm: OutflowMcm1;
  owner_th: OwnerTh;
  percent: Percent1;
  previous_outflow_mcm?: PreviousOutflowMcm;
  region_th: RegionTh;
  storage_mcm: StorageMcm;
  volume_mcm: VolumeMcm1;
}
export interface DamFigures {
  fetched_at: FetchedAt;
  inflow_mcm: InflowMcm1;
  outflow_mcm: OutflowMcm;
  percent: Percent;
  report_date: ReportDate;
  volume_mcm: VolumeMcm;
}
