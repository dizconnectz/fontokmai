/* Generated from contracts/v1/schema/boundaries.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * DOPA code as in ref/places.json: 2 digits = province, 4 = district (the เขต of Bangkok included)
 */
export type Code = string;
export type Coordinates = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
  ...[number, number][]
][][];
export type Type = "MultiPolygon";
/**
 * Provinces, then districts, each sorted by code
 */
export type Areas = AreaOutline[];
export type CreditTh = string;
/**
 * Source release and how far it was simplified
 */
export type GeometryVersion = string;
export type License = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
export type SourceUrl = string;
/**
 * Date of the source data
 */
export type Updated = string;

export interface Boundaries {
  areas: Areas;
  credit_th: CreditTh;
  geometry_version: GeometryVersion;
  license: License;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  updated: Updated;
}
export interface AreaOutline {
  code: Code;
  outline: GeoMultiPolygon;
}
/**
 * [lon, lat] in WGS84: polygons of an outer ring and its holes. Simplified (see geometry_version), so a point near the line may fall on the wrong side: draw it, do not test with it
 */
export interface GeoMultiPolygon {
  coordinates: Coordinates;
  type?: Type;
}
