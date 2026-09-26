/* Generated from contracts/v1/schema/places.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
export type License = string;
export type NotesTh = string[];
/**
 * DOPA code: 2 digits = province, 4 = district, 6 = subdistrict; parents are prefixes
 */
export type Code = string;
export type Kind = "province" | "district" | "subdistrict";
/**
 * Full Thai label, e.g. ต.คลองหนึ่ง อ.คลองหลวง จ.ปทุมธานี or แขวง…/เขต… กรุงเทพมหานคร
 */
export type Label = string;
/**
 * [lon, lat]; subdistrict = DOPA reference point (mean when DOPA lists several), district and province = mean of their subdistrict points. A point to zoom to, not a boundary
 *
 * @minItems 2
 * @maxItems 2
 */
export type Location = [number, number];
/**
 * Bare name without ต./อ./จ./แขวง/เขต, e.g. คลองหนึ่ง
 */
export type Name = string;
/**
 * Provinces, then districts, then subdistricts, each sorted by code
 */
export type Places = Place[];
export type SchemaVersion = "1";
export type SourceUrl = string;
/**
 * Date of the source dataset
 */
export type Updated = string;

export interface PlaceGazetteer {
  credit_th: CreditTh;
  license: License;
  notes_th: NotesTh;
  places: Places;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  updated: Updated;
}
export interface Place {
  code: Code;
  kind: Kind;
  label: Label;
  location: Location;
  name: Name;
}
