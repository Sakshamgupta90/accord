/** The coordinator: context processing, investigation orchestration and publication.
 * Every step re-checks decision version and context revision, so an obsolete pass can finish
 * harmlessly but can never become the authoritative current finding.
 */
import { randomUUID } from 'node:crypto';
import {
  AccordError, PublicationSchema, canonicalJson, policyIntentHash, publicError, sha256Hex, validate,
} from '@accord/contracts';
import type {
  Decision, ImpactReport, Publication, RepositoryReport, RunContext, VerificationReport,
} from '@accord/contracts';
import { contextJobKey, publishJobKey } from '@accord/store';
import type { JobIntent, StorePort, ThreadRow } from '@accord/store';
import { authorize, confirmationFields, isAllowedPullRequestUrl, isMaterialChange } from './authorization.js';
import { composeFinding } from './finding.js';
import type { FindingDraft } from './finding.js';
import { INTERPRETER_INSTRUCTIONS, interpret } from './interpretation.js';
import { DEFAULT_BUDGETS, TASK_IDS } from './types.js';
import type {
  IngressDependencies, InvestigationDependencies, InvestigationPayload, ProcessContextPayload,
  PublishDependencies,
} from './types.js';

export { INTERPRETER_INSTRUCTIONS };

/** Dispatch happens after the commit. A failure here leaves a durable pending intent for reconcile. */
export async function dispatchIntent(deps: { store: StorePort; scheduler: { dispatch: (intent: JobIntent) => Promise<{ triggerRunId: string }> }; logger: IngressDependencies['logger'] }, intent: JobIntent | null): Promise<void> {
  if (!intent || intent.status !== 'pending') return;
  try {
    const { triggerRunId } = await deps.scheduler.dispatch(intent);
    await deps.store.markJobDispatched(intent.id, triggerRunId);
  } catch (error) {
    deps.logger.error('job_dispatch_failed', {
      logicalKey: intent.logicalKey,
      taskType: intent.taskType,
      code: (error as { public?: { code?: string } }).public?.code ?? 'PROVIDER_ERROR',
    });
  }
}

async function commitAndSchedule(
  deps: InvestigationDependencies | IngressDependencies,
  threadId: string,
  draft: FindingDraft,
): Promise<boolean> {
  const outcome = await deps.store.commitFinding({ threadId, finding: draft, now: deps.clock.now() });
  if (!outcome.committed) {
    deps.logger.info('finding_superseded', { threadId, decisionVersion: draft.decisionVersion, contextRevision: draft.contextRevision });
    return false;
  }
  await dispatchIntent(deps, outcome.jobIntent);
  return true;
}

function runContext(
  decision: Decision,
  contextRevision: number,
  deps: InvestigationDependencies | IngressDependencies,
  mode: RunContext['mode'],
): RunContext {
  return {
    investigationId: randomUUID(),
    decisionId: decision.id,
    decisionVersion: decision.version,
    contextRevision,
    datasetVersion: deps.dataset.version,
    asOf: deps.dataset.asOf,
    mode,
  };
}

export function investigationJobKey(run: RunContext): string {
  return `investigate:${run.decisionId}:${run.decisionVersion}:${run.contextRevision}:${run.mode}`;
}

async function scheduleInvestigation(
  deps: InvestigationDependencies | IngressDependencies,
  threadId: string,
  decision: Decision,
  contextRevision: number,
  mode: RunContext['mode'],
  pullRequestUrl: string | null,
): Promise<void> {
  const run = runContext(decision, contextRevision, deps, mode);
  const investigation = await deps.store.createInvestigation(threadId, run);
  const { intent } = await deps.store.enqueueJobIntent({
    logicalKey: investigationJobKey(investigation.run),
    taskType: TASK_IDS.investigate,
    payload: {
      investigationId: investigation.id,
      decisionId: decision.id,
      decisionVersion: decision.version,
      contextRevision,
      pullRequestUrl,
    },
  });
  await dispatchIntent(deps, intent);
}

/**
 * Context task body. Loads the permitted snapshot, rechecks the revision, interprets, enforces
 * authorization in code, and either clarifies durably or schedules the investigation.
 */
export async function processContext(deps: InvestigationDependencies, payload: ProcessContextPayload): Promise<void> {
  const thread = await deps.store.getThreadRowById(payload.threadId);
  if (!thread) return;
  if (thread.contextRevision !== payload.contextRevision) {
    deps.logger.info('context_superseded', { threadId: thread.id, at: payload.contextRevision, current: thread.contextRevision });
    return;
  }

  const event = await deps.store.readEvent(payload.eventKey);
  if (!event) return;

  const current = await deps.store.getActiveDecision(thread.id);
  const outcome = await interpret(
    deps.model,
    { messages: event.snapshot, current, ownerId: deps.ownerId, contextRevision: thread.contextRevision },
    DEFAULT_BUDGETS.interpretationAttempts,
  );

  if (!outcome.ok || !outcome.interpretation) {
    // A refusal, an empty result or an invalid schema is an explicit error, never a fabricated decision.
    const code = outcome.error?.code ?? 'PROVIDER_ERROR';
    if (!current) {
      // Nothing is tracked in this thread yet, so there is no finding to keep honest. Posting a
      // "potential conflict" for what may be an ordinary question would be noise; log it instead.
      deps.logger.error('interpretation_failed_no_decision', { threadId: thread.id, code });
      await deps.store.markEventProcessed(payload.eventKey);
      return;
    }
    await reportInterpretationFailure(deps, thread, current, code);
    await deps.store.markEventProcessed(payload.eventKey);
    return;
  }

  const decision = authorize({
    interpretation: outcome.interpretation,
    actorId: event.message.authorId,
    ownerId: deps.ownerId,
    current,
    snapshotComplete: event.snapshotComplete,
  });

  if (decision.kind === 'ignore' || decision.kind === 'status') {
    deps.logger.info('context_no_change', { threadId: thread.id, kind: decision.kind });
    await deps.store.markEventProcessed(payload.eventKey);
    return;
  }

  if (decision.kind === 'verify') {
    if (!isAllowedPullRequestUrl(decision.pullRequestUrl, deps.repositoryTarget)) {
      // An unsupported target is refused outright; the prior finding stands.
      await clarify(
        deps,
        thread,
        current,
        `I can only verify pull requests in ${deps.repositoryTarget.owner}/${deps.repositoryTarget.name}. That link points somewhere else.`,
        outcome.interpretation.sourceMessageIds,
        'unsupported verification target',
      );
      await deps.store.markEventProcessed(payload.eventKey);
      return;
    }
    if (!current) {
      await clarify(deps, thread, current, 'There is no confirmed retention decision in this thread to verify against yet.', outcome.interpretation.sourceMessageIds);
    } else {
      await scheduleInvestigation(deps, thread.id, current, thread.contextRevision, 'verify_pr', decision.pullRequestUrl);
    }
    await deps.store.markEventProcessed(payload.eventKey);
    return;
  }

  if (decision.kind === 'clarify') {
    await clarify(deps, thread, current, decision.question, outcome.interpretation.sourceMessageIds, decision.reason, decision.intent);
    await deps.store.markEventProcessed(payload.eventKey);
    return;
  }

  // decision.kind === 'decision'
  if (!isMaterialChange(current, decision.status, decision.intent)) {
    deps.logger.info('decision_idempotent', { threadId: thread.id, status: decision.status });
    await deps.store.markEventProcessed(payload.eventKey);
    return;
  }

  const now = deps.clock.now();
  const appended = await deps.store.appendDecisionVersion(thread.id, {
    decisionId: current?.id ?? null,
    status: decision.status,
    intent: decision.intent,
    intentHash: decision.intent ? policyIntentHash(decision.intent) : null,
    ownerId: deps.ownerId,
    sourceMessageIds: outcome.interpretation.sourceMessageIds,
    contextRevision: thread.contextRevision,
    ...confirmationFields(decision.status, event.message.authorId, now),
  });
  if (!appended) {
    deps.logger.info('decision_superseded', { threadId: thread.id, at: thread.contextRevision });
    return;
  }

  if (decision.status === 'withdrawn') {
    await deps.store.supersedeStaleInvestigations(thread.id, thread.contextRevision + 1);
    await commitAndSchedule(deps, thread.id, composeFinding({
      decision: appended,
      contextRevision: thread.contextRevision,
      run: null,
      repository: null,
      impact: null,
      verification: null,
      question: null,
      reasons: [decision.reason],
    }, now));
    await deps.store.markEventProcessed(payload.eventKey);
    return;
  }

  if (!appended.intent) {
    await commitAndSchedule(deps, thread.id, composeFinding({
      decision: appended,
      contextRevision: thread.contextRevision,
      run: null,
      repository: null,
      impact: null,
      verification: null,
      question: 'Which accounts, how many days, and does it apply to records already stored?',
      reasons: [decision.reason],
    }, now));
  } else {
    await scheduleInvestigation(deps, thread.id, appended, thread.contextRevision, 'baseline', null);
  }
  await deps.store.markEventProcessed(payload.eventKey);
}

async function clarify(
  deps: InvestigationDependencies,
  thread: ThreadRow,
  current: Decision | null,
  question: string,
  sourceMessageIds: string[],
  reason = 'clarification required',
  intent: Decision['intent'] = null,
): Promise<void> {
  const now = deps.clock.now();
  const decision = await deps.store.appendDecisionVersion(thread.id, {
    decisionId: current?.id ?? null,
    status: 'candidate',
    intent,
    intentHash: intent ? policyIntentHash(intent) : null,
    ownerId: deps.ownerId,
    sourceMessageIds,
    contextRevision: thread.contextRevision,
    confirmedBy: null,
    confirmedAt: null,
  });
  if (!decision) return;
  await commitAndSchedule(deps, thread.id, composeFinding({
    decision,
    contextRevision: thread.contextRevision,
    run: null,
    repository: null,
    impact: null,
    verification: null,
    question,
    reasons: [reason],
  }, now));
}

async function reportInterpretationFailure(
  deps: InvestigationDependencies,
  thread: ThreadRow,
  current: Decision | null,
  code: string,
): Promise<void> {
  await clarify(
    deps,
    thread,
    current,
    'I could not interpret that reliably. Please restate the scope, the retention period in days, and whether it applies to records already stored.',
    [],
    `interpretation failed (${code})`,
  );
}

class Deadline {
  private readonly endsAt: number;
  constructor(budgetMs: number) {
    this.endsAt = Date.now() + budgetMs;
  }
  remaining(): number {
    return this.endsAt - Date.now();
  }
  assert(step: string): void {
    if (this.remaining() <= 0) {
      throw new AccordError(publicError('TIMEOUT', `investigation budget exhausted before ${step}`));
    }
  }
  async race<T>(step: string, work: Promise<T>): Promise<T> {
    this.assert(step);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new AccordError(publicError('TIMEOUT', `step ${step} exceeded the investigation budget`))), Math.max(1, this.remaining()));
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function stepHash(parts: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(parts));
}

/** Investigation task body. Repository first, then data, then a code-composed finding. */
export async function runInvestigation(deps: InvestigationDependencies, payload: InvestigationPayload): Promise<void> {
  const investigation = await deps.store.getInvestigation(payload.investigationId);
  if (!investigation) return;
  if (['superseded', 'completed', 'failed', 'cancelled'].includes(investigation.status)) return;

  const thread = await deps.store.getThreadRowById(investigation.threadId);
  const run = investigation.run;
  if (!thread || thread.contextRevision !== run.contextRevision || thread.activeVersion !== run.decisionVersion) {
    await deps.store.updateInvestigationStatus(investigation.id, 'superseded');
    deps.logger.info('investigation_superseded', { investigationId: investigation.id });
    return;
  }

  const decision = await deps.store.getDecisionVersion(run.decisionId, run.decisionVersion);
  if (!decision || !decision.intent) {
    await deps.store.updateInvestigationStatus(investigation.id, 'cancelled', 'no complete intent to investigate');
    return;
  }

  const deadline = new Deadline(DEFAULT_BUDGETS.investigationWallMs);
  const reasons: string[] = [];
  let repository: RepositoryReport | null = null;
  let impact: ImpactReport | null = null;
  let verification: VerificationReport | null = null;

  try {
    deps.privacy.assertAudience({
      thread: thread.thread,
      repository: { owner: deps.repositoryTarget.owner, name: deps.repositoryTarget.name },
      datasetVersion: run.datasetVersion,
    });

    await deps.store.updateInvestigationStatus(investigation.id, 'investigating');

    if (run.mode === 'baseline') {
      repository = await inspectCheckpointed(deps, deadline, investigation.id, run, decision, null);
      await deps.store.saveBaselineReport({ decisionId: run.decisionId, decisionVersion: run.decisionVersion, report: repository });

      if (!repository.observedProjection || repository.trustedRuntime === 'unsupported') {
        reasons.push('No trustworthy runtime projection was established, so no record impact was computed.');
      } else {
        await deps.store.updateInvestigationStatus(investigation.id, 'analyzing_impact');
        impact = await analyzeCheckpointed(deps, deadline, investigation.id, run, decision, repository.observedProjection, repository.observedProjection, repository);
      }
    } else {
      // Verification needs a frozen baseline for this decision version. An older baseline context
      // revision is valid: posting a pull request is itself a new event.
      let baseline = await deps.store.readBaselineReport({ decisionId: run.decisionId, decisionVersion: run.decisionVersion });
      if (!baseline) {
        baseline = await inspectCheckpointed(deps, deadline, investigation.id, run, decision, null);
        await deps.store.saveBaselineReport({ decisionId: run.decisionId, decisionVersion: run.decisionVersion, report: baseline });
      }

      const candidate = await inspectCheckpointed(deps, deadline, investigation.id, run, decision, payload.pullRequestUrl ?? null);
      await deps.store.updateInvestigationStatus(investigation.id, 'verifying');
      verification = await deadline.race('repository.verify', deps.repository.verify({ run, decision, baseline, candidate }));
      repository = candidate;

      if (candidate.observedProjection && baseline.observedProjection) {
        await deps.store.updateInvestigationStatus(investigation.id, 'analyzing_impact');
        impact = await analyzeCheckpointed(deps, deadline, investigation.id, run, decision, candidate.observedProjection, baseline.observedProjection, candidate);
      } else {
        reasons.push('Record impact could not be recomputed for the candidate commit.');
      }

      if (verification.verdict === 'verified_at_commit' && impact === null) {
        reasons.push('Required data check unavailable; verification cannot be green without it.');
        verification = { ...verification, verdict: 'insufficient_evidence' };
      }
    }
  } catch (error) {
    const code = (error as { public?: { code?: string } }).public?.code ?? 'PROVIDER_ERROR';
    await deps.store.updateInvestigationStatus(investigation.id, 'failed', code);
    reasons.push(`Investigation stopped: ${code}.`);
  }

  const draft = composeFinding({
    decision,
    contextRevision: run.contextRevision,
    run,
    repository,
    impact,
    verification,
    question: null,
    reasons,
  }, deps.clock.now());

  const committed = await commitAndSchedule(deps, thread.id, draft);
  await deps.store.updateInvestigationStatus(investigation.id, committed ? 'completed' : 'superseded');
  await deps.store.markJobCompleted(investigationJobKey(run));
}

async function inspectCheckpointed(
  deps: InvestigationDependencies,
  deadline: Deadline,
  investigationId: string,
  run: RunContext,
  decision: Decision,
  pullRequestUrl: string | null,
): Promise<RepositoryReport> {
  const target = await deadline.race('repository.resolveTarget', deps.repository.resolveTarget({
    repository: { owner: deps.repositoryTarget.owner, name: deps.repositoryTarget.name },
    ref: deps.repositoryTarget.ref,
    pullRequestUrl,
    pathPrefix: deps.repositoryTarget.pathPrefix,
  }));

  // Frozen on the run so every later claim can be traced back to the same commit.
  await deps.store.saveInvestigationTarget({
    investigationId,
    target,
    kind: pullRequestUrl ? 'target' : 'base_target',
  });

  const stepKey = pullRequestUrl ? 'repository.inspect.candidate' : 'repository.inspect.baseline';
  const inputHash = stepHash({
    intentHash: decision.intentHash,
    sha: target.sha,
    pathPrefix: target.pathPrefix,
    mode: run.mode,
  });

  const cached = await deps.store.readStepResult({ investigationId, stepKey, inputHash });
  if (cached) return cached as RepositoryReport;

  const report = await deadline.race('repository.inspect', deps.repository.inspect({ run, decision, target }));
  await deps.store.saveStepResult({ investigationId, stepKey, inputHash, result: report });
  return report;
}

async function analyzeCheckpointed(
  deps: InvestigationDependencies,
  deadline: Deadline,
  investigationId: string,
  run: RunContext,
  decision: Decision,
  observedProjection: NonNullable<RepositoryReport['observedProjection']>,
  baselineProjection: NonNullable<RepositoryReport['observedProjection']>,
  report: RepositoryReport,
): Promise<ImpactReport> {
  if (!decision.intent) throw new AccordError(publicError('INVALID_INPUT', 'impact analysis requires a complete intent'));

  // asOf and dataset version are part of the key: a new asOf never reuses an old query result.
  const inputHash = stepHash({
    intentHash: decision.intentHash,
    observedProjection,
    baselineProjection,
    datasetVersion: run.datasetVersion,
    asOf: run.asOf,
  });
  const cached = await deps.store.readStepResult({ investigationId, stepKey: 'impact.analyze', inputHash });
  if (cached) return cached as ImpactReport;

  const result = await deadline.race('impact.analyze', deps.impact.analyze({
    run,
    intent: decision.intent,
    observedProjection,
    baselineProjection,
    repositoryEvidenceIds: report.evidence.map((item) => item.id),
  }));
  await deps.store.saveStepResult({ investigationId, stepKey: 'impact.analyze', inputHash, result });
  return result;
}

/**
 * Publication worker body. Claims a lease, rechecks freshness, renders from the current persisted
 * view, and sends outside any transaction.
 */
export async function publishPending(deps: PublishDependencies, publicationId: string): Promise<void> {
  const row = await deps.store.claimOutboxRow({
    publicationId,
    leaseOwner: deps.leaseOwner,
    leaseMs: DEFAULT_BUDGETS.publishLeaseMs,
  });
  if (!row) return;

  const view = await deps.store.getThreadView(row.draft.thread);
  if (view.contextRevision !== row.expectedContextRevision || (view.decision?.version ?? null) !== row.expectedVersion) {
    await deps.store.completeDelivery({ publicationId, status: 'superseded', deliveredTs: null, error: null, retryAfterMs: null });
    deps.logger.info('publication_superseded', { publicationId });
    return;
  }

  const publication: Publication = validate(
    PublicationSchema,
    { ...row.draft, text: deps.render(view) },
    'Publication about to be delivered',
  );

  const result = await deps.publisher.deliver(publication);

  if (result.status === 'delivered') {
    await deps.store.completeDelivery({ publicationId, status: 'delivered', deliveredTs: result.ts, error: null, retryAfterMs: null });
    await deps.store.setThreadFindingMessageTs(row.threadId, result.ts);
    await correctIfChanged(deps, row.threadId, row.expectedVersion, row.expectedContextRevision);
    return;
  }

  if (result.status === 'uncertain') {
    // Reconcile before any possible resend. A failed reconciliation read is unknown, not not_found.
    const reconciled = await deps.publisher.reconcile(publication).catch(() => ({ status: 'unknown' as const }));
    if (reconciled.status === 'found') {
      await deps.store.completeDelivery({ publicationId, status: 'delivered', deliveredTs: reconciled.ts, error: null, retryAfterMs: null });
      await deps.store.setThreadFindingMessageTs(row.threadId, reconciled.ts);
      await correctIfChanged(deps, row.threadId, row.expectedVersion, row.expectedContextRevision);
      return;
    }
    if (reconciled.status === 'not_found') {
      await deps.store.completeDelivery({ publicationId, status: 'retryable', deliveredTs: null, error: result.error.code, retryAfterMs: 5_000 });
      return;
    }
    await deps.store.completeDelivery({ publicationId, status: 'uncertain', deliveredTs: null, error: result.error.code, retryAfterMs: 30_000 });
    return;
  }

  if (result.status === 'retryable') {
    await deps.store.completeDelivery({
      publicationId,
      status: 'retryable',
      deliveredTs: null,
      error: result.error.code,
      retryAfterMs: result.retryAfterMs ?? backoffMs(row.attempts),
    });
    return;
  }

  await deps.store.completeDelivery({ publicationId, status: 'permanent_failure', deliveredTs: null, error: result.error.code, retryAfterMs: null });
  deps.logger.error('publication_permanent_failure', { publicationId, code: result.error.code });
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** If the decision moved while the send was in flight, enqueue the correction immediately. */
async function correctIfChanged(
  deps: PublishDependencies,
  threadId: string,
  expectedVersion: number,
  expectedContextRevision: number,
): Promise<void> {
  const thread = await deps.store.getThreadRowById(threadId);
  if (!thread) return;
  if (thread.contextRevision === expectedContextRevision && thread.activeVersion === expectedVersion) return;
  const correction = await deps.store.enqueueCorrection(threadId);
  if (correction) {
    deps.logger.info('publication_correction_enqueued', { threadId, publicationId: correction.publication.id });
  }
}

/**
 * Reconciliation sweep: redispatch persisted job intents that never reached Trigger.dev, and
 * re-enqueue publications whose lease expired. This is what makes the outbox durable rather than
 * dependent on any process staying alive.
 */
export async function reconcile(
  deps: IngressDependencies,
  limits = { intents: 50, publications: 50 },
): Promise<{ dispatched: number; republished: number }> {
  const pending = await deps.store.listPendingJobIntents(limits.intents);
  for (const intent of pending) {
    await dispatchIntent(deps, intent);
  }

  const due = await deps.store.listDueOutboxIds(limits.publications);
  for (const publicationId of due) {
    const { intent } = await deps.store.enqueueJobIntent({
      logicalKey: publishJobKey(publicationId),
      taskType: TASK_IDS.publish,
      payload: { publicationId },
    });
    await dispatchIntent(deps, intent);
  }

  return { dispatched: pending.length, republished: due.length };
}

export { contextJobKey };
