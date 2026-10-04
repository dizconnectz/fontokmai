/* Generated from contracts/v1/schema/canal_outlook.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

/**
 * False when no factor that applies to the canal had data fresh enough: its score and level then say nothing, and it is shown as not assessed, never as below the rules (M50)
 */
export type Assessed = boolean;
/**
 * Time of the data the factor uses
 */
export type At = string | null;
/**
 * inflow: water let into the canal network (RID's gates); rain: rain forecast over its districts; drainage: the state of the river it drains to; level: Bangkok's gauges on it rising; pumps: every pump of a Bangkok station on it running (draining at its full power); flooding: RID's report of flooded districts along it
 */
export type Kind = "inflow" | "rain" | "drainage" | "level" | "pumps" | "flooding";
/**
 * What this factor adds to the canal's score (0 = noted, no points)
 */
export type Points = number;
export type SourceTh = string;
export type TextTh = string;
export type Factors = CanalFactor[];
/**
 * A factor that applies to the canal but could not be judged
 */
export type Kind1 = "inflow" | "rain" | "drainage" | "level" | "pumps" | "flooding";
/**
 * Why, e.g. ไม่มีพยากรณ์ฝนที่ใหม่พอ
 */
export type TextTh1 = string;
/**
 * The factors that apply to the canal but could not be judged, with why; the score counts only the others
 */
export type Gaps = CanalGap[];
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
/**
 * The time of the data (RID's 06:00, the forecast's fetch, the Bangkok file's fetch); null when missing
 */
export type At1 = string | null;
export type NameTh1 = string;
/**
 * flows: water/flows.json (RID); rain: forecast/rain.json; levels: bkk/water.json (Bangkok's gauges)
 */
export type Source = "flows" | "rain" | "levels";
/**
 * fresh: used; stale: older than the rules allow, not used; missing: not in the round or unreadable
 */
export type Status = "fresh" | "stale" | "missing";
/**
 * What each source was when this was made
 */
export type Inputs = CanalInput[];
export type NotesTh = string[];
/**
 * Version of the trial rules, e.g. canals-v1
 */
export type Rules = string;
export type SchemaVersion = "1";

export interface CanalOutlook {
  canals: Canals;
  generated_at: GeneratedAt;
  inputs?: Inputs;
  notes_th: NotesTh;
  rules: Rules;
  schema_version?: SchemaVersion;
}
export interface CanalWatch {
  assessed?: Assessed;
  factors: Factors;
  gaps?: Gaps;
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
export interface CanalGap {
  kind: Kind1;
  text_th: TextTh1;
}
export interface CanalInput {
  at: At1;
  name_th: NameTh1;
  source: Source;
  status: Status;
}
