/* Generated from contracts/v1/schema/live_floods.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type FetchedAt = string;
export type NotesTh = string[];
/**
 * longdo:<event id>
 */
export type Id = string;
/**
 * [lon, lat] of the report (placed by the reporter)
 *
 * @minItems 2
 * @maxItems 2
 */
export type Location = [number, number];
/**
 * Who reported it: Department of Highways, iTIC staff or a member of the public (names are not published)
 */
export type Reporter = "highway_department" | "itic_staff" | "public";
export type RoadTh = string | null;
/**
 * When the report began (Thai time)
 */
export type Start = string;
/**
 * When the report is set to end; public reports last one hour
 */
export type Stop = string | null;
/**
 * Short title as reported, e.g. น้ำท่วม ถนนรัชดาภิเษก
 */
export type TitleTh = string;
/**
 * The report on Longdo Traffic; link out, never copy its photos
 */
export type Url = string;
/**
 * Newest start first; ongoing or ended within 2 hours
 */
export type Reports = LiveFloodReport[];
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface LiveFloods {
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  reports: Reports;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface LiveFloodReport {
  id: Id;
  location: Location;
  reporter: Reporter;
  road_th: RoadTh;
  start: Start;
  stop: Stop;
  title_th: TitleTh;
  url: Url;
}
