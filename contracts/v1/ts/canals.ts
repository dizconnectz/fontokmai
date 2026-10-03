/* Generated from contracts/v1/schema/canals.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * DOPA codes of the districts the canal runs through or along
 */
export type Districts = string[];
/**
 * id of the river station whose state limits how fast it drains
 */
export type DrainsTo = string | null;
/**
 * Its name in Bangkok's canal levels (bkk/water.json canal_th)
 */
export type DxsCanals = string[];
/**
 * ids of water/flows.json points whose water reaches this canal
 */
export type FedBy = string[];
/**
 * Stable id, e.g. rangsit
 */
export type Id = string;
export type Coordinates = [[number, number], [number, number], ...[number, number][]][];
export type Type = "MultiLineString";
export type NameTh = string;
export type Canals = CanalLine[];
export type CreditTh = string;
export type License = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
export type SourceUrl = string;
/**
 * Date of the OpenStreetMap extract
 */
export type Updated = string;

export interface CanalLines {
  canals: Canals;
  credit_th: CreditTh;
  license: License;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  updated: Updated;
}
export interface CanalLine {
  districts: Districts;
  drains_to: DrainsTo;
  dxs_canals: DxsCanals;
  fed_by: FedBy;
  id: Id;
  line: GeoMultiLineString;
  name_th: NameTh;
}
/**
 * [lon, lat] in WGS84, simplified for drawing
 */
export interface GeoMultiLineString {
  coordinates: Coordinates;
  type?: Type;
}
