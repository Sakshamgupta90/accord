/** @accord/store — PostgreSQL durable authority for Accord. Owner: Agent 1.
 * Constructing the store opens a connection pool; importing this module does not.
 */
import { createDatabase } from './client.js';
import { applyMigrations } from './migrations.js';
import * as decisions from './decisions.js';
import * as events from './events.js';
import * as investigations from './investigations.js';
import * as jobs from './jobs.js';
import * as outbox from './outbox.js';
import { DEFAULT_STORE_CONFIG } from './types.js';
import type { StoreConfig, StorePort } from './types.js';

export * from './types.js';
export { contextJobKey } from './events.js';
export { publishJobKey } from './outbox.js';
export { newInvestigationId } from './investigations.js';
export { databaseError } from './client.js';
export type { Database, Queryable } from './client.js';
export {
  createEmbeddingPort, embeddingConfigFromEnvironment, SlackThreadKnowledgeService,
  SLACK_THREAD_EMBEDDING_DIMENSIONS,
} from './slack-thread-knowledge.js';
export type {
  EmbeddingClientConfig, EmbeddingPort, EmbeddingProvider, SlackThreadKnowledgeConfig,
  SlackThreadKnowledgeGraph, SlackThreadKnowledgeHit, SlackThreadKnowledgeScope,
} from './slack-thread-knowledge.js';

export function createStore(config: StoreConfig): StorePort {
  const db = createDatabase(config);

  return {
    migrate: () => applyMigrations(db),
    close: () => db.end(),

    getThreadView: (thread) => events.getThreadView(db, thread),
    getThreadRow: (thread) => events.getThreadRow(db, thread),
    getThreadRowById: (threadId) => events.getThreadRowById(db, threadId),

    acceptEvent: (event, options) => events.acceptEvent(db, event, options),
    markEventProcessed: (eventKey) => events.markEventProcessed(db, eventKey),
    readEvent: (eventKey) => events.readEvent(db, eventKey),

    getActiveDecision: (threadId) => decisions.getActiveDecision(db, threadId),
    getDecisionVersion: (decisionId, version) => decisions.getDecisionVersion(db, decisionId, version),
    appendDecisionVersion: (threadId, draft) => decisions.appendDecisionVersion(db, threadId, draft),
    recordOwnerAction: (action, outcome) => decisions.recordOwnerAction(db, action, outcome),
    readOwnerAction: (actionId) => decisions.readOwnerAction(db, actionId),

    createInvestigation: (threadId, run) => investigations.createInvestigation(db, threadId, run),
    getInvestigation: (investigationId) => investigations.getInvestigation(db, investigationId),
    updateInvestigationStatus: (investigationId, status, error) => investigations.updateInvestigationStatus(db, investigationId, status, error ?? null),
    supersedeStaleInvestigations: (threadId, revision) => investigations.supersedeStaleInvestigations(db, threadId, revision),
    saveInvestigationTarget: (input) => investigations.saveInvestigationTarget(db, input),
    saveStepResult: (input) => investigations.saveStepResult(db, input),
    readStepResult: (input) => investigations.readStepResult(db, input),
    saveBaselineReport: (input) => investigations.saveBaselineReport(db, input),
    readBaselineReport: (input) => investigations.readBaselineReport(db, input),

    commitFinding: (input) => outbox.commitFinding(db, input),
    readFinding: (findingId) => outbox.readFinding(db, findingId),

    claimDueOutboxRow: (input) => outbox.claimDueOutboxRow(db, input),
    claimOutboxRow: (input) => outbox.claimOutboxRow(db, input),
    enqueueCorrection: (threadId) => outbox.enqueueCorrection(db, threadId),
    readOutboxRow: (publicationId) => outbox.readOutboxRow(db, publicationId),
    completeDelivery: (input) => outbox.completeDelivery(db, input),
    setThreadFindingMessageTs: (threadId, ts) => outbox.setThreadFindingMessageTs(db, threadId, ts),

    recordPublicationReceipt: (receipt) => outbox.recordPublicationReceipt(db, receipt),
    receiptReader: () => outbox.createReceiptReader(db),

    enqueueJobIntent: (input) => jobs.enqueueJobIntent(db, input),
    markJobDispatched: (intentId, runId) => jobs.markJobDispatched(db, intentId, runId),
    markJobCompleted: (logicalKey) => jobs.markJobCompleted(db, logicalKey),
    listPendingJobIntents: (limit) => jobs.listPendingJobIntents(db, limit),
    listDueOutboxIds: (limit) => outbox.listDueOutboxIds(db, limit),
  };
}

/** Migration entry used by `npm run db:migrate`. */
export async function runMigrations(config: StoreConfig): Promise<{ appliedVersion: number }> {
  const store = createStore(config);
  try {
    return await store.migrate();
  } finally {
    await store.close();
  }
}

export function storeConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): StoreConfig {
  const databaseUrl = environment['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return { databaseUrl, ...DEFAULT_STORE_CONFIG };
}
