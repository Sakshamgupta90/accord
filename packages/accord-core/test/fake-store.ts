/** In-memory StorePort double. Test-only: it lives under test/ and is never importable from
 * the package root, so production composition can never select it because a key is missing.
 * It reproduces the fencing rules of the SQL implementation, not its storage.
 */
import { randomUUID } from 'node:crypto';
import { FindingSchema, validate } from '@accord/contracts';
import type {
  Decision, Finding, InboundEvent, OwnerAction, PublicationReceipt, RepositoryReport, RunContext,
  ThreadRef, ThreadView,
} from '@accord/contracts';
import type {
  AcceptedEvent, AcceptEventOptions, CommitOutcome, DecisionDraft, DeliveryStatus, FindingDraft, InvestigationRow,
  InvestigationStatus, JobIntent, JobTaskType, OutboxRow, PublicationDraft, StorePort, ThreadRow,
} from '@accord/store';

interface ThreadState extends ThreadRow {
  events: Map<string, InboundEvent>;
  processed: Set<string>;
}

const TERMINAL: ReadonlySet<InvestigationStatus> = new Set(['completed', 'superseded', 'failed', 'cancelled']);

function threadKey(thread: ThreadRef): string {
  return `${thread.teamId}/${thread.channelId}/${thread.rootTs}`;
}

export interface FakeStore extends StorePort {
  readonly dispatched: JobIntent[];
  readonly outbox: Map<string, OutboxRow>;
  /** Every intent ever enqueued, whatever its status. */
  readonly jobs: Map<string, JobIntent>;
  seedThread(thread: ThreadRef, options?: { enrolled?: boolean; contextRevision?: number }): ThreadRow;
  currentFinding(threadId: string): Finding | null;
}

export function createFakeStore(): FakeStore {
  const threads = new Map<string, ThreadState>();
  const decisions = new Map<string, Decision>();
  const investigations = new Map<string, InvestigationRow>();
  const steps = new Map<string, unknown>();
  const targets = new Map<string, unknown>();
  const baselines = new Map<string, RepositoryReport>();
  const findings = new Map<string, Finding>();
  const outbox = new Map<string, OutboxRow>();
  const jobs = new Map<string, JobIntent>();
  const receipts = new Map<string, PublicationReceipt>();
  const actions = new Map<string, string>();
  const dispatched: JobIntent[] = [];

  function findThread(thread: ThreadRef): ThreadState | null {
    return threads.get(threadKey(thread)) ?? null;
  }
  function byId(threadId: string): ThreadState | null {
    for (const state of threads.values()) if (state.id === threadId) return state;
    return null;
  }
  function decisionKey(decisionId: string, version: number): string {
    return `${decisionId}:${version}`;
  }
  function currentFindingFor(threadId: string): Finding | null {
    let latest: Finding | null = null;
    for (const [key, finding] of findings) {
      if (key.startsWith(`${threadId}:`)) latest = finding;
    }
    return latest;
  }
  function findingRevision(threadId: string): number {
    let revision = 0;
    for (const key of findings.keys()) {
      if (key.startsWith(`${threadId}:`)) revision = Math.max(revision, Number(key.split(':')[1] ?? 0));
    }
    return revision;
  }
  function enqueue(logicalKey: string, taskType: JobTaskType, payload: Record<string, unknown>): { intent: JobIntent; created: boolean } {
    const existing = jobs.get(logicalKey);
    if (existing) return { intent: existing, created: false };
    const intent: JobIntent = {
      id: randomUUID(), logicalKey, taskType, payload, status: 'pending', triggerRunId: null, attempts: 0, nextAttemptAt: null,
    };
    jobs.set(logicalKey, intent);
    return { intent, created: true };
  }

  const store: FakeStore = {
    dispatched,
    outbox,
    jobs,

    seedThread(thread, options) {
      const state: ThreadState = {
        id: randomUUID(),
        thread,
        enrolled: options?.enrolled ?? true,
        contextRevision: options?.contextRevision ?? 0,
        activeDecisionId: null,
        activeVersion: null,
        findingMessageTs: null,
        events: new Map(),
        processed: new Set(),
      };
      threads.set(threadKey(thread), state);
      return state;
    },

    currentFinding: currentFindingFor,

    async migrate() { return { appliedVersion: 1 }; },
    async close() { /* nothing to close */ },

    async getThreadView(thread: ThreadRef): Promise<ThreadView> {
      const state = findThread(thread);
      if (!state) return { thread, enrolled: false, contextRevision: 0, decision: null, finding: null, publicationPending: false };
      const decision = state.activeDecisionId && state.activeVersion !== null
        ? decisions.get(decisionKey(state.activeDecisionId, state.activeVersion)) ?? null
        : null;
      const pending = [...outbox.values()].some(
        (row) => row.threadId === state.id && ['pending', 'sending', 'retryable', 'uncertain'].includes(row.status),
      );
      return {
        thread: state.thread,
        enrolled: state.enrolled,
        contextRevision: state.contextRevision,
        decision,
        finding: currentFindingFor(state.id),
        publicationPending: pending,
      };
    },

    async getThreadRow(thread) {
      const state = findThread(thread);
      return state ? { ...state } : null;
    },
    async getThreadRowById(threadId) {
      const state = byId(threadId);
      return state ? { ...state } : null;
    },

    async acceptEvent(event: InboundEvent, options: AcceptEventOptions = {}): Promise<AcceptedEvent> {
      let state = findThread(event.thread);
      let enrolled = false;
      if (!state || !state.enrolled) {
        if (!event.wasMention && !options.enroll) {
          return { accepted: false, duplicate: false, enrolled: false, reason: 'thread not enrolled', threadId: state?.id ?? null, contextRevision: state?.contextRevision ?? null, jobIntent: null };
        }
        state = state ?? store.seedThread(event.thread, { enrolled: true, contextRevision: 0 }) as ThreadState;
        state = findThread(event.thread)!;
        state.enrolled = true;
        enrolled = true;
      }
      if (state.events.has(event.eventKey)) {
        return { accepted: true, duplicate: true, enrolled: false, reason: 'duplicate event', threadId: state.id, contextRevision: state.contextRevision, jobIntent: null };
      }
      state.events.set(event.eventKey, event);
      state.contextRevision += 1;
      for (const investigation of investigations.values()) {
        if (investigation.threadId === state.id && investigation.run.contextRevision < state.contextRevision && !TERMINAL.has(investigation.status)) {
          investigation.status = 'superseded';
        }
      }
      const { intent } = enqueue(`context:${state.id}:${state.contextRevision}`, 'accord-process-context', {
        threadId: state.id, eventKey: event.eventKey, contextRevision: state.contextRevision,
      });
      return { accepted: true, duplicate: false, enrolled, reason: null, threadId: state.id, contextRevision: state.contextRevision, jobIntent: intent };
    },

    async markEventProcessed(eventKey) {
      for (const state of threads.values()) if (state.events.has(eventKey)) state.processed.add(eventKey);
    },
    async readEvent(eventKey) {
      for (const state of threads.values()) {
        const event = state.events.get(eventKey);
        if (event) return event;
      }
      return null;
    },

    async getActiveDecision(threadId) {
      const state = byId(threadId);
      if (!state || !state.activeDecisionId || state.activeVersion === null) return null;
      return decisions.get(decisionKey(state.activeDecisionId, state.activeVersion)) ?? null;
    },
    async getDecisionVersion(decisionId, version) {
      return decisions.get(decisionKey(decisionId, version)) ?? null;
    },

    async appendDecisionVersion(threadId: string, draft: DecisionDraft): Promise<Decision | null> {
      const state = byId(threadId);
      if (!state) return null;
      // The same guard the SQL implementation applies inside its transaction.
      if (state.contextRevision !== draft.contextRevision) return null;
      const decisionId = draft.decisionId ?? randomUUID();
      let version = 0;
      for (const key of decisions.keys()) {
        if (key.startsWith(`${decisionId}:`)) version = Math.max(version, Number(key.split(':')[1] ?? 0));
      }
      version += 1;
      const now = new Date().toISOString();
      const decision: Decision = {
        id: decisionId,
        thread: state.thread,
        version,
        contextRevision: draft.contextRevision,
        status: draft.status,
        intent: draft.intent,
        ownerId: draft.ownerId,
        sourceMessageIds: draft.sourceMessageIds,
        intentHash: draft.intentHash,
        confirmedBy: draft.confirmedBy,
        confirmedAt: draft.confirmedAt,
        createdAt: now,
        updatedAt: now,
      };
      decisions.set(decisionKey(decisionId, version), decision);
      state.activeDecisionId = decisionId;
      state.activeVersion = version;
      return decision;
    },

    async readOwnerAction(actionId: string) {
      const outcome = actions.get(actionId);
      return outcome === undefined ? null : { outcome };
    },

    async recordOwnerAction(action: OwnerAction, outcome: string) {
      if (actions.has(action.actionId)) return { duplicate: true };
      actions.set(action.actionId, outcome);
      return { duplicate: false };
    },

    async createInvestigation(threadId: string, run: RunContext) {
      for (const investigation of investigations.values()) {
        const key = investigation.run;
        if (key.decisionId === run.decisionId && key.decisionVersion === run.decisionVersion
          && key.contextRevision === run.contextRevision && key.mode === run.mode) {
          investigation.attempt += 1;
          return investigation;
        }
      }
      const row: InvestigationRow = { id: run.investigationId, threadId, run, status: 'queued', attempt: 1, triggerRunId: null, error: null };
      investigations.set(row.id, row);
      return row;
    },
    async getInvestigation(investigationId) {
      return investigations.get(investigationId) ?? null;
    },
    async updateInvestigationStatus(investigationId, status, error) {
      const row = investigations.get(investigationId);
      if (row) {
        row.status = status;
        row.error = error ?? null;
      }
    },
    async supersedeStaleInvestigations(threadId, currentContextRevision) {
      let count = 0;
      for (const investigation of investigations.values()) {
        if (investigation.threadId === threadId && investigation.run.contextRevision < currentContextRevision && !TERMINAL.has(investigation.status)) {
          investigation.status = 'superseded';
          count += 1;
        }
      }
      return count;
    },
    async saveInvestigationTarget({ investigationId, target, kind }) {
      targets.set(`${investigationId}:${kind}`, target);
    },
    async saveStepResult({ investigationId, stepKey, inputHash, result }) {
      steps.set(`${investigationId}:${stepKey}:${inputHash}`, result);
    },
    async readStepResult({ investigationId, stepKey, inputHash }) {
      return steps.get(`${investigationId}:${stepKey}:${inputHash}`) ?? null;
    },
    async saveBaselineReport({ decisionId, decisionVersion, report }) {
      const key = decisionKey(decisionId, decisionVersion);
      if (!baselines.has(key)) baselines.set(key, report);
    },
    async readBaselineReport({ decisionId, decisionVersion }) {
      return baselines.get(decisionKey(decisionId, decisionVersion)) ?? null;
    },

    async commitFinding({ threadId, finding: draft, now }): Promise<CommitOutcome> {
      const state = byId(threadId);
      if (!state) return { committed: false, reason: 'superseded', finding: null, publication: null, jobIntent: null };
      if (state.contextRevision !== draft.contextRevision || state.activeVersion !== draft.decisionVersion) {
        return { committed: false, reason: 'superseded', finding: null, publication: null, jobIntent: null };
      }
      const previous = currentFindingFor(threadId);
      const findingId = previous?.id ?? randomUUID();
      const revision = findingRevision(threadId) + 1;
      const finding = validate(FindingSchema, { ...draft, id: findingId, updatedAt: now }, 'Finding');
      findings.set(`${threadId}:${revision}`, finding);

      for (const row of outbox.values()) {
        if (row.threadId === threadId && row.publicationRevision < revision && ['pending', 'retryable', 'uncertain'].includes(row.status)) {
          row.status = 'superseded';
        }
      }

      const publication: PublicationDraft = {
        id: randomUUID(),
        thread: state.thread,
        findingId,
        decisionVersion: finding.decisionVersion,
        contextRevision: finding.contextRevision,
        revision,
        existingTs: state.findingMessageTs,
      };
      outbox.set(publication.id, {
        id: publication.id,
        threadId,
        findingId,
        draft: publication,
        publicationRevision: revision,
        expectedVersion: finding.decisionVersion,
        expectedContextRevision: finding.contextRevision,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseUntil: null,
        deliveredTs: null,
      });
      const { intent } = enqueue(`publish:${publication.id}`, 'accord-publish', { publicationId: publication.id });
      return { committed: true, reason: null, finding, publication, jobIntent: intent };
    },

    async readFinding(findingId) {
      for (const finding of findings.values()) if (finding.id === findingId) return finding;
      return null;
    },

    async claimDueOutboxRow({ leaseOwner, leaseMs }) {
      for (const row of outbox.values()) {
        if (['pending', 'retryable', 'uncertain'].includes(row.status)) {
          row.status = 'sending';
          row.leaseOwner = leaseOwner;
          row.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
          row.attempts += 1;
          return { ...row };
        }
      }
      return null;
    },
    async claimOutboxRow({ publicationId, leaseOwner, leaseMs }) {
      const row = outbox.get(publicationId);
      if (!row) return null;
      const leaseExpired = row.status === 'sending' && row.leaseUntil !== null && Date.parse(row.leaseUntil) < Date.now();
      if (!['pending', 'retryable', 'uncertain'].includes(row.status) && !leaseExpired) return null;
      row.status = 'sending';
      row.leaseOwner = leaseOwner;
      row.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      row.attempts += 1;
      return { ...row };
    },
    async enqueueCorrection(threadId) {
      const state = byId(threadId);
      const previous = currentFindingFor(threadId);
      if (!state || !previous || state.activeVersion === null) return null;
      const revision = findingRevision(threadId) + 1;
      findings.set(`${threadId}:${revision}`, previous);
      const publication: PublicationDraft = {
        id: randomUUID(),
        thread: state.thread,
        findingId: previous.id,
        decisionVersion: state.activeVersion,
        contextRevision: state.contextRevision,
        revision,
        existingTs: state.findingMessageTs,
      };
      outbox.set(publication.id, {
        id: publication.id, threadId, findingId: previous.id, draft: publication,
        publicationRevision: revision, expectedVersion: state.activeVersion,
        expectedContextRevision: state.contextRevision, status: 'pending', attempts: 0,
        nextAttemptAt: null, leaseOwner: null, leaseUntil: null, deliveredTs: null,
      });
      const { intent } = enqueue(`publish:${publication.id}`, 'accord-publish', { publicationId: publication.id });
      return { publication, jobIntent: intent };
    },
    async readOutboxRow(publicationId) {
      const row = outbox.get(publicationId);
      return row ? { ...row } : null;
    },
    async completeDelivery({ publicationId, status, deliveredTs, error: _error }) {
      const row = outbox.get(publicationId);
      if (!row) return;
      row.status = status as DeliveryStatus;
      row.deliveredTs = deliveredTs ?? row.deliveredTs;
      row.leaseOwner = null;
      row.leaseUntil = null;
    },
    async setThreadFindingMessageTs(threadId, ts) {
      const state = byId(threadId);
      if (state && state.findingMessageTs === null) state.findingMessageTs = ts;
    },

    async recordPublicationReceipt(receipt) {
      const row = outbox.get(receipt.publicationId);
      if (!row || row.findingId !== receipt.findingId || row.publicationRevision !== receipt.publicationRevision) {
        return { recorded: false, reason: 'no matching publication' };
      }
      receipts.set(receipt.publicationId, receipt);
      return { recorded: true, reason: null };
    },
    receiptReader() {
      return { async find(publicationId) { return receipts.get(publicationId) ?? null; } };
    },

    async enqueueJobIntent(input) {
      return enqueue(input.logicalKey, input.taskType, input.payload);
    },
    async markJobDispatched(intentId, triggerRunId) {
      for (const intent of jobs.values()) {
        if (intent.id === intentId) {
          intent.status = 'dispatched';
          intent.triggerRunId = triggerRunId;
        }
      }
    },
    async markJobCompleted(logicalKey) {
      const intent = jobs.get(logicalKey);
      if (intent) intent.status = 'completed';
    },
    async listPendingJobIntents(limit) {
      return [...jobs.values()].filter((intent) => intent.status === 'pending').slice(0, limit);
    },
    async listDueOutboxIds(limit) {
      return [...outbox.values()]
        .filter((row) => ['pending', 'retryable', 'uncertain'].includes(row.status))
        .slice(0, limit)
        .map((row) => row.id);
    },
  };

  return store;
}
