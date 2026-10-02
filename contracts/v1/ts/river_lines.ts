/* Generated from contracts/v1/schema/river_lines.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
/**
 * Source extract and how far it was simplified
 */
export type GeometryVersion = string;
export type License = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
export type SourceUrl = string;
export type Coordinates = [[number, number], [number, number], ...[number, number][]][];
export type Type = "MultiLineString";
/**
 * id of the point of forecast/rivers.json nearest to this stretch on the same river: the web colours the stretch by that point's 7-day trend
 */
export type PointId = string;
/**
 * e.g. แม่น้ำเจ้าพระยา
 */
export type RiverTh = string;
/**
 * By river, then by point id
 */
export type Stretches = RiverStretch[];
/**
 * Date of the OpenStreetMap extract
 */
export type Updated = string;

export interface RiverLines {
  credit_th: CreditTh;
  geometry_version: GeometryVersion;
  license: License;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  stretches: Stretches;
  updated: Updated;
}
export interface RiverStretch {
  line: GeoMultiLineString;
  point_id: PointId;
  river_th: RiverTh;
}
/**
 * [lon, lat] in WGS84, simplified for drawing
 */
export interface GeoMultiLineString {
  coordinates: Coordinates;
  type?: Type;
}
