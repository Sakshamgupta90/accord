/** Core dependency and job types. Owner: Agent 1.
 * Dependencies are injected. Importing this package must never start a server or connect to Slack.
 */
import type {
  ClockPort, Id, ImpactPort, ModelPort, PrivacyPort, PublisherPort, RepositoryPort, SafeLoggerPort,
  ThreadView,
} from '@accord/contracts';
import type { JobIntent, JobTaskType, StorePort } from '@accord/store';

/** Stable Trigger.dev task IDs. Workers register exactly these. */
export const TASK_IDS = {
  processContext: 'accord-process-context',
  investigate: 'accord-investigate',
  publish: 'accord-publish',
  reconcile: 'accord-reconcile',
} as const satisfies Record<string, JobTaskType>;

/** Durable dispatch of an already persisted job intent. In-memory timers are not a queue. */
export interface JobSchedulerPort {
  dispatch(intent: JobIntent): Promise<{ triggerRunId: string }>;
}

export interface BaseDependencies {
  store: StorePort;
  privacy: PrivacyPort;
  clock: ClockPort;
  logger: SafeLoggerPort;
}

/** Ingress composition: accepting events and owner actions needs no model or provider access. */
export interface IngressDependencies extends BaseDependencies {
  scheduler: JobSchedulerPort;
  model: ModelPort; // Added for Triage
  /** The one configured decision owner. Never inferred from message text. */
  ownerId: string;
  /** Our own bot identity, so this app's findings can never re-trigger an investigation. */
  botUserId: string | null;
  repositoryTarget: { owner: string; name: string; ref: string; pathPrefix: string };
  dataset: { version: string; asOf: string };
}

/** Investigation composition additionally supplies the model and the two specialist ports. */
export interface InvestigationDependencies extends IngressDependencies {
  model: ModelPort;
  repository: RepositoryPort;
  impact: ImpactPort;
}

/** Publishing composition needs the transport publisher instead of the model.
 * `render` is Agent 2's deterministic renderer, injected so core never imports a transport package. */
export interface PublishDependencies extends BaseDependencies {
  publisher: PublisherPort;
  render: (view: ThreadView) => string;
  leaseOwner: string;
}

export type CoreDependencies = InvestigationDependencies & PublishDependencies;

export interface ProcessContextPayload {
  threadId: Id;
  eventKey: string;
  contextRevision: number;
}

export interface InvestigationPayload {
  investigationId: Id;
  decisionId: Id;
  decisionVersion: number;
  contextRevision: number;
  /** Set only for verify_pr runs, and always re-checked against the allowed repository. */
  pullRequestUrl: string | null;
}

export interface Budgets {
  interpretationAttempts: number;
  investigationWallMs: number;
  publishLeaseMs: number;
}

export const DEFAULT_BUDGETS: Budgets = {
  interpretationAttempts: 2,
  investigationWallMs: 180_000,
  publishLeaseMs: 60_000,
};
