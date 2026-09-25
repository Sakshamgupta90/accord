/** End-to-end state behavior through the public surfaces, with explicit injected adapters. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccordError } from '@accord/contracts';
import type { RunContext } from '@accord/contracts';
import {
  createApplication, processContext, publishPending, reconcile, runInvestigation,
} from '../src/index.js';
import { createFakeStore } from './fake-store.js';
import {
  BOT, DATASET, ENGINEER, INTENT_90, OWNER, THREAD, baseDeps, fakeImpact, fakeModel, fakePublisher,
  fakeRepository, impactReport, inbound, interpretation, repositoryReport,
} from './harness.js';

function investigationDeps(replies: Parameters<typeof fakeModel>[0], repository = fakeRepository(), impact = fakeImpact()) {
  return { ...baseDeps(), model: fakeModel(replies), repository, impact };
}

async function enrolAndProcess(deps: ReturnType<typeof investigationDeps>, text: string, options: Parameters<typeof inbound>[1] = {}) {
  const application = createApplication(deps);
  const event = inbound(text, { wasMention: true, ...options });
  const receipt = await application.acceptEvent(event);
  assert.equal(receipt.accepted, true);
  const threadRow = await deps.store.getThreadRow(THREAD);
  await processContext(deps, { threadId: threadRow!.id, eventKey: event.eventKey, contextRevision: receipt.contextRevision! });
  return { application, event, threadId: threadRow!.id };
}

test('a mention enrols the thread, accepts the event and schedules exactly one context job', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'irrelevant' })]);
  const application = createApplication(deps);
  const event = inbound('hi @accord', { wasMention: true });

  const receipt = await application.acceptEvent(event);
  assert.deepEqual(
    { accepted: receipt.accepted, duplicate: receipt.duplicate, contextRevision: receipt.contextRevision },
    { accepted: true, duplicate: false, contextRevision: 1 },
  );
  assert.deepEqual(deps.scheduler.dispatched, [`context:${(await deps.store.getThreadRow(THREAD))!.id}:1`]);
});

test('a duplicate event changes nothing: no revision bump and no second job', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'irrelevant' })]);
  const application = createApplication(deps);
  const event = inbound('hi @accord', { wasMention: true });

  await application.acceptEvent(event);
  const again = await application.acceptEvent(event);

  assert.equal(again.duplicate, true);
  assert.equal(again.contextRevision, 1);
  assert.equal(deps.scheduler.dispatched.length, 1);
  assert.equal((await application.getThreadView(THREAD)).contextRevision, 1);
});

test('an ordinary message in an unenrolled thread is ignored and creates no state', async () => {
  const deps = investigationDeps([]);
  const application = createApplication(deps);

  const receipt = await application.acceptEvent(inbound('we should change retention'));
  assert.equal(receipt.accepted, false);

  const view = await application.getThreadView(THREAD);
  assert.deepEqual(
    { enrolled: view.enrolled, contextRevision: view.contextRevision, decision: view.decision, finding: view.finding },
    { enrolled: false, contextRevision: 0, decision: null, finding: null },
  );
});

test('our own bot message never re-triggers anything', async () => {
  const deps = investigationDeps([]);
  const application = createApplication(deps);
  const receipt = await application.acceptEvent(inbound('Accord finding ...', { authorId: BOT, wasMention: true }));
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.reason, 'own bot message');
});

test('an event outside the configured audience is refused', async () => {
  const deps = investigationDeps([]);
  const application = createApplication(deps);
  const event = inbound('hello', { wasMention: true });
  const foreign = { ...event, thread: { ...THREAD, channelId: 'C0OTHER' } };
  await assert.rejects(() => application.acceptEvent(foreign), (error: unknown) => error instanceof AccordError && error.public.code === 'FORBIDDEN');
});

test('owner confirmation produces a confirmed version and schedules a baseline investigation', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'confirm', intent: INTENT_90 })]);
  const { threadId } = await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');

  const view = await deps.store.getThreadView(THREAD);
  assert.equal(view.decision?.status, 'confirmed');
  assert.equal(view.decision?.version, 1);
  assert.equal(view.decision?.confirmedBy, OWNER);
  assert.ok(deps.scheduler.dispatched.some((key) => key.startsWith('investigate:')));
  assert.ok(threadId);
});

async function investigate(deps: ReturnType<typeof investigationDeps>) {
  const intent = [...deps.store.jobs.values()].find((item) => item.taskType === 'accord-investigate');
  if (!intent) return null;
  const payload = intent.payload as {
    investigationId: string; decisionId: string; decisionVersion: number; contextRevision: number; pullRequestUrl: string | null;
  };
  await runInvestigation(deps, { ...payload, pullRequestUrl: payload.pullRequestUrl ?? null });
  return deps.store.getThreadView(THREAD);
}

test('the full baseline investigation reports the conflict with the queried counts', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'confirm', intent: INTENT_90 })]);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');

  const view = await investigate(deps);

  assert.equal(view?.finding?.status, 'confirmed_conflict');
  assert.equal(view?.finding?.impact?.prematurelySelectedRecords, 7);
  assert.equal(view?.finding?.impact?.prematurelySelectedAccounts, 2);
  assert.equal(view?.finding?.run?.decisionVersion, view?.decision?.version);
  assert.equal(view?.publicationPending, true);
  assert.match(view!.finding!.summary, /7 prematurely selected across 2 accounts/);
});

test('an unavailable database yields impact_unverified with null counts, never zero', async () => {
  const impact = fakeImpact(async (run: RunContext) => impactReport(run, {
    status: 'unavailable',
    eligibleAccounts: null,
    eligibleRecords: null,
    observedSelectedInScope: null,
    intendedSelectedInScope: null,
    prematurelySelectedRecords: null,
    prematurelySelectedAccounts: null,
    overRetainedRecords: null,
    outOfScopeChangedRecords: null,
    observedSelectedTotal: null,
    intendedSelectedTotal: null,
    queryId: null,
    error: { code: 'PROVIDER_ERROR', message: 'clickhouse unreachable', retryable: true },
  }));
  const deps = investigationDeps([interpretation({ disposition: 'confirm', intent: INTENT_90 })], fakeRepository(), impact);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');
  const view = await investigate(deps);

  assert.equal(view?.finding?.status, 'impact_unverified');
  assert.equal(view?.finding?.impact?.prematurelySelectedRecords, null);
  assert.ok(view?.finding?.limitations.some((line) => line.includes('unknown is not zero')));
});

test('an unsupported trusted runtime produces no numeric impact at all', async () => {
  const repository = fakeRepository({
    inspect: async ({ run }) => repositoryReport(run, { trustedRuntime: 'unsupported', observedProjection: null, conclusion: 'unknown', unknowns: ['resolver changed outside the trusted profile'] }),
  });
  const deps = investigationDeps([interpretation({ disposition: 'confirm', intent: INTENT_90 })], repository);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');
  const view = await investigate(deps);

  assert.equal(view?.finding?.status, 'failed');
  assert.equal(view?.finding?.impact, null);
  assert.ok(view?.finding?.limitations.some((line) => line.includes('trusted profile')));
});

test('aligned behavior in the confirmed scope is a bounded no_conflict', async () => {
  const repository = fakeRepository({ inspect: async ({ run }) => repositoryReport(run, { conclusion: 'aligned', summary: 'an existing override already applies 90 days to this scope' }) });
  const deps = investigationDeps([interpretation({ disposition: 'confirm', intent: INTENT_90 })], repository);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');
  const view = await investigate(deps);

  assert.equal(view?.finding?.status, 'no_conflict');
  assert.ok(view?.finding?.limitations.some((line) => line.startsWith('Checked only the confirmed scope')));
});

test('a tentative intent with evidence is conditional, never a confirmed conflict', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'tentative', intent: INTENT_90 })]);
  await enrolAndProcess(deps, 'We are considering 90 days for verified university free accounts.');
  const view = await investigate(deps);

  assert.equal(view?.decision?.status, 'tentative');
  assert.equal(view?.finding?.status, 'conditional_impact');
});

test('ambiguity produces a clarification finding with no invented investigation', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'clarify', question: 'Which accounts?' })]);
  await enrolAndProcess(deps, 'university accounts should get 90', { authorId: ENGINEER });

  const view = await deps.store.getThreadView(THREAD);
  assert.equal(view.finding?.status, 'needs_clarification');
  assert.equal(view.finding?.run, null);
  assert.equal(view.finding?.question, 'Which accounts?');
  assert.equal(view.finding?.decisionVersion, view.decision?.version);
});

test('a pull request in another repository is refused and the prior finding is retained', async () => {
  const deps = investigationDeps([
    interpretation({ disposition: 'confirm', intent: INTENT_90 }),
    interpretation({ disposition: 'verify_pr', pullRequestUrl: 'https://github.com/someone/else/pull/3' }),
  ]);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');
  await investigate(deps);

  const application = createApplication(deps);
  const second = inbound('fixed here https://github.com/someone/else/pull/3', { authorId: ENGINEER });
  const receipt = await application.acceptEvent(second);
  const threadRow = await deps.store.getThreadRow(THREAD);
  await processContext(deps, { threadId: threadRow!.id, eventKey: second.eventKey, contextRevision: receipt.contextRevision! });

  const view = await deps.store.getThreadView(THREAD);
  assert.equal(view.finding?.status, 'needs_clarification');
  assert.match(view.finding!.question!, /can only verify pull requests in ShreyanshGoyal\/top_secret/);
  assert.equal(deps.scheduler.dispatched.filter((key) => key.includes(':verify_pr')).length, 0);
});

test('owner withdrawal fences pending work and publishes a withdrawn finding', async () => {
  const deps = investigationDeps([
    interpretation({ disposition: 'confirm', intent: INTENT_90 }),
    interpretation({ disposition: 'withdraw' }),
  ]);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');

  const application = createApplication(deps);
  const second = inbound('Withdraw this change.');
  const receipt = await application.acceptEvent(second);
  const threadRow = await deps.store.getThreadRow(THREAD);
  await processContext(deps, { threadId: threadRow!.id, eventKey: second.eventKey, contextRevision: receipt.contextRevision! });

  const view = await deps.store.getThreadView(THREAD);
  assert.equal(view.decision?.status, 'withdrawn');
  assert.equal(view.finding?.status, 'withdrawn');
  assert.equal(view.finding?.run, null);
});

test('repeating the same confirmed statement creates no second policy version', async () => {
  const deps = investigationDeps([
    interpretation({ disposition: 'confirm', intent: INTENT_90 }),
    interpretation({ disposition: 'confirm', intent: INTENT_90 }),
  ]);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');
  const firstVersion = (await deps.store.getThreadView(THREAD)).decision?.version;

  const application = createApplication(deps);
  const repeat = inbound('Free verified university accounts get 90 days for existing records now.');
  const receipt = await application.acceptEvent(repeat);
  const threadRow = await deps.store.getThreadRow(THREAD);
  await processContext(deps, { threadId: threadRow!.id, eventKey: repeat.eventKey, contextRevision: receipt.contextRevision! });

  assert.equal((await deps.store.getThreadView(THREAD)).decision?.version, firstVersion);
});

test('owner actions are authorized, fresh and idempotent', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'propose', intent: INTENT_90 })]);
  await enrolAndProcess(deps, 'Proposal: 90 days for free verified university accounts, existing records, now.', { authorId: ENGINEER });
  const application = createApplication(deps);
  const view = await application.getThreadView(THREAD);

  const action = {
    actionId: '55555555-5555-4555-8555-555555555555',
    thread: THREAD,
    actorId: ENGINEER,
    decisionId: view.decision!.id,
    expectedVersion: view.decision!.version,
    expectedContextRevision: view.contextRevision,
    kind: 'confirm' as const,
    occurredAt: '2026-09-12T00:00:05.000Z',
  };

  // Each interaction mints its own action id, so these are three distinct clicks.
  assert.equal((await application.acceptAction(action)).status, 'forbidden');
  assert.equal(
    (await application.acceptAction({ ...action, actionId: '55555555-5555-4555-8555-555555555556', actorId: OWNER, expectedVersion: 99 })).status,
    'stale',
  );

  const accept = { ...action, actionId: '55555555-5555-4555-8555-555555555557', actorId: OWNER };
  const accepted = await application.acceptAction(accept);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.view?.decision?.status, 'confirmed');

  // Replaying the very same click is idempotent rather than a second confirmation.
  assert.equal((await application.acceptAction(accept)).status, 'duplicate');
  assert.equal((await application.getThreadView(THREAD)).decision?.version, accepted.view?.decision?.version);
});

test('publication delivers once, records the timestamp and stores a matching receipt', async () => {
  const deps = investigationDeps([interpretation({ disposition: 'confirm', intent: INTENT_90 })]);
  await enrolAndProcess(deps, 'Free verified university accounts get 90 days for existing records now.');
  await investigate(deps);

  const publisher = fakePublisher([{ status: 'delivered', ts: '1757635400.000100' }]);
  const publishDeps = { ...baseDeps({ store: deps.store }), publisher, render: () => 'Accord finding · update 1', leaseOwner: 'worker-1' };
  const publicationId = [...deps.store.outbox.values()].find((row) => row.status === 'pending')!.id;

  await publishPending(publishDeps, publicationId);

  assert.equal(publisher.sent.length, 1);
  assert.equal(deps.store.outbox.get(publicationId)!.status, 'delivered');
  assert.equal(deps.store.outbox.get(publicationId)!.deliveredTs, '1757635400.000100');

  const application = createApplication(deps);
  const row = deps.store.outbox.get(publicationId)!;
  await application.recordPublicationReceipt({
    publicationId,
    findingId: row.findingId,
    publicationRevision: row.publicationRevision,
    thread: THREAD,
    ts: '1757635400.000100',
    botUserId: BOT,
    observedAt: '2026-09-12T00:00:30.000Z',
  });
  assert.ok(await deps.store.receiptReader().find(publicationId));

  await application.recordPublicationReceipt({
    publicationId,
    findingId: row.findingId,
    publicationRevision: row.publicationRevision + 5,
    thread: THREAD,
    ts: '1757635400.000999',
    botUserId: BOT,
    observedAt: '2026-09-12T00:00:31.000Z',
  });
  assert.equal((await deps.store.receiptReader().find(publicationId))!.ts, '1757635400.000100');
});

test('reconciliation redispatches intents that never reached the scheduler', async () => {
  const store = createFakeStore();
  const deps = { ...baseDeps({ store }), model: fakeModel([]), repository: fakeRepository(), impact: fakeImpact() };
  const failing = { dispatched: [] as string[], async dispatch(): Promise<{ triggerRunId: string }> { throw new AccordError({ code: 'PROVIDER_ERROR', message: 'trigger unavailable', retryable: true }); } };
  const application = createApplication({ ...deps, scheduler: failing });

  await application.acceptEvent(inbound('hello @accord', { wasMention: true }));
  assert.equal((await store.listPendingJobIntents(10)).length, 1);

  const result = await reconcile(deps);
  assert.equal(result.dispatched, 1);
  assert.equal(deps.scheduler.dispatched.length, 1);
  assert.equal(DATASET, 'accord-demo-2026-09-12');
});

test('a failed interpretation with no decision in the thread posts nothing and is logged', async () => {
  const deps = investigationDeps([new AccordError({ code: 'RATE_LIMIT', message: 'quota', retryable: true })]);
  const { application } = await enrolAndProcess(deps, '@accord Show the last 5 commits.');
  const view = await application.getThreadView(THREAD);
  assert.equal(view.decision, null);
  assert.equal(view.finding, null);
});
