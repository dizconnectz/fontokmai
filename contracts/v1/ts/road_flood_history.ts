/* Generated from contracts/v1/schema/road_flood_history.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type AreaTh = string;
/**
 * [lon_min, lat_min, lon_max, lat_max] in WGS84
 *
 * @minItems 4
 * @maxItems 4
 */
export type Bbox = [number, number, number, number];
export type BuiltAt = string;
/**
 * Limits every reader must see next to the numbers
 */
export type NotesTh = string[];
/**
 * Most reported first
 */
export type Districts = string[];
export type FirstDate = string;
/**
 * Distinct local dates with at least one report
 */
export type FloodDays = number;
/**
 * Search key; see contracts/v1/README.md section 8
 */
export type Key = string;
export type Kind = "road" | "soi" | "tunnel";
export type LastDate = string;
export type MaxDepthCm = number | null;
export type NameTh = string;
/**
 * Distinct report locations [lon, lat] rounded to 4 decimals, newest first; empty when no report of this road has coordinates (the BMA statistics give road names only). Used to find roads near a pin
 *
 * @maxItems 30
 */
export type Points = [number, number][];
/**
 * Newest first
 *
 * @maxItems 10
 */
export type Recent =
  | []
  | [RoadFloodReport]
  | [RoadFloodReport, RoadFloodReport]
  | [RoadFloodReport, RoadFloodReport, RoadFloodReport]
  | [RoadFloodReport, RoadFloodReport, RoadFloodReport, RoadFloodReport]
  | [RoadFloodReport, RoadFloodReport, RoadFloodReport, RoadFloodReport, RoadFloodReport]
  | [RoadFloodReport, RoadFloodReport, RoadFloodReport, RoadFloodReport, RoadFloodReport, RoadFloodReport]
  | [
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport
    ]
  | [
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport
    ]
  | [
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport
    ]
  | [
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport,
      RoadFloodReport
    ];
/**
 * Local date (Asia/Bangkok) the flooding started
 */
export type Date = string;
export type DepthCm = number | null;
export type District = string | null;
/**
 * Traffic lanes affected as written by the source, e.g. เต็มผิว
 */
export type Lanes = string | null;
export type LengthM = number | null;
/**
 * [lon, lat] of the report when the source gives one
 */
export type Location = [number, number] | null;
/**
 * Rain total of the event reported by the source
 */
export type RainMm = number | null;
export type SourceId = "bma_road_flood_stats" | "itic_longdo_events";
/**
 * Place on the road, or the report title, as written by the source
 */
export type Spot = string | null;
export type Start = string | null;
export type Stop = string | null;
/**
 * Page of this report at the source, when the source has one
 */
export type Url = string | null;
export type Reports = number;
/**
 * Sorted by key
 */
export type Roads = RoadFloodRoad[];
export type SchemaVersion = "1";
/**
 * Show this with every number that uses the source
 */
export type CreditTh = string;
export type License = string;
export type NameTh1 = string;
export type PeriodFrom = string | null;
export type PeriodTo = string | null;
/**
 * Rows dropped by QC, e.g. a date outside the year of its file
 */
export type Rejected = number;
/**
 * Reports read from the source after QC
 */
export type Reports1 = number;
/**
 * Reports without a road, soi or tunnel name we could read
 */
export type ReportsWithoutPlace = number;
export type RetrievedAt = string;
export type SourceId1 = "bma_road_flood_stats" | "itic_longdo_events";
/**
 * Dataset page for the 'read more' link
 */
export type Url1 = string;
export type Sources = RoadFloodSource[];

export interface RoadFloodHistory {
  area_th: AreaTh;
  bbox: Bbox;
  built_at: BuiltAt;
  notes_th: NotesTh;
  roads: Roads;
  schema_version?: SchemaVersion;
  sources: Sources;
}
export interface RoadFloodRoad {
  days_by_year: DaysByYear;
  districts: Districts;
  first_date: FirstDate;
  flood_days: FloodDays;
  key: Key;
  kind: Kind;
  last_date: LastDate;
  max_depth_cm: MaxDepthCm;
  name_th: NameTh;
  points: Points;
  recent: Recent;
  reports: Reports;
}
/**
 * Gregorian year → flood_days in that year
 */
export interface DaysByYear {
  [k: string]: number;
}
export interface RoadFloodReport {
  date: Date;
  depth_cm: DepthCm;
  district: District;
  lanes: Lanes;
  length_m: LengthM;
  location: Location;
  rain_mm: RainMm;
  source_id: SourceId;
  spot: Spot;
  start: Start;
  stop: Stop;
  url: Url;
}
export interface RoadFloodSource {
  credit_th: CreditTh;
  license: License;
  name_th: NameTh1;
  period_from: PeriodFrom;
  period_to: PeriodTo;
  rejected: Rejected;
  reports: Reports1;
  reports_without_place: ReportsWithoutPlace;
  retrieved_at: RetrievedAt;
  source_id: SourceId1;
  url: Url1;
}
