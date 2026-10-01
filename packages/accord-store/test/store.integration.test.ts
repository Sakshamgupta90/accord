/** PostgreSQL integration tests. Run with: npm run test:pg --workspace @accord/store
 * These assert the behavior of the real constraints, transactions and row locks.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { CONTRACT_VERSION, policyIntentHash } from '@accord/contracts';
import type { InboundEvent, PolicyIntent, RepositoryReport, RunContext, ThreadRef } from '@accord/contracts';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './support.js';
import type { TestDatabase } from './support.js';

const THREAD: ThreadRef = { teamId: 'T0TEAM', channelId: 'C0CHANNEL', rootTs: '1757635200.000100' };
const OWNER = 'U0OWNER';
const AS_OF = '2026-09-12T00:00:00.000Z';
const DATASET = 'accord-demo-2026-09-12';

const INTENT: PolicyIntent = {
  scope: { plans: ['free'], organizationTypes: ['university'], universityVerified: [true] },
  retentionDays: 90,
  appliesTo: 'currently_stored_records',
  effective: 'immediate',
};

let database: TestDatabase;

function event(key: string, options: { wasMention?: boolean; ts?: string } = {}): InboundEvent {
  const ts = options.ts ?? '1757635200.000200';
  return {
    contractVersion: CONTRACT_VERSION,
    eventKey: key,
    kind: 'message',
    thread: THREAD,
    message: { id: `m:${key}`, ts, authorId: OWNER, text: 'free verified university accounts get 90 days', permalink: null, editedTs: null },
    snapshot: [{ id: `m:${key}`, ts, authorId: OWNER, text: 'free verified university accounts get 90 days', permalink: null, editedTs: null }],
    snapshotComplete: true,
    receivedAt: AS_OF,
    wasMention: options.wasMention ?? true,
  };
}

async function seedConfirmedDecision(): Promise<{ threadId: string; decisionId: string; version: number; contextRevision: number }> {
  const accepted = await database.store.acceptEvent(event(`ev-${randomUUID()}`));
  const threadId = accepted.threadId!;
  const decision = await database.store.appendDecisionVersion(threadId, {
    decisionId: null,
    status: 'confirmed',
    intent: INTENT,
    intentHash: policyIntentHash(INTENT),
    ownerId: OWNER,
    sourceMessageIds: [],
    confirmedBy: OWNER,
    confirmedAt: AS_OF,
    contextRevision: accepted.contextRevision!,
  });
  return { threadId, decisionId: decision!.id, version: decision!.version, contextRevision: accepted.contextRevision! };
}

function run(decisionId: string, version: number, contextRevision: number, mode: RunContext['mode'] = 'baseline'): RunContext {
  return { investigationId: randomUUID(), decisionId, decisionVersion: version, contextRevision, datasetVersion: DATASET, asOf: AS_OF, mode };
}

function report(context: RunContext, sha: string): RepositoryReport {
  return {
    run: context,
    target: { repository: { owner: 'ShreyanshGoyal', name: 'top_secret' }, sha, baseSha: null, pullRequestNumber: null, pullRequestUrl: null, pathPrefix: 'fixtures/retention-app/' },
    conclusion: 'conflict',
    observedProjection: { schemaVersion: 1, defaultDays: 30, rules: [] },
    sourceProjection: { schemaVersion: 1, defaultDays: 30, rules: [] },
    generatorConsistency: 'consistent',
    trustedRuntime: 'matched',
    sourcePaths: [],
    generatedPaths: [],
    trace: [],
    evidence: [],
    unknowns: [],
    summary: `report at ${sha}`,
  };
}

before(async () => { database = await createTestDatabase(); });
after(async () => { await database?.close(); });
beforeEach(async () => { await database.reset(); });

test('migrations are idempotent and report an explicit schema version', async () => {
  const first = await database.store.migrate();
  const second = await database.store.migrate();
  assert.equal(first.appliedVersion, second.appliedVersion);
  assert.ok(first.appliedVersion >= 1);
});

test('reading an unknown thread creates no row', async () => {
  const view = await database.store.getThreadView({ ...THREAD, rootTs: '1757635999.000100' });
  assert.deepEqual(
    { enrolled: view.enrolled, contextRevision: view.contextRevision, decision: view.decision },
    { enrolled: false, contextRevision: 0, decision: null },
  );
  assert.equal(await database.store.getThreadRow({ ...THREAD, rootTs: '1757635999.000100' }), null);
});

test('concurrent duplicate events accept exactly once and bump the revision once', async () => {
  const key = `ev-${randomUUID()}`;
  const [first, second] = await Promise.all([
    database.store.acceptEvent(event(key)),
    database.store.acceptEvent(event(key)),
  ]);

  const duplicates = [first, second].filter((result) => result.duplicate);
  assert.equal(duplicates.length, 1, 'exactly one of the two concurrent attempts is a duplicate');
  assert.equal((await database.store.getThreadView(THREAD)).contextRevision, 1);
  const intents = await database.store.listPendingJobIntents(10);
  assert.equal(intents.filter((intent) => intent.taskType === 'accord-process-context').length, 1);
});

test('an unenrolled thread ignores an ordinary message without creating state', async () => {
  const result = await database.store.acceptEvent(event(`ev-${randomUUID()}`, { wasMention: false }));
  assert.equal(result.accepted, false);
  assert.equal(await database.store.getThreadRow(THREAD), null);
});

test('a triage enrollment enrolls an unenrolled thread once and keeps the event a non-mention', async () => {
  const key = `ev-${randomUUID()}`;
  const first = await database.store.acceptEvent(event(key, { wasMention: false }), { enroll: true });
  assert.equal(first.accepted, true);
  assert.equal(first.enrolled, true);
  assert.equal((await database.store.getThreadView(THREAD)).enrolled, true);
  assert.equal((await database.store.readEvent(key))?.wasMention, false);
  const second = await database.store.acceptEvent(event(`ev-${randomUUID()}`, { wasMention: false, ts: '1757635200.000500' }), { enroll: true });
  assert.equal(second.accepted, true);
  assert.equal(second.enrolled, false);
});

test('a crash between commit and dispatch leaves a pending intent for reconciliation', async () => {
  const accepted = await database.store.acceptEvent(event(`ev-${randomUUID()}`));
  // Simulates the process dying before markJobDispatched: the intent is already durable.
  const pending = await database.store.listPendingJobIntents(10);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.logicalKey, `context:${accepted.threadId}:1`);

  await database.store.markJobDispatched(pending[0]!.id, 'run_abc');
  assert.equal((await database.store.listPendingJobIntents(10)).length, 0);
});

test('job intent logical keys are unique under concurrency', async () => {
  const input = { logicalKey: 'investigate:same-key', taskType: 'accord-investigate' as const, payload: { a: 1 } };
  const results = await Promise.all([
    database.store.enqueueJobIntent(input),
    database.store.enqueueJobIntent(input),
    database.store.enqueueJobIntent(input),
  ]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.intent.id)).size, 1);
});

test('simultaneous decision appends serialize into distinct versions', async () => {
  const seeded = await seedConfirmedDecision();
  const draft = {
    decisionId: seeded.decisionId,
    status: 'tentative' as const,
    intent: INTENT,
    intentHash: policyIntentHash(INTENT),
    ownerId: OWNER,
    sourceMessageIds: [],
    confirmedBy: null,
    confirmedAt: null,
    contextRevision: seeded.contextRevision,
  };
  const [a, b] = await Promise.all([
    database.store.appendDecisionVersion(seeded.threadId, draft),
    database.store.appendDecisionVersion(seeded.threadId, draft),
  ]);
  const versions = [a?.version, b?.version].filter((version): version is number => typeof version === 'number');
  assert.equal(new Set(versions).size, versions.length, 'no two appends may share a version number');
});

test('an append against an older context revision is refused', async () => {
  const seeded = await seedConfirmedDecision();
  await database.store.acceptEvent(event(`ev-${randomUUID()}`, { ts: '1757635200.000300' }));

  const stale = await database.store.appendDecisionVersion(seeded.threadId, {
    decisionId: seeded.decisionId,
    status: 'withdrawn',
    intent: null,
    intentHash: null,
    ownerId: OWNER,
    sourceMessageIds: [],
    confirmedBy: null,
    confirmedAt: null,
    contextRevision: seeded.contextRevision,
  });
  assert.equal(stale, null);
});

test('a finding whose keys no longer match the thread is not committed', async () => {
  const seeded = await seedConfirmedDecision();
  await database.store.acceptEvent(event(`ev-${randomUUID()}`, { ts: '1757635200.000400' }));

  const outcome = await database.store.commitFinding({
    threadId: seeded.threadId,
    now: AS_OF,
    finding: {
      decisionId: seeded.decisionId,
      decisionVersion: seeded.version,
      contextRevision: seeded.contextRevision,
      run: null,
      status: 'confirmed_conflict',
      title: 'stale result',
      summary: 'produced before the newer message',
      question: null,
      repository: null,
      impact: null,
      verification: null,
      evidence: [],
      limitations: [],
    },
  });
  assert.equal(outcome.committed, false);
  assert.equal(outcome.reason, 'superseded');
});

test('two publication workers cannot both claim the same due row', async () => {
  const seeded = await seedConfirmedDecision();
  const outcome = await database.store.commitFinding({
    threadId: seeded.threadId,
    now: AS_OF,
    finding: {
      decisionId: seeded.decisionId,
      decisionVersion: seeded.version,
      contextRevision: seeded.contextRevision,
      run: null,
      status: 'needs_clarification',
      title: 'question',
      summary: 'waiting',
      question: 'which accounts?',
      repository: null,
      impact: null,
      verification: null,
      evidence: [],
      limitations: [],
    },
  });
  assert.equal(outcome.committed, true);

  const [first, second] = await Promise.all([
    database.store.claimDueOutboxRow({ leaseOwner: 'worker-1', leaseMs: 60_000 }),
    database.store.claimDueOutboxRow({ leaseOwner: 'worker-2', leaseMs: 60_000 }),
  ]);
  const claimed = [first, second].filter((row) => row !== null);
  assert.equal(claimed.length, 1, 'only one worker may hold the row');
});

test('an expired lease is reclaimable, so a crashed worker strands nothing', async () => {
  const seeded = await seedConfirmedDecision();
  const outcome = await database.store.commitFinding({
    threadId: seeded.threadId,
    now: AS_OF,
    finding: {
      decisionId: seeded.decisionId,
      decisionVersion: seeded.version,
      contextRevision: seeded.contextRevision,
      run: null,
      status: 'needs_clarification',
      title: 'question',
      summary: 'waiting',
      question: 'which accounts?',
      repository: null,
      impact: null,
      verification: null,
      evidence: [],
      limitations: [],
    },
  });
  const publicationId = outcome.publication!.id;

  const held = await database.store.claimOutboxRow({ publicationId, leaseOwner: 'worker-1', leaseMs: 60_000 });
  assert.ok(held);
  assert.equal(await database.store.claimOutboxRow({ publicationId, leaseOwner: 'worker-2', leaseMs: 60_000 }), null);

  // The first worker dies; its lease lapses.
  await database.store.claimOutboxRow({ publicationId, leaseOwner: 'worker-1', leaseMs: -1_000 });
  const reclaimed = await database.store.claimOutboxRow({ publicationId, leaseOwner: 'worker-3', leaseMs: 60_000 });
  assert.ok(reclaimed, 'an expired lease must be reclaimable');
});

test('a baseline report is frozen and a candidate report cannot overwrite it', async () => {
  const seeded = await seedConfirmedDecision();
  const baselineRun = run(seeded.decisionId, seeded.version, seeded.contextRevision);
  const candidateRun = run(seeded.decisionId, seeded.version, seeded.contextRevision + 5, 'verify_pr');

  await database.store.saveBaselineReport({ decisionId: seeded.decisionId, decisionVersion: seeded.version, report: report(baselineRun, 'a'.repeat(40)) });
  await database.store.saveBaselineReport({ decisionId: seeded.decisionId, decisionVersion: seeded.version, report: report(candidateRun, 'b'.repeat(40)) });

  const stored = await database.store.readBaselineReport({ decisionId: seeded.decisionId, decisionVersion: seeded.version });
  assert.equal(stored?.target.sha, 'a'.repeat(40), 'the candidate must never overwrite the frozen baseline');
});

test('step checkpoints are only reused when the input hash matches exactly', async () => {
  const seeded = await seedConfirmedDecision();
  const context = run(seeded.decisionId, seeded.version, seeded.contextRevision);
  const investigation = await database.store.createInvestigation(seeded.threadId, context);

  await database.store.saveStepResult({ investigationId: investigation.id, stepKey: 'impact.analyze', inputHash: 'hash-a', result: { records: 7 } });

  assert.deepEqual(await database.store.readStepResult({ investigationId: investigation.id, stepKey: 'impact.analyze', inputHash: 'hash-a' }), { records: 7 });
  assert.equal(await database.store.readStepResult({ investigationId: investigation.id, stepKey: 'impact.analyze', inputHash: 'hash-b' }), null);
});

test('a retry of the same logical run reuses its row instead of starting a second run', async () => {
  const seeded = await seedConfirmedDecision();
  const context = run(seeded.decisionId, seeded.version, seeded.contextRevision);
  const first = await database.store.createInvestigation(seeded.threadId, context);
  const second = await database.store.createInvestigation(seeded.threadId, { ...context, investigationId: randomUUID() });

  assert.equal(second.id, first.id);
  assert.equal(second.attempt, first.attempt + 1);
});

test('a publication receipt is ignored unless it matches a real publication and revision', async () => {
  const seeded = await seedConfirmedDecision();
  const outcome = await database.store.commitFinding({
    threadId: seeded.threadId,
    now: AS_OF,
    finding: {
      decisionId: seeded.decisionId,
      decisionVersion: seeded.version,
      contextRevision: seeded.contextRevision,
      run: null,
      status: 'needs_clarification',
      title: 'question',
      summary: 'waiting',
      question: 'which accounts?',
      repository: null,
      impact: null,
      verification: null,
      evidence: [],
      limitations: [],
    },
  });
  const publication = outcome.publication!;

  const mismatched = await database.store.recordPublicationReceipt({
    publicationId: publication.id,
    findingId: publication.findingId,
    publicationRevision: publication.revision + 1,
    thread: THREAD,
    ts: '1757635400.000100',
    botUserId: 'U0BOT',
    observedAt: AS_OF,
  });
  assert.equal(mismatched.recorded, false);

  const matched = await database.store.recordPublicationReceipt({
    publicationId: publication.id,
    findingId: publication.findingId,
    publicationRevision: publication.revision,
    thread: THREAD,
    ts: '1757635400.000100',
    botUserId: 'U0BOT',
    observedAt: AS_OF,
  });
  assert.equal(matched.recorded, true);
  assert.equal((await database.store.receiptReader().find(publication.id))?.ts, '1757635400.000100');
});
