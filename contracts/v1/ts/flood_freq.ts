/* Generated from contracts/v1/schema/flood_freq.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * When fontokmai read the layer (a statistic GISTDA rarely changes)
 */
export type BuiltAt = string;
export type CreditTh = string;
/**
 * Newest _createdAt of the features read: when GISTDA made them
 */
export type DataCreated = string | null;
export type NameTh = string;
export type NotesTh = string[];
export type Product = "gistda_flood_freq";
/**
 * DOPA province codes read (2 digits); other places are not covered
 */
export type Provinces = string[];
export type SchemaVersion = "1";
/**
 * GISTDA's disaster platform, to link to (never an API address)
 */
export type SourceUrl = string;
/**
 * Land GISTDA mapped as flooded at least once, rai (1 rai = 1,600 m²)
 */
export type AreaRai = number;
/**
 * DOPA subdistrict code, as in ref/places.json
 */
export type Code = string;
/**
 * The most times any part of it was mapped flooded
 */
export type MaxFreq = number;
/**
 * The subdistrict, district and province (ref/places.json label)
 */
export type NameTh1 = string;
/**
 * rai_by_freq[k]: rai mapped flooded exactly k + 1 times
 */
export type RaiByFreq = number[];
/**
 * Subdistricts with land flooded more than once or once
 */
export type Subdistricts = FloodFrequencyArea[];

export interface FloodFrequency {
  built_at: BuiltAt;
  credit_th: CreditTh;
  data_created: DataCreated;
  name_th: NameTh;
  notes_th: NotesTh;
  product?: Product;
  provinces: Provinces;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  subdistricts: Subdistricts;
}
export interface FloodFrequencyArea {
  area_rai: AreaRai;
  code: Code;
  max_freq: MaxFreq;
  name_th: NameTh1;
  rai_by_freq: RaiByFreq;
}
