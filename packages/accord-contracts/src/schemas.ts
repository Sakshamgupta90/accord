/** Strict runtime schemas for every Accord boundary value.
 * Unknown keys are rejected, nullable fields must be present as null, arrays are bounded.
 * Schema validation establishes shape only. Authorization and truth are checked separately.
 */
import { z } from 'zod';
import { isCanonicalScope, isIsoTime, isSlackTs } from './canonical.js';
import type {
  Account, ActionReceipt, CheckResult, CommitTarget, Decision, DeliveryResult, Evidence, Finding,
  ImpactReport, ImpactRequest, InboundEvent, IngestReceipt, Interpretation, OwnerAction, PolicyIntent,
  PublicError, Publication, PublicationReceipt, RepositoryId, RepositoryReport, RetainedRecord,
  RetentionProjection, RetentionRule, RunContext, Scope, SlackMessage, ThreadRef, ThreadView,
  TraceEdge, TriageResult, VerificationReport,
} from './types.js';
import { CONTRACT_VERSION } from './types.js';

export const LIMITS = {
  snapshotMessages: 50,
  snapshotCharacters: 30_000,
  messageText: 30_000,
  evidenceExcerpt: 1_500,
  evidencePerReport: 20,
  projectionRules: 12,
  publicationText: 3_500,
  retentionDaysMin: 1,
  retentionDaysMax: 3_650,
  sourceMessageIds: 50,
  paths: 50,
  traceEdges: 64,
  checks: 32,
  notes: 20,
  noteText: 500,
  summaryText: 4_000,
  titleText: 300,
  questionText: 1_000,
  errorMessage: 1_000,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;
const KEY_RE = /^[A-Za-z0-9._:\-/]{1,200}$/;
const QUERY_LOCATOR_RE = /^accord-(query|check):[A-Za-z0-9._\-]{1,120}$/;

const text = (max: number) => z.string().max(max);
const requiredText = (max: number) => z.string().min(1).max(max);

export const UuidSchema = z.string().regex(UUID_RE, 'must be a UUID');
export const ShaSchema = z.string().regex(SHA_RE, 'must be a full 40-hex lowercase Git SHA');
export const KeySchema = z.string().regex(KEY_RE, 'must be a bounded identifier key');
export const IsoTimeSchema = z.string().refine(isIsoTime, 'must be UTC ISO 8601 with milliseconds');
export const SlackTsSchema = z.string().refine(isSlackTs, 'must be a Slack decimal timestamp string');
export const CountSchema = z.number().int().min(0).nullable();
export const RetentionDaysSchema = z.number().int().min(LIMITS.retentionDaysMin).max(LIMITS.retentionDaysMax);

export const PlanSchema = z.enum(['free', 'paid']);
export const OrganizationTypeSchema = z.enum(['university', 'company', 'personal']);

function unique<T>(values: T[]): boolean {
  return new Set(values.map((value) => JSON.stringify(value))).size === values.length;
}

/** Nonempty, duplicate-free and in canonical order. Normalize with canonicalizeScope before validating. */
export const ScopeSchema = z.strictObject({
  plans: z.array(PlanSchema).min(1).max(2),
  organizationTypes: z.array(OrganizationTypeSchema).min(1).max(3),
  universityVerified: z.array(z.boolean()).min(1).max(2),
})
  .refine((scope) => unique(scope.plans) && unique(scope.organizationTypes) && unique(scope.universityVerified), 'scope values must not repeat')
  .refine(isCanonicalScope, 'scope values must be in canonical order') satisfies z.ZodType<Scope>;

export const PolicyIntentSchema = z.strictObject({
  scope: ScopeSchema,
  retentionDays: RetentionDaysSchema,
  appliesTo: z.literal('currently_stored_records'),
  effective: z.literal('immediate'),
}) satisfies z.ZodType<PolicyIntent>;

export const ThreadRefSchema = z.strictObject({
  teamId: requiredText(64),
  channelId: requiredText(64),
  rootTs: SlackTsSchema,
}) satisfies z.ZodType<ThreadRef>;

export const SlackMessageSchema = z.strictObject({
  id: KeySchema,
  ts: SlackTsSchema,
  authorId: requiredText(64),
  text: text(LIMITS.messageText),
  permalink: z.string().url().max(2_000).nullable(),
  editedTs: SlackTsSchema.nullable(),
}) satisfies z.ZodType<SlackMessage>;

export const InboundEventSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  eventKey: KeySchema,
  kind: z.enum(['message', 'message_edited', 'message_deleted']),
  thread: ThreadRefSchema,
  message: SlackMessageSchema,
  snapshot: z.array(SlackMessageSchema).max(LIMITS.snapshotMessages),
  snapshotComplete: z.boolean(),
  receivedAt: IsoTimeSchema,
  wasMention: z.boolean(),
})
  .refine(
    (event) => event.snapshot.reduce((total, message) => total + message.text.length, 0) <= LIMITS.snapshotCharacters,
    `snapshot exceeds ${LIMITS.snapshotCharacters} sanitized characters`,
  ) satisfies z.ZodType<InboundEvent>;

export const DecisionStatusSchema = z.enum(['candidate', 'tentative', 'confirmed', 'withdrawn']);

export const DecisionSchema = z.strictObject({
  id: UuidSchema,
  thread: ThreadRefSchema,
  version: z.number().int().min(1),
  contextRevision: z.number().int().min(0),
  status: DecisionStatusSchema,
  intent: PolicyIntentSchema.nullable(),
  ownerId: requiredText(64),
  sourceMessageIds: z.array(KeySchema).max(LIMITS.sourceMessageIds),
  intentHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  confirmedBy: z.string().max(64).nullable(),
  confirmedAt: IsoTimeSchema.nullable(),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}) satisfies z.ZodType<Decision>;

/** Model output shape. The disposition is a proposal; authorization is enforced in code afterwards. */
export const InterpretationSchema = z.strictObject({
  disposition: z.enum(['irrelevant', 'clarify', 'propose', 'confirm', 'tentative', 'withdraw', 'verify_pr', 'status']),
  intent: PolicyIntentSchema.nullable(),
  sourceMessageIds: z.array(KeySchema).max(LIMITS.sourceMessageIds),
  question: text(LIMITS.questionText).nullable(),
  explanation: text(LIMITS.summaryText),
  pullRequestUrl: z.string().url().max(2_000).nullable(),
  expectedDecisionVersion: z.number().int().min(1).nullable(),
}) satisfies z.ZodType<Interpretation>;

export const RunContextSchema = z.strictObject({
  investigationId: UuidSchema,
  decisionId: UuidSchema,
  decisionVersion: z.number().int().min(1),
  contextRevision: z.number().int().min(0),
  datasetVersion: KeySchema,
  asOf: IsoTimeSchema,
  mode: z.enum(['baseline', 'verify_pr']),
}) satisfies z.ZodType<RunContext>;

export const RepositoryIdSchema = z.strictObject({
  owner: requiredText(100),
  name: requiredText(100),
}) satisfies z.ZodType<RepositoryId>;

export const CommitTargetSchema = z.strictObject({
  repository: RepositoryIdSchema,
  sha: ShaSchema,
  baseSha: ShaSchema.nullable(),
  pullRequestNumber: z.number().int().min(1).nullable(),
  pullRequestUrl: z.string().url().max(2_000).nullable(),
  pathPrefix: requiredText(200),
}) satisfies z.ZodType<CommitTarget>;

export const EvidenceKindSchema = z.enum(['slack', 'code', 'guidance', 'query', 'verification']);

const LocatorSchema = z.string().max(2_000).refine(
  (value) => QUERY_LOCATOR_RE.test(value) || /^https:\/\/[^\s]+$/.test(value),
  'locator must be an https URL or accord-query:/accord-check: reference',
);

export const EvidenceSchema = z.strictObject({
  id: KeySchema,
  kind: EvidenceKindSchema,
  summary: text(LIMITS.summaryText),
  locator: LocatorSchema,
  excerpt: text(LIMITS.evidenceExcerpt),
  excerptHash: z.string().regex(/^[0-9a-f]{64}$/),
  capturedAt: IsoTimeSchema,
  repository: RepositoryIdSchema.nullable(),
  commitSha: ShaSchema.nullable(),
  path: z.string().max(400).nullable(),
  startLine: z.number().int().min(1).nullable(),
  endLine: z.number().int().min(1).nullable(),
})
  .refine((evidence) => evidence.startLine === null || evidence.endLine === null || evidence.startLine <= evidence.endLine, 'startLine must not exceed endLine') satisfies z.ZodType<Evidence>;

export const RetentionRuleSchema = z.strictObject({
  id: KeySchema,
  scope: ScopeSchema,
  days: RetentionDaysSchema,
}) satisfies z.ZodType<RetentionRule>;

/** Ordered rules, first match wins. Unsupported or ambiguous shapes must fail closed. */
export const RetentionProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  defaultDays: RetentionDaysSchema,
  rules: z.array(RetentionRuleSchema).max(LIMITS.projectionRules),
})
  .refine((projection) => unique(projection.rules.map((rule) => rule.id)), 'rule ids must be unique') satisfies z.ZodType<RetentionProjection>;

export const TraceEdgeSchema = z.strictObject({
  fromEvidenceId: KeySchema,
  toEvidenceId: KeySchema,
  relationship: z.enum(['generates', 'imports', 'calls', 'overrides', 'tests']),
  explanation: text(LIMITS.noteText),
}) satisfies z.ZodType<TraceEdge>;

export const PublicErrorSchema = z.strictObject({
  code: z.enum(['TIMEOUT', 'RATE_LIMIT', 'AUTH', 'FORBIDDEN', 'UNSUPPORTED', 'INVALID_INPUT', 'STALE', 'INCOMPLETE_EVIDENCE', 'PROVIDER_ERROR', 'DELIVERY_UNCERTAIN']),
  message: text(LIMITS.errorMessage),
  retryable: z.boolean(),
}) satisfies z.ZodType<PublicError>;

export const RepositoryReportSchema = z.strictObject({
  run: RunContextSchema,
  target: CommitTargetSchema,
  conclusion: z.enum(['conflict', 'aligned', 'unknown']),
  observedProjection: RetentionProjectionSchema.nullable(),
  sourceProjection: RetentionProjectionSchema.nullable(),
  generatorConsistency: z.enum(['consistent', 'inconsistent', 'unknown']),
  trustedRuntime: z.enum(['matched', 'unsupported']),
  sourcePaths: z.array(z.string().max(400)).max(LIMITS.paths),
  generatedPaths: z.array(z.string().max(400)).max(LIMITS.paths),
  trace: z.array(TraceEdgeSchema).max(LIMITS.traceEdges),
  evidence: z.array(EvidenceSchema).max(LIMITS.evidencePerReport),
  unknowns: z.array(text(LIMITS.noteText)).max(LIMITS.notes),
  summary: text(LIMITS.summaryText),
}) satisfies z.ZodType<RepositoryReport>;

export const ImpactRequestSchema = z.strictObject({
  run: RunContextSchema,
  intent: PolicyIntentSchema,
  observedProjection: RetentionProjectionSchema,
  baselineProjection: RetentionProjectionSchema,
  repositoryEvidenceIds: z.array(KeySchema).max(LIMITS.evidencePerReport),
}) satisfies z.ZodType<ImpactRequest>;

/** Unknown counts are null, never zero. */
export const ImpactReportSchema = z.strictObject({
  run: RunContextSchema,
  status: z.enum(['complete', 'unavailable', 'unsupported']),
  eligibleAccounts: CountSchema,
  eligibleRecords: CountSchema,
  observedSelectedInScope: CountSchema,
  intendedSelectedInScope: CountSchema,
  prematurelySelectedRecords: CountSchema,
  prematurelySelectedAccounts: CountSchema,
  overRetainedRecords: CountSchema,
  outOfScopeChangedRecords: CountSchema,
  observedSelectedTotal: CountSchema,
  intendedSelectedTotal: CountSchema,
  queryId: KeySchema.nullable(),
  observedAt: IsoTimeSchema,
  evidence: z.array(EvidenceSchema).max(LIMITS.evidencePerReport),
  error: PublicErrorSchema.nullable(),
}) satisfies z.ZodType<ImpactReport>;

export const CheckResultSchema = z.strictObject({
  name: requiredText(120),
  status: z.enum(['pass', 'fail', 'unknown']),
  explanation: text(LIMITS.noteText),
  evidenceIds: z.array(KeySchema).max(LIMITS.evidencePerReport),
}) satisfies z.ZodType<CheckResult>;

export const VerificationReportSchema = z.strictObject({
  run: RunContextSchema,
  target: CommitTargetSchema,
  verdict: z.enum(['verified_at_commit', 'still_conflicting', 'non_durable', 'scope_regression', 'insufficient_evidence']),
  checks: z.array(CheckResultSchema).max(LIMITS.checks),
  deployment: z.literal('unverified'),
  evidence: z.array(EvidenceSchema).max(LIMITS.evidencePerReport),
})
  .refine(
    (report) => report.verdict !== 'verified_at_commit' || report.checks.every((check) => check.status === 'pass'),
    'verified_at_commit requires every reported check to pass',
  ) satisfies z.ZodType<VerificationReport>;

export const FindingStatusSchema = z.enum([
  'investigating', 'needs_clarification', 'conditional_impact', 'confirmed_conflict', 'no_conflict',
  'impact_unverified', 'verification_failed', 'verified_at_commit', 'withdrawn', 'superseded', 'failed',
]);

export const FindingSchema = z.strictObject({
  id: UuidSchema,
  decisionId: UuidSchema,
  decisionVersion: z.number().int().min(1),
  contextRevision: z.number().int().min(0),
  run: RunContextSchema.nullable(),
  status: FindingStatusSchema,
  title: requiredText(LIMITS.titleText),
  summary: text(LIMITS.summaryText),
  question: text(LIMITS.questionText).nullable(),
  repository: RepositoryReportSchema.nullable(),
  impact: ImpactReportSchema.nullable(),
  verification: VerificationReportSchema.nullable(),
  evidence: z.array(EvidenceSchema).max(LIMITS.evidencePerReport * 3),
  limitations: z.array(text(LIMITS.noteText)).max(LIMITS.notes),
  updatedAt: IsoTimeSchema,
})
  .refine(
    (finding) => finding.run === null
      || (finding.run.decisionId === finding.decisionId
        && finding.run.decisionVersion === finding.decisionVersion
        && finding.run.contextRevision === finding.contextRevision),
    'finding run keys must match the finding decision keys',
  ) satisfies z.ZodType<Finding>;

export const ThreadViewSchema = z.strictObject({
  thread: ThreadRefSchema,
  enrolled: z.boolean(),
  contextRevision: z.number().int().min(0),
  decision: DecisionSchema.nullable(),
  finding: FindingSchema.nullable(),
  publicationPending: z.boolean(),
}) satisfies z.ZodType<ThreadView>;

export const OwnerActionSchema = z.strictObject({
  actionId: UuidSchema,
  thread: ThreadRefSchema,
  actorId: requiredText(64),
  decisionId: UuidSchema,
  expectedVersion: z.number().int().min(1),
  expectedContextRevision: z.number().int().min(0),
  kind: z.enum(['confirm', 'tentative', 'withdraw']),
  occurredAt: IsoTimeSchema,
}) satisfies z.ZodType<OwnerAction>;

export const IngestReceiptSchema = z.strictObject({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  contextRevision: z.number().int().min(0).nullable(),
  reason: text(LIMITS.noteText).nullable(),
}) satisfies z.ZodType<IngestReceipt>;

export const ActionReceiptSchema = z.strictObject({
  status: z.enum(['accepted', 'duplicate', 'stale', 'forbidden', 'not_found']),
  view: ThreadViewSchema.nullable(),
}) satisfies z.ZodType<ActionReceipt>;

export const PublicationSchema = z.strictObject({
  id: UuidSchema,
  thread: ThreadRefSchema,
  findingId: UuidSchema,
  decisionVersion: z.number().int().min(1),
  contextRevision: z.number().int().min(0),
  revision: z.number().int().min(1),
  text: requiredText(LIMITS.publicationText),
  existingTs: SlackTsSchema.nullable(),
}) satisfies z.ZodType<Publication>;

export const DeliveryResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('delivered'), ts: SlackTsSchema }),
  z.strictObject({ status: z.literal('uncertain'), error: PublicErrorSchema }),
  z.strictObject({ status: z.literal('retryable'), error: PublicErrorSchema, retryAfterMs: z.number().int().min(0).nullable() }),
  z.strictObject({ status: z.literal('permanent_failure'), error: PublicErrorSchema }),
]) satisfies z.ZodType<DeliveryResult>;

export const PublicationReceiptSchema = z.strictObject({
  publicationId: UuidSchema,
  findingId: UuidSchema,
  publicationRevision: z.number().int().min(1),
  thread: ThreadRefSchema,
  ts: SlackTsSchema,
  botUserId: requiredText(64),
  observedAt: IsoTimeSchema,
}) satisfies z.ZodType<PublicationReceipt>;

export const TriageResultSchema = z.strictObject({
  classification: z.enum(['irrelevant', 'exploratory', 'policy_proposed']),
  confidence: z.number().min(0).max(1),
  rationale: text(LIMITS.noteText),
}) satisfies z.ZodType<TriageResult>;

export const AccountSchema = z.strictObject({
  id: KeySchema,
  plan: PlanSchema,
  organizationType: OrganizationTypeSchema,
  universityVerified: z.boolean(),
}) satisfies z.ZodType<Account>;

export const RetainedRecordSchema = z.strictObject({
  id: KeySchema,
  accountId: KeySchema,
  createdAt: IsoTimeSchema,
}) satisfies z.ZodType<RetainedRecord>;

export const SCHEMAS = {
  Account: AccountSchema,
  ActionReceipt: ActionReceiptSchema,
  CheckResult: CheckResultSchema,
  CommitTarget: CommitTargetSchema,
  Decision: DecisionSchema,
  DeliveryResult: DeliveryResultSchema,
  Evidence: EvidenceSchema,
  Finding: FindingSchema,
  ImpactReport: ImpactReportSchema,
  ImpactRequest: ImpactRequestSchema,
  InboundEvent: InboundEventSchema,
  IngestReceipt: IngestReceiptSchema,
  Interpretation: InterpretationSchema,
  OwnerAction: OwnerActionSchema,
  PolicyIntent: PolicyIntentSchema,
  PublicError: PublicErrorSchema,
  Publication: PublicationSchema,
  PublicationReceipt: PublicationReceiptSchema,
  RepositoryId: RepositoryIdSchema,
  RepositoryReport: RepositoryReportSchema,
  RetainedRecord: RetainedRecordSchema,
  TriageResult: TriageResultSchema,
  RetentionProjection: RetentionProjectionSchema,
  RetentionRule: RetentionRuleSchema,
  RunContext: RunContextSchema,
  Scope: ScopeSchema,
  SlackMessage: SlackMessageSchema,
  ThreadRef: ThreadRefSchema,
  ThreadView: ThreadViewSchema,
  TraceEdge: TraceEdgeSchema,
  VerificationReport: VerificationReportSchema,
} as const;

export type SchemaName = keyof typeof SCHEMAS;
