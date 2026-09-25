/* Generated from contracts/v1/schema/cctv.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type Id = string;
export type Kind = "river" | "canal" | "dam" | "road";
/**
 * [lon, lat]; null when the place is not known well enough to pin
 */
export type Location = [number, number] | null;
export type NameTh = string;
export type NoteTh = string | null;
export type OwnerTh = string;
/**
 * Owner page that shows the camera; open it in a new tab, never embed it
 */
export type PageUrl = string;
/**
 * source = coordinates published with the camera list; approximate = placed by fontokmai from a landmark
 */
export type Position = "source" | "approximate";
/**
 * Sorted by id
 */
export type Cameras = Camera[];
export type NotesTh = string[];
export type SchemaVersion = "1";
export type Updated = string;

export interface CctvRegistry {
  cameras: Cameras;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  updated: Updated;
}
export interface Camera {
  id: Id;
  kind: Kind;
  location: Location;
  name_th: NameTh;
  note_th: NoteTh;
  owner_th: OwnerTh;
  page_url: PageUrl;
  position: Position;
}
