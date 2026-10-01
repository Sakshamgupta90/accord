/** @accord/core — decision state, coordinator and durable workflow. Owner: Agent 1.
 * Importing this module has no side effects: no server, no Slack connection, no credential read.
 * Agent 2 starts the application with `await createConfiguredApplication()`.
 */
import { createPrivacyPort, createSafeLogger } from '@accord/privacy';
import { DEFAULT_STORE_CONFIG, createStore } from '@accord/store';
import type { ApplicationPort } from '@accord/contracts';
import { createApplication } from './application.js';
import { botUserIdFromEnvironment, datasetAsOf, loadAccordConfig, loadTriageConfig, systemClock } from './config.js';
import { createOpenAITriage } from './model/triage.js';
import { createTriggerScheduler } from './scheduler.js';

export * from './types.js';
export * from './config.js';
export { createApplication } from './application.js';
export { authorize, confirmationFields, isAllowedPullRequestUrl, isMaterialChange } from './authorization.js';
export type { AuthorizationInput, Outcome } from './authorization.js';
export { INTERPRETER_INSTRUCTIONS, interpret, normalizeInterpretation, validateInterpretation } from './interpretation.js';
export { collectEvidence, composeFinding, resolveStatus } from './finding.js';
export type { ComposeInput, FindingDraft } from './finding.js';
export {
  dispatchIntent, investigationJobKey, processContext, publishPending, reconcile, runInvestigation,
} from './coordinator.js';
export { createTriggerScheduler } from './scheduler.js';
export { createOpenAIModel } from './model/openai.js';
export type { ModelConfig, ModelDependencies } from './model/openai.js';
export { INTERPRETATION_JSON_SCHEMA } from './model/schema.js';
export { TRIAGE_INSTRUCTIONS, TRIAGE_JSON_SCHEMA, createOpenAITriage, validateTriage } from './model/triage.js';
export type { TriageModelConfig } from './model/triage.js';
export { mayProposeRetentionPolicy } from './triage.js';
export { parseContextPayload, runContextJob } from './jobs/context.js';
export { parseInvestigationPayload, runInvestigationJob } from './jobs/investigation.js';
export { parsePublishPayload, runPublishJob } from './jobs/publish.js';
export { RECONCILE_INTERVAL_SECONDS, runReconcileJob } from './jobs/reconcile.js';

/**
 * Ingress composition from the environment: store, privacy, clock, logger and the durable scheduler.
 * Accepting events and owner actions needs no model and no provider access, so this stays cheap and
 * fails clearly when a required configuration name is missing. The optional triage classifier is
 * the only provider client here, and it is used only for messages in unenrolled threads.
 */
export async function createConfiguredApplication(): Promise<ApplicationPort> {
  const config = loadAccordConfig();
  const clock = systemClock();
  const store = createStore({ databaseUrl: config.postgres.databaseUrl, ...DEFAULT_STORE_CONFIG });
  const privacy = createPrivacyPort({
    teamId: config.slack.teamId,
    channelId: config.slack.channelId,
    repository: { owner: config.github.owner, name: config.github.name },
    datasetVersion: config.dataset.version,
    knownSecretValues: [config.slack.botToken, config.slack.appToken, config.model.apiKey, config.github.token, config.clickhouse.password],
  });

  const logger = createSafeLogger({ component: 'ingress' });
  const triage = loadTriageConfig();

  return createApplication({
    store,
    privacy,
    clock,
    logger,
    scheduler: createTriggerScheduler(),
    ...(triage ? { triage: { port: createOpenAITriage(triage.model, { privacy, clock, logger }), minConfidence: triage.minConfidence } } : {}),
    ownerId: config.slack.ownerUserId,
    botUserId: botUserIdFromEnvironment(),
    repositoryTarget: {
      owner: config.github.owner,
      name: config.github.name,
      ref: config.github.ref,
      pathPrefix: config.github.pathPrefix,
    },
    dataset: { version: config.dataset.version, asOf: datasetAsOf(config, clock) },
  });
}
