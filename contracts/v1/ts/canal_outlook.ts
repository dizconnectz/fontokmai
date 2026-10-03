/* Generated from contracts/v1/schema/canal_outlook.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * Time of the data the factor uses
 */
export type At = string | null;
/**
 * inflow: water let into the canal network (RID's gates); rain: rain forecast over its districts; drainage: the state of the river it drains to; level: Bangkok's gauges on it rising; flooding: RID's report of flooded districts along it
 */
export type Kind = "inflow" | "rain" | "drainage" | "level" | "flooding";
/**
 * What this factor adds to the canal's score (0 = noted, no points)
 */
export type Points = number;
export type SourceTh = string;
export type TextTh = string;
export type Factors = CanalFactor[];
/**
 * The canal's id in ref/canals.json
 */
export type Id = string;
/**
 * warn (score 3 or more) or watch (2) by this site's trial rules; null below. Not an announcement and not a forecast of how high the water will be
 */
export type Level = ("watch" | "warn") | null;
export type NameTh = string;
export type Score = number;
/**
 * Every canal of ref/canals.json, the highest score first
 */
export type Canals = CanalWatch[];
export type GeneratedAt = string;
export type NotesTh = string[];
/**
 * Version of the trial rules, e.g. canals-v1
 */
export type Rules = string;
export type SchemaVersion = "1";

export interface CanalOutlook {
  canals: Canals;
  generated_at: GeneratedAt;
  notes_th: NotesTh;
  rules: Rules;
  schema_version?: SchemaVersion;
}
export interface CanalWatch {
  factors: Factors;
  id: Id;
  level: Level;
  name_th: NameTh;
  score: Score;
}
export interface CanalFactor {
  at: At;
  kind: Kind;
  points: Points;
  source_th: SourceTh;
  text_th: TextTh;
}
