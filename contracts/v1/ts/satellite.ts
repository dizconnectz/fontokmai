/* Generated from contracts/v1/schema/satellite.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreditTh = string;
/**
 * Water GISTDA mapped as flood in the district, km²
 */
export type AreaKm2 = number;
/**
 * Buildings in the flooded cells, by GISTDA
 */
export type Buildings = number | null;
/**
 * H3 cells (resolution 9, about 0.1 km² each) with flood water
 */
export type Cells = number;
/**
 * DOPA district code, as in ref/places.json
 */
export type Code = string;
/**
 * The district and province, e.g. อ.คีรีมาศ จ.สุโขทัย (ref/places.json label)
 */
export type NameTh = string;
/**
 * People GISTDA estimates live in the flooded cells
 */
export type Population = number | null;
/**
 * Districts with flood water, the largest area first
 */
export type Districts = SatelliteDistrict[];
/**
 * When fontokmai fetched the layer
 */
export type FetchedAt = string;
/**
 * Day of the newest scene (Thai calendar as GISTDA names it)
 */
export type LatestSceneDay = string | null;
export type NameTh1 = string;
export type NotesTh = string[];
export type Product = "gistda_flood_3days";
/**
 * The satellite scenes GISTDA names, e.g. S1D_20261002_0609, newest first
 */
export type Scenes = string[];
export type SchemaVersion = "1";
/**
 * GISTDA's disaster platform, to link to (never an API address)
 */
export type SourceUrl = string;
export type TotalKm2 = number;
/**
 * GISTDA's window: flood seen in any scene of the last this many days
 */
export type WindowDays = number;

export interface SatelliteFloods {
  credit_th: CreditTh;
  districts: Districts;
  fetched_at: FetchedAt;
  latest_scene_day: LatestSceneDay;
  name_th: NameTh1;
  notes_th: NotesTh;
  product?: Product;
  scenes: Scenes;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  total_km2: TotalKm2;
  window_days: WindowDays;
}
export interface SatelliteDistrict {
  area_km2: AreaKm2;
  buildings: Buildings;
  cells: Cells;
  code: Code;
  name_th: NameTh;
  population: Population;
}
