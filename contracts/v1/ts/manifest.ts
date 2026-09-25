/* Generated from contracts/v1/schema/manifest.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type Completeness = "complete" | "partial";
/**
 * Path relative to the data base URL (/data/v1/)
 */
export type Path = string;
/**
 * Increases only when the file bytes change
 */
export type Revision = number;
export type Sha256 = string;
export type Size = number;
export type Files = ManifestFile[];
export type GeneratedAt = string;
export type GenerationId = string;
export type NextDueAt = string;
export type OwnerEpoch = number;
export type RecoveryEpoch = number;
export type SchemaVersion = "1";
export type ItemsRejected = number;
export type ItemsSeen = number;
export type LastAttemptAt = string;
export type LastSuccessAt = string | null;
export type Message = string | null;
export type SourceId = string;
export type Status = "ok" | "degraded" | "failed";
export type SourceStatus = SourceStatus1[];
export type Writer = string;

export interface Manifest {
  completeness: Completeness;
  files: Files;
  generated_at: GeneratedAt;
  generation_id: GenerationId;
  next_due_at: NextDueAt;
  owner_epoch: OwnerEpoch;
  recovery_epoch: RecoveryEpoch;
  schema_version?: SchemaVersion;
  source_status: SourceStatus;
  writer: Writer;
}
export interface ManifestFile {
  path: Path;
  revision: Revision;
  sha256: Sha256;
  size: Size;
}
export interface SourceStatus1 {
  items_rejected: ItemsRejected;
  items_seen: ItemsSeen;
  last_attempt_at: LastAttemptAt;
  last_success_at: LastSuccessAt;
  message?: Message;
  source_id: SourceId;
  status: Status;
}
