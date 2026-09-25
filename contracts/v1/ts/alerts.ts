/* Generated from contracts/v1/schema/alerts.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */

export type AreaDescTh = string | null;
export type BodyTh = string | null;
export type Certainty = string;
export type CreditTh = string;
export type Effective = string;
export type Event = string;
/**
 * Namespaced id of the event lineage
 */
export type EventId = string;
export type Expires = string;
export type ExpiresPolicy = "source" | "default_24h";
export type Coordinates = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
  ...[number, number][]
][][];
export type Type = "MultiPolygon";
export type HeadlineTh = string | null;
export type InstructionTh = string | null;
export type IsEffective = boolean;
export type Issuer = string;
export type LifecycleStatus = "pending" | "active" | "expired" | "cancelled";
export type MessageType = "new" | "update" | "cancel";
export type NotifyEligible = boolean;
export type Onset = string | null;
export type Origin = "official";
export type QcFlags = string[];
/**
 * Increases only when the published content of the event changes
 */
export type Revision = number;
export type Sent = string;
export type Severity = string;
export type SourceMessageId = string;
export type SourceUrl = string;
export type Supersedes = string[];
/**
 * ISO 3166-2 code
 */
export type Code = string;
export type Kind = "province";
export type Targets = AlertTarget[];
export type Urgency = string;
export type Alerts = Alert[];
export type FeedGeneratedAt = string;
/**
 * Increases only when alerts or tombstones change
 */
export type FeedSequence = number;
/**
 * Must equal manifest.generation_id; otherwise the files are mixed
 */
export type GenerationId = string;
export type HistorySince = string;
/**
 * Changes when published state could not be recovered
 */
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
export type EndedAt = string;
export type EventId1 = string;
export type LifecycleStatus1 = "expired" | "cancelled";
export type Revision1 = number;
export type Tombstones = AlertTombstone[];

export interface AlertsFeed {
  alerts: Alerts;
  feed_generated_at: FeedGeneratedAt;
  feed_sequence: FeedSequence;
  generation_id: GenerationId;
  history_since: HistorySince;
  recovery_epoch: RecoveryEpoch;
  schema_version?: SchemaVersion;
  source_status: SourceStatus;
  tombstones: Tombstones;
}
export interface Alert {
  area_desc_th: AreaDescTh;
  body_th: BodyTh;
  certainty: Certainty;
  credit_th: CreditTh;
  effective: Effective;
  event: Event;
  event_id: EventId;
  expires: Expires;
  expires_policy: ExpiresPolicy;
  geometry: GeoMultiPolygon | null;
  headline_th: HeadlineTh;
  instruction_th: InstructionTh;
  is_effective: IsEffective;
  issuer: Issuer;
  lifecycle_status: LifecycleStatus;
  message_type: MessageType;
  notify_eligible: NotifyEligible;
  onset: Onset;
  origin: Origin;
  qc_flags: QcFlags;
  revision: Revision;
  sent: Sent;
  severity: Severity;
  source_message_id: SourceMessageId;
  source_url: SourceUrl;
  supersedes: Supersedes;
  targets: Targets;
  urgency: Urgency;
}
export interface GeoMultiPolygon {
  coordinates: Coordinates;
  type?: Type;
}
export interface AlertTarget {
  code: Code;
  kind: Kind;
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
export interface AlertTombstone {
  ended_at: EndedAt;
  event_id: EventId1;
  lifecycle_status: LifecycleStatus1;
  revision: Revision1;
}
