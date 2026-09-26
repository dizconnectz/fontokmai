/* Generated from contracts/v1/schema/bkk_flooding.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type FetchedAt = string;
export type NotesTh = string[];
/**
 * Day of the department's report (it can list water still there from the evening before)
 */
export type ReportDate = string;
/**
 * Where on the road, as the department writes it
 */
export type AreaTh = string | null;
/**
 * Water on the road at its deepest, centimetres
 */
export type DepthCm = number | null;
export type DistrictTh = string | null;
/**
 * When the road was dry again; null while it is still flooded
 */
export type DryAt = string | null;
export type FloodStart = string | null;
/**
 * Traffic lanes affected, e.g. 1-2 เลน or เต็มผิว
 */
export type LanesTh = string | null;
export type LengthM = number | null;
export type RainMm = number | null;
export type RoadTh = string;
/**
 * Still flooded first, then the latest start first
 */
export type Reports = RoadFloodingReport[];
export type SchemaVersion = "1";
/**
 * Public page of the report to link out to (never a DXS page)
 */
export type SourceUrl = string;
/**
 * When the department last updated the report
 */
export type UpdatedAt = string | null;

export interface RoadFloodingDaily {
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  report_date: ReportDate;
  reports: Reports;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  updated_at: UpdatedAt;
}
export interface RoadFloodingReport {
  area_th: AreaTh;
  depth_cm: DepthCm;
  district_th: DistrictTh;
  dry_at: DryAt;
  flood_start: FloodStart;
  lanes_th: LanesTh;
  length_m: LengthM;
  rain_mm: RainMm;
  road_th: RoadTh;
}
