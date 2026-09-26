/* Generated from contracts/v1/schema/bkk_news.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type CreatedAt = string | null;
export type CreditTh = string;
export type FetchedAt = string;
export type NotesTh = string[];
export type SchemaVersion = "1";
/**
 * Public page of the department to link out to (never a DXS page)
 */
export type SourceUrl = string;
export type SubjectTh = string;
/**
 * The department's message as plain text (paragraphs separated by newlines)
 */
export type TextTh = string;
export type UpdatedAt = string | null;

export interface SituationReport {
  created_at: CreatedAt;
  credit_th: CreditTh;
  fetched_at: FetchedAt;
  notes_th: NotesTh;
  schema_version?: SchemaVersion;
  source_url: SourceUrl;
  subject_th: SubjectTh;
  text_th: TextTh;
  updated_at: UpdatedAt;
}
