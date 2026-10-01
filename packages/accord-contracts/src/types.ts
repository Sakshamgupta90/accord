/** Accord v1 boundary specification. Copy to packages/accord-contracts/src/types.ts.
 * These are application interfaces, not invented third-party SDK APIs.
 * Implement strict runtime validation separately; TS alone does not validate input.
 */
export const CONTRACT_VERSION = '1.0' as const;
export type Id = string;
export type IsoTime = string; // UTC ISO 8601, normalize milliseconds
export type Sha = string; // full lowercase 40-hex Git SHA for supported GitHub repo
export type Plan = 'free' | 'paid';
export type OrganizationType = 'university' | 'company' | 'personal';
export interface Scope {
  plans: Plan[];
  organizationTypes: OrganizationType[];
  universityVerified: boolean[];
}
export interface PolicyIntent {
  scope: Scope;
  retentionDays: number;
  appliesTo: 'currently_stored_records';
  effective: 'immediate';
}
export interface ThreadRef {
  teamId: string;
  channelId: string;
  rootTs: string; // Slack timestamp is an opaque decimal string, never JS float
}
export interface SlackMessage {
  id: string; // stable normalized platform-message key
  ts: string;
  authorId: string;
  text: string; // sanitized text, not raw provider payload
  permalink: string | null;
  editedTs: string | null;
}
export interface InboundEvent {
  contractVersion: typeof CONTRACT_VERSION;
  eventKey: string;
  kind: 'message' | 'message_edited' | 'message_deleted';
  thread: ThreadRef;
  message: SlackMessage;
  snapshot: SlackMessage[]; // capped authoritative snapshot, includes inbound unless deleted
  snapshotComplete: boolean;
  receivedAt: IsoTime;
  wasMention: boolean;
}
export type DecisionStatus = 'candidate' | 'tentative' | 'confirmed' | 'withdrawn';
export interface Decision {
  id: Id;
  thread: ThreadRef;
  version: number;
  contextRevision: number;
  status: DecisionStatus;
  intent: PolicyIntent | null;
  ownerId: string; // set from server config, not inferred from quoted text
  sourceMessageIds: string[];
  intentHash: string | null;
  confirmedBy: string | null;
  confirmedAt: IsoTime | null;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}
export interface Interpretation {
  disposition: 'irrelevant' | 'clarify' | 'propose' | 'confirm' | 'tentative' | 'withdraw' | 'verify_pr' | 'status';
  intent: PolicyIntent | null;
  sourceMessageIds: string[];
  question: string | null;
  explanation: string; // concise decision rationale, not hidden chain of thought
  pullRequestUrl: string | null;
  expectedDecisionVersion: number | null;
}
export interface RunContext {
  investigationId: Id;
  decisionId: Id;
  decisionVersion: number;
  contextRevision: number;
  datasetVersion: string;
  asOf: IsoTime;
  mode: 'baseline' | 'verify_pr';
}
export interface RepositoryId { owner: string; name: string }
export interface CommitTarget {
  repository: RepositoryId;
  sha: Sha;
  baseSha: Sha | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  pathPrefix: string; // fixed fixture path, enforced by server config
}
export type EvidenceKind = 'slack' | 'code' | 'guidance' | 'query' | 'verification';
export interface Evidence {
  id: Id;
  kind: EvidenceKind;
  summary: string;
  locator: string; // validated URL, or accord-query:<id>/accord-check:<id>
  excerpt: string; // redacted and capped; no raw records
  excerptHash: string; // sha256 of sanitized excerpt
  capturedAt: IsoTime;
  repository: RepositoryId | null;
  commitSha: Sha | null;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
}
export interface RetentionRule { id: string; scope: Scope; days: number }
export interface RetentionProjection {
  schemaVersion: 1;
  defaultDays: number;
  rules: RetentionRule[]; // first matching rule wins; ordered, validated
}
export interface TraceEdge {
  fromEvidenceId: Id;
  toEvidenceId: Id;
  relationship: 'generates' | 'imports' | 'calls' | 'overrides' | 'tests';
  explanation: string;
}
export interface RepositoryReport {
  run: RunContext;
  target: CommitTarget;
  conclusion: 'conflict' | 'aligned' | 'unknown';
  observedProjection: RetentionProjection | null; // current committed runtime data
  sourceProjection: RetentionProjection | null; // authoritative IDL interpretation
  generatorConsistency: 'consistent' | 'inconsistent' | 'unknown';
  trustedRuntime: 'matched' | 'unsupported';
  sourcePaths: string[];
  generatedPaths: string[];
  trace: TraceEdge[];
  evidence: Evidence[];
  unknowns: string[];
  summary: string;
}
export interface ImpactRequest {
  run: RunContext;
  intent: PolicyIntent;
  observedProjection: RetentionProjection;
  baselineProjection: RetentionProjection; // reference for outside-scope preservation
  repositoryEvidenceIds: Id[];
}
export interface ImpactReport {
  run: RunContext;
  status: 'complete' | 'unavailable' | 'unsupported';
  eligibleAccounts: number | null;
  eligibleRecords: number | null;
  observedSelectedInScope: number | null;
  intendedSelectedInScope: number | null;
  prematurelySelectedRecords: number | null;
  prematurelySelectedAccounts: number | null;
  overRetainedRecords: number | null;
  outOfScopeChangedRecords: number | null;
  observedSelectedTotal: number | null;
  intendedSelectedTotal: number | null;
  queryId: string | null;
  observedAt: IsoTime;
  evidence: Evidence[];
  error: PublicError | null;
}
export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'unknown';
  explanation: string;
  evidenceIds: Id[];
}
export interface VerificationReport {
  run: RunContext;
  target: CommitTarget;
  verdict: 'verified_at_commit' | 'still_conflicting' | 'non_durable' | 'scope_regression' | 'insufficient_evidence';
  checks: CheckResult[];
  deployment: 'unverified';
  evidence: Evidence[];
}
export type FindingStatus = 'investigating' | 'needs_clarification' | 'conditional_impact' |
  'confirmed_conflict' | 'no_conflict' | 'impact_unverified' | 'verification_failed' |
  'verified_at_commit' | 'withdrawn' | 'superseded' | 'failed';
export interface Finding {
  id: Id;
  decisionId: Id;
  decisionVersion: number;
  contextRevision: number;
  run: RunContext | null; // clarification/withdrawal need no invented investigation
  status: FindingStatus;
  title: string;
  summary: string;
  question: string | null;
  repository: RepositoryReport | null;
  impact: ImpactReport | null;
  verification: VerificationReport | null;
  evidence: Evidence[];
  limitations: string[];
  updatedAt: IsoTime;
}
export interface ThreadView {
  thread: ThreadRef;
  enrolled: boolean;
  contextRevision: number; // current thread revision, not historical Decision revision
  decision: Decision | null;
  finding: Finding | null;
  publicationPending: boolean;
}
export interface OwnerAction {
  actionId: Id;
  thread: ThreadRef;
  actorId: string; // trusted transport actor, never button-supplied actor
  decisionId: Id;
  expectedVersion: number;
  expectedContextRevision: number;
  kind: 'confirm' | 'tentative' | 'withdraw';
  occurredAt: IsoTime;
}
export interface IngestReceipt {
  accepted: boolean;
  duplicate: boolean;
  contextRevision: number | null;
  reason: string | null;
}
export interface ActionReceipt {
  status: 'accepted' | 'duplicate' | 'stale' | 'forbidden' | 'not_found';
  view: ThreadView | null;
}
export interface ApplicationPort {
  acceptEvent(event: InboundEvent): Promise<IngestReceipt>;
  acceptAction(action: OwnerAction): Promise<ActionReceipt>;
  getThreadView(thread: ThreadRef): Promise<ThreadView>;
  recordPublicationReceipt(receipt: PublicationReceipt): Promise<void>;
  /**
   * Autonomous entry for a message in an unenrolled thread. Absent when triage is not configured.
   * Runs the cheap triage classifier and enrolls the thread only for a confident `policy_proposed`.
   */
  triageEvent?(event: InboundEvent): Promise<TriageReceipt>;
}
export interface RepositoryPort {
  resolveTarget(input: { repository: RepositoryId; ref: string; pullRequestUrl: string | null; pathPrefix: string }): Promise<CommitTarget>;
  inspect(input: { run: RunContext; decision: Decision; target: CommitTarget }): Promise<RepositoryReport>;
  verify(input: { run: RunContext; decision: Decision; baseline: RepositoryReport; candidate: RepositoryReport }): Promise<VerificationReport>;
}
export interface ImpactPort { analyze(input: ImpactRequest): Promise<ImpactReport> }
export interface Publication {
  id: Id;
  thread: ThreadRef;
  findingId: Id;
  decisionVersion: number;
  contextRevision: number;
  revision: number;
  text: string; // sanitized deterministic rendering, max 3500 chars
  existingTs: string | null;
}
export type DeliveryResult =
  | { status: 'delivered'; ts: string }
  | { status: 'uncertain'; error: PublicError }
  | { status: 'retryable'; error: PublicError; retryAfterMs: number | null }
  | { status: 'permanent_failure'; error: PublicError };
export interface PublisherPort {
  deliver(publication: Publication): Promise<DeliveryResult>;
  reconcile(publication: Publication): Promise<{ status: 'found'; ts: string } | { status: 'not_found' | 'unknown' }>;
}
export interface PublicError {
  code: 'TIMEOUT' | 'RATE_LIMIT' | 'AUTH' | 'FORBIDDEN' | 'UNSUPPORTED' |
    'INVALID_INPUT' | 'STALE' | 'INCOMPLETE_EVIDENCE' | 'PROVIDER_ERROR' | 'DELIVERY_UNCERTAIN';
  message: string; // safe, bounded; no provider body or credentials
  retryable: boolean;
}
export interface PrivacyPort {
  sanitize(input: string, kind: 'slack' | 'repository' | 'model_output' | 'error'): string;
  assertAudience(input: { thread: ThreadRef; repository: RepositoryId; datasetVersion: string }): void;
  assertAllowedPath(path: string): void;
}
export interface Account { id: string; plan: Plan; organizationType: OrganizationType; universityVerified: boolean }
export interface RetainedRecord { id: string; accountId: string; createdAt: IsoTime }
export interface ModelPort {
  interpret(input: { messages: SlackMessage[]; current: Decision | null; ownerId: string; contextRevision: number }): Promise<Interpretation>;
}

export type TriageClassification = 'irrelevant' | 'exploratory' | 'policy_proposed';
/** A cheap pre-enrollment signal only. It never becomes a decision: interpretation still decides. */
export interface TriageResult {
  classification: TriageClassification;
  confidence: number; // 0..1
  rationale: string;
}
/** Lightweight classifier for unenrolled messages. Message text is untrusted data. */
export interface TriagePort {
  triage(input: { message: SlackMessage; context: SlackMessage[] }): Promise<TriageResult>;
}
export interface TriageReceipt {
  /** Null when the message was rejected before any model call (audience, own bot, heuristic). */
  triage: TriageResult | null;
  /** True only for the call that enrolled the thread, so the enrollment card is posted once. */
  enrolled: boolean;
  receipt: IngestReceipt;
}

/**
 * Planned extension point for third-party tools (issue trackers, CI, observability).
 * Reads run directly; every write is a proposal that the configured owner must approve
 * before `execute` is ever called (human-in-the-loop gateway).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  access: 'read' | 'write';
  parameters: Record<string, unknown>; // JSON Schema
}
export type ToolCallOutcome =
  | { status: 'completed'; result: unknown }
  | { status: 'approval_required'; approvalId: Id }
  | { status: 'rejected'; reason: string };
export interface ToolRegistryPort {
  list(): ToolDefinition[];
  call(input: { run: RunContext; name: string; args: unknown }): Promise<ToolCallOutcome>;
  /** Owner decision on a pending write. Only the configured owner may approve. */
  resolveApproval(input: { approvalId: Id; actorId: string; approved: boolean }): Promise<ToolCallOutcome>;
}

/** Only trusted own-bot transport events may create these receipts. */
export interface PublicationReceipt {
  publicationId: Id;
  findingId: Id;
  publicationRevision: number;
  thread: ThreadRef;
  ts: string;
  botUserId: string;
  observedAt: IsoTime;
}
export interface PublicationReceiptReader {
  find(publicationId: Id): Promise<PublicationReceipt | null>;
}
export interface ClockPort { now(): IsoTime }
export interface SafeLoggerPort {
  info(event: string, fields: Record<string, string | number | boolean | null>): void;
  error(event: string, fields: Record<string, string | number | boolean | null>): void;
}
export interface RepositoryConfig {
  repository: RepositoryId;
  pathPrefix: string;
  githubToken: string;
  openAIKey: string;
  model: string;
  trustedProfileVersion: string;
}
export interface ImpactConfig {
  url: string;
  database: string;
  username: string;
  password: string;
  allowedDatasetVersion: string;
}
export interface PrivacyConfig {
  teamId: string;
  channelId: string;
  repository: RepositoryId;
  datasetVersion: string;
  knownSecretValues: string[]; // in-memory only; never log/serialize
}
export interface PublisherConfig {
  botToken: string;
  teamId: string;
  channelId: string;
  botUserId: string; // resolve through authenticated setup, not LLM
}
export interface ProviderDependencies {
  privacy: PrivacyPort;
  clock: ClockPort;
  logger: SafeLoggerPort;
}
export interface PublisherDependencies extends ProviderDependencies {
  receipts: PublicationReceiptReader;
}
