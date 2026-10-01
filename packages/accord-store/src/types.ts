/** @accord/store public type surface. Owner: Agent 1.
 * PostgreSQL is the durable authority. Only @accord/core and apps/worker consume this package;
 * Agents 2, 3 and 4 depend on @accord/contracts and the core ApplicationPort instead, so this
 * surface may still evolve on accord/core without a contract version bump.
 */
import type {
  CommitTarget, Decision, DecisionStatus, Finding, Id, InboundEvent, IsoTime, OwnerAction, Publication,
  PublicationReceipt, PublicationReceiptReader, RepositoryReport, RunContext, ThreadRef, ThreadView,
} from '@accord/contracts';

export interface StoreConfig {
  databaseUrl: string;
  maxConnections: number;
  statementTimeoutMs: number;
}

export const DEFAULT_STORE_CONFIG = {
  maxConnections: 10,
  statementTimeoutMs: 15_000,
} as const;

export interface ThreadRow {
  id: Id;
  thread: ThreadRef;
  enrolled: boolean;
  contextRevision: number;
  activeDecisionId: Id | null;
  activeVersion: number | null;
  findingMessageTs: string | null;
}

export type JobTaskType = 'accord-process-context' | 'accord-investigate' | 'accord-publish' | 'accord-reconcile';

export interface JobIntent {
  id: Id;
  logicalKey: string;
  taskType: JobTaskType;
  payload: Record<string, unknown>;
  status: 'pending' | 'dispatched' | 'completed' | 'failed';
  triggerRunId: string | null;
  attempts: number;
  nextAttemptAt: IsoTime | null;
}

export type DeliveryStatus =
  | 'pending' | 'sending' | 'delivered' | 'uncertain' | 'retryable' | 'permanent_failure' | 'superseded';

/**
 * The outbox stores everything about a publication except its text. Text is rendered at send time
 * from the current persisted view, so a queued row can never deliver stale wording.
 */
export type PublicationDraft = Omit<Publication, 'text'>;

export interface OutboxRow {
  id: Id;
  threadId: Id;
  findingId: Id;
  draft: PublicationDraft;
  publicationRevision: number;
  expectedVersion: number;
  expectedContextRevision: number;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: IsoTime | null;
  leaseOwner: string | null;
  leaseUntil: IsoTime | null;
  deliveredTs: string | null;
}

export interface AcceptEventOptions {
  /** Enroll an unenrolled thread although the event is not a mention. Set only by triage. */
  enroll?: boolean;
}

export interface AcceptedEvent {
  accepted: boolean;
  duplicate: boolean;
  /** True only when this acceptance enrolled a previously unenrolled thread. */
  enrolled: boolean;
  reason: string | null;
  threadId: Id | null;
  contextRevision: number | null;
  jobIntent: JobIntent | null;
}

export type InvestigationStatus =
  | 'queued' | 'interpreting' | 'waiting_for_clarification' | 'investigating' | 'analyzing_impact'
  | 'verifying' | 'completed' | 'superseded' | 'failed' | 'cancelled';

export interface InvestigationRow {
  id: Id;
  threadId: Id;
  run: RunContext;
  status: InvestigationStatus;
  attempt: number;
  triggerRunId: string | null;
  error: string | null;
}

export interface DecisionDraft {
  decisionId: Id | null;
  status: DecisionStatus;
  intent: Decision['intent'];
  intentHash: string | null;
  ownerId: string;
  sourceMessageIds: string[];
  confirmedBy: string | null;
  confirmedAt: IsoTime | null;
  contextRevision: number;
}

/** The store assigns the finding's stable per-thread id and its revision. */
export type FindingDraft = Omit<Finding, 'id' | 'updatedAt'>;

export interface CommitOutcome {
  committed: boolean;
  reason: 'superseded' | null;
  finding: Finding | null;
  publication: PublicationDraft | null;
  /** Persisted in the same transaction; dispatched to Trigger.dev after the commit. */
  jobIntent: JobIntent | null;
}

/**
 * Every method is parameterized and transaction-aware; callers never build SQL strings.
 * Any method that makes a result current compares decision version AND context revision
 * inside one transaction.
 */
export interface StorePort {
  migrate(): Promise<{ appliedVersion: number }>;
  close(): Promise<void>;

  /** Never creates a thread. An unknown thread is enrolled=false, contextRevision=0, nulls. */
  getThreadView(thread: ThreadRef): Promise<ThreadView>;
  getThreadRow(thread: ThreadRef): Promise<ThreadRow | null>;
  getThreadRowById(threadId: Id): Promise<ThreadRow | null>;

  /** Durable acceptance: dedupe, enrollment, revision increment, job intent and fencing in one transaction. */
  acceptEvent(event: InboundEvent, options?: AcceptEventOptions): Promise<AcceptedEvent>;
  markEventProcessed(eventKey: string): Promise<void>;
  readEvent(eventKey: string): Promise<InboundEvent | null>;

  getActiveDecision(threadId: Id): Promise<Decision | null>;
  getDecisionVersion(decisionId: Id, version: number): Promise<Decision | null>;
  /** Returns null when the thread already advanced past draft.contextRevision. */
  appendDecisionVersion(threadId: Id, draft: DecisionDraft): Promise<Decision | null>;
  recordOwnerAction(action: OwnerAction, outcome: string): Promise<{ duplicate: boolean }>;
  readOwnerAction(actionId: Id): Promise<{ outcome: string } | null>;

  createInvestigation(threadId: Id, run: RunContext): Promise<InvestigationRow>;
  getInvestigation(investigationId: Id): Promise<InvestigationRow | null>;
  updateInvestigationStatus(investigationId: Id, status: InvestigationStatus, error?: string | null): Promise<void>;
  supersedeStaleInvestigations(threadId: Id, currentContextRevision: number): Promise<number>;
  saveInvestigationTarget(input: { investigationId: Id; target: CommitTarget; kind: 'target' | 'base_target' }): Promise<void>;
  saveStepResult(input: { investigationId: Id; stepKey: string; inputHash: string; result: unknown }): Promise<void>;
  readStepResult(input: { investigationId: Id; stepKey: string; inputHash: string }): Promise<unknown | null>;

  /** Baseline reports are frozen per decision version and never overwritten by a candidate report. */
  saveBaselineReport(input: { decisionId: Id; decisionVersion: number; report: RepositoryReport }): Promise<void>;
  readBaselineReport(input: { decisionId: Id; decisionVersion: number }): Promise<RepositoryReport | null>;

  /** Saves the finding and enqueues its publication atomically, or reports superseded without writing. */
  commitFinding(input: { threadId: Id; finding: FindingDraft; now: IsoTime }): Promise<CommitOutcome>;
  readFinding(findingId: Id): Promise<Finding | null>;

  claimDueOutboxRow(input: { leaseOwner: string; leaseMs: number }): Promise<OutboxRow | null>;
  claimOutboxRow(input: { publicationId: Id; leaseOwner: string; leaseMs: number }): Promise<OutboxRow | null>;
  enqueueCorrection(threadId: Id): Promise<{ publication: PublicationDraft; jobIntent: JobIntent | null } | null>;
  readOutboxRow(publicationId: Id): Promise<OutboxRow | null>;
  completeDelivery(input: {
    publicationId: Id;
    status: DeliveryStatus;
    deliveredTs: string | null;
    error: string | null;
    retryAfterMs: number | null;
  }): Promise<void>;
  setThreadFindingMessageTs(threadId: Id, ts: string): Promise<void>;

  recordPublicationReceipt(receipt: PublicationReceipt): Promise<{ recorded: boolean; reason: string | null }>;
  receiptReader(): PublicationReceiptReader;

  enqueueJobIntent(input: {
    logicalKey: string;
    taskType: JobTaskType;
    payload: Record<string, unknown>;
  }): Promise<{ intent: JobIntent; created: boolean }>;
  markJobDispatched(intentId: Id, triggerRunId: string): Promise<void>;
  markJobCompleted(logicalKey: string): Promise<void>;
  listPendingJobIntents(limit: number): Promise<JobIntent[]>;
  listDueOutboxIds(limit: number): Promise<Id[]>;
}

export type StoreFactory = (config: StoreConfig) => Promise<StorePort>;
