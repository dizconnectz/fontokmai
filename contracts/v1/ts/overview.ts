/* Generated from contracts/v1/schema/overview.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type GeneratedAt = string;
/**
 * When the input was fetched, null when missing
 */
export type At = string | null;
export type NameTh = string;
/**
 * stale or missing inputs add nothing to the items, so old data never raises a place
 */
export type Status = "fresh" | "stale" | "missing";
export type Inputs = OverviewInput[];
/**
 * Where in the place, e.g. แถว ถ.พหลโยธิน, ถ.รังสิต-นครนายก
 */
export type DetailTh = string | null;
/**
 * [lon, lat] the map goes to: the reports' centre, a district or province
 *
 * @minItems 2
 * @maxItems 2
 */
export type Location = [number, number];
/**
 * e.g. อ.ธัญบุรี จ.ปทุมธานี, จ.กาญจนบุรี, แม่น้ำบางปะกง ที่ฉะเชิงเทรา
 */
export type PlaceTh = string;
/**
 * DOPA province code (2 digits), so the web can mark items under an official alert (TH-<code>)
 */
export type ProvinceCode = string | null;
/**
 * @minItems 1
 */
export type Reasons = [OverviewReason, ...OverviewReason[]];
/**
 * Time of the data behind the reason: the latest report, the measurement, or when the forecast was fetched
 */
export type At1 = string;
/**
 * Thai day a forecast speaks of (the web says วันนี้/พรุ่งนี้/อีก 2 วัน from it); null for what is happening
 */
export type Day = string | null;
export type Kind =
  | "flood_reports"
  | "road_flooding"
  | "rain_measured"
  | "rain_forecast"
  | "rain_burst"
  | "rain_3days"
  | "river_rising"
  | "dam_full";
/**
 * Short name of the source, e.g. Longdo Traffic or Open-Meteo
 */
export type SourceTh = string;
/**
 * Plain words without the day, e.g. น้ำท่วมหลายจุด (รายงาน 4 จุด) or ฝนหนักบางพื้นที่ สูงสุดราว 60 มม.
 */
export type TextTh = string;
/**
 * Higher first within `when`; the rules of v0 on /method
 */
export type Score = number;
/**
 * now = happening (reports, measurements); next = forecast, river trend or a full dam to prepare for
 */
export type When = "now" | "next";
export type Zoom = number;
/**
 * now first (highest score first), then next
 */
export type Items = OverviewItem[];
export type NotesTh = string[];
export type Rules = "v0";
export type SchemaVersion = "1";

export interface Overview {
  generated_at: GeneratedAt;
  inputs: Inputs;
  items: Items;
  notes_th: NotesTh;
  rules?: Rules;
  schema_version?: SchemaVersion;
}
export interface OverviewInput {
  at: At;
  name_th: NameTh;
  status: Status;
}
export interface OverviewItem {
  detail_th: DetailTh;
  location: Location;
  place_th: PlaceTh;
  province_code: ProvinceCode;
  reasons: Reasons;
  score: Score;
  when: When;
  zoom: Zoom;
}
export interface OverviewReason {
  at: At1;
  day: Day;
  kind: Kind;
  source_th: SourceTh;
  text_th: TextTh;
}
