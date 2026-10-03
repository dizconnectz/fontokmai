/* Generated from contracts/v1/schema/flows.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * RID's chart of that day (picture), to link to; null when not read
 */
export type ChartUrl = string | null;
export type CreditTh = string;
/**
 * When this site read the report
 */
export type FetchedAt = string;
/**
 * DOPA codes of the districts the report's flood section (section 6) names as affected by flooding that day: RID's report, not this site's assessment
 */
export type FloodedDistricts = string[];
export type LocationCreditTh = string;
export type NotesTh = string[];
/**
 * 06:00 of report_date (Thai time): the time of the figures
 */
export type ObservedAt = string;
/**
 * RID's page of the daily charts
 */
export type PageUrl = string;
/**
 * How far the water is below the bank (m), when the report says it; negative = above the bank
 */
export type BelowBankM = number | null;
/**
 * As RID's chart prints it: a station's channel capacity, or the most a gate or barrage releases (Qmax)
 */
export type CapacityCms = number | null;
export type CapacityKind = ("channel" | "release") | null;
/**
 * RID's station code, e.g. C.29B
 */
export type Code = string | null;
/**
 * m³/s at 06:00 of report_date, as the report gives it; null when the report gives none
 */
export type FlowCms = number | null;
/**
 * Stable id, e.g. c29b, rama6, phranarai
 */
export type Id = string;
/**
 * Where a gate's water goes, e.g. คลองระพีพัฒน์ → ทุ่งรังสิต
 */
export type IntoTh = string | null;
/**
 * station: a gauging station on the river; barrage: the flow through a barrage; gate: a gate that lets water into a canal or river; intake: the total of several gates (an irrigation side)
 */
export type Kind = "station" | "barrage" | "gate" | "intake";
/**
 * Water level, m above mean sea level, when the report gives it
 */
export type LevelM = number | null;
export type NameTh = string;
/**
 * RID's own state of the station from the coloured dot of its chart (green, yellow, red): RID's assessment, not this site's; null when the chart has no dot there or could not be read
 */
export type State = ("normal" | "critical" | "flood") | null;
/**
 * The report's figure for the day before
 */
export type YesterdayCms = number | null;
export type Points = FlowPoint[];
/**
 * The report's own date
 */
export type ReportDate = string;
export type SchemaVersion = "1";
export type Id1 = string;
/**
 * [lon, lat] of the pin; see location_note_th for how exact it is
 *
 * @minItems 2
 * @maxItems 2
 */
export type Location = [number, number];
export type LocationNoteTh = string;
export type NameTh1 = string;
/**
 * The ids of points shown at this site, in this order
 */
export type Points1 = string[];
export type Sites = FlowSite[];
/**
 * RID's daily report (PDF), to link to
 */
export type SourceUrl = string;

export interface RidFlows {
  chart_url: ChartUrl;
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  flooded_districts?: FloodedDistricts;
  location_credit_th: LocationCreditTh;
  notes_th: NotesTh;
  observed_at: ObservedAt;
  page_url: PageUrl;
  points: Points;
  report_date: ReportDate;
  schema_version?: SchemaVersion;
  sites: Sites;
  source_url: SourceUrl;
}
export interface FlowPoint {
  below_bank_m?: BelowBankM;
  capacity_cms?: CapacityCms;
  capacity_kind?: CapacityKind;
  code?: Code;
  flow_cms: FlowCms;
  id: Id;
  into_th?: IntoTh;
  kind: Kind;
  level_m?: LevelM;
  name_th: NameTh;
  state?: State;
  yesterday_cms?: YesterdayCms;
}
export interface FlowSite {
  id: Id1;
  location: Location;
  location_note_th: LocationNoteTh;
  name_th: NameTh1;
  points: Points1;
}
