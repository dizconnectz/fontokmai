/* Generated from contracts/v1/schema/radar.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * Image corners [lon, lat] in the order top-left, top-right, bottom-right, bottom-left (a MapLibre image source takes them as they are)
 *
 * @minItems 4
 * @maxItems 4
 */
export type Coordinates = [[number, number], [number, number], [number, number], [number, number]];
export type CreditTh = string;
/**
 * PNG path relative to the data base URL
 */
export type Path = string;
/**
 * Observation time of the frame (UTC)
 */
export type Time = string;
/**
 * Oldest first; the last frame is the latest; may be empty
 */
export type Frames = RadarFrame[];
export type GenerationId = string;
/**
 * Legend colour as TMD publishes it
 */
export type Color = string;
export type Label = string;
/**
 * Lower bound of the class; null for the no-data colour
 */
export type MinMmPerHr = number | null;
/**
 * Highest class first, as on the TMD page
 */
export type Legend = RadarLegendItem[];
/**
 * Pixels show a legend colour blended over white at this opacity; undo it before matching a pixel to a class. Transparent pixels mean no echo
 */
export type LegendOpacity = number;
export type NameTh = string;
export type NotesTh = string[];
export type Product = "tmd_composite_zr";
/**
 * The PNG is a Web Mercator image between the corners: columns are evenly spaced in longitude and rows in Mercator y, not in latitude (exactly how a MapLibre image source draws it). Read the row of a latitude with y = ln(tan(pi/4 + lat/2))
 */
export type Projection = "EPSG:3857";
export type SchemaVersion = "1";
export type SourceUrl = string;

export interface RadarFeed {
  coordinates: Coordinates;
  credit_th: CreditTh;
  frames: Frames;
  generation_id: GenerationId;
  legend: Legend;
  legend_opacity: LegendOpacity;
  name_th: NameTh;
  notes_th: NotesTh;
  product?: Product;
  projection?: Projection;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
}
export interface RadarFrame {
  path: Path;
  time: Time;
}
export interface RadarLegendItem {
  color: Color;
  label: Label;
  min_mm_per_hr: MinMmPerHr;
}
