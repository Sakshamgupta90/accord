/** The ApplicationPort: the only entry Agent 2's bridge uses.
 * Ingress does no network or model work before durable acceptance.
 */
import {
  InboundEventSchema, OwnerActionSchema, PublicationReceiptSchema, policyIntentHash, validate,
} from '@accord/contracts';
import type {
  ActionReceipt, ApplicationPort, Decision, DecisionStatus, InboundEvent, IngestReceipt, OwnerAction,
  PublicationReceipt, SlackMessage, ThreadRef, ThreadView,
} from '@accord/contracts';
import { isMaterialChange } from './authorization.js';
import { composeFinding } from './finding.js';
import { dispatchIntent, investigationJobKey } from './coordinator.js';
import { TASK_IDS } from './types.js';
import type { IngressDependencies } from './types.js';

const ACTION_STATUS: Record<OwnerAction['kind'], DecisionStatus> = {
  confirm: 'confirmed',
  tentative: 'tentative',
  withdraw: 'withdrawn',
};

function sanitizeMessage(deps: IngressDependencies, message: SlackMessage): SlackMessage {
  return { ...message, text: deps.privacy.sanitize(message.text, 'slack') };
}

export function createApplication(deps: IngressDependencies): ApplicationPort {
  const repository = { owner: deps.repositoryTarget.owner, name: deps.repositoryTarget.name };

  async function acceptEvent(raw: InboundEvent): Promise<IngestReceipt> {
    const event = validate(InboundEventSchema, raw, 'InboundEvent');

    // Audience and allowed resources come from server configuration; enrollment grants nothing else.
    deps.privacy.assertAudience({ thread: event.thread, repository, datasetVersion: deps.dataset.version });

    // Our own findings must never re-trigger an investigation.
    if (deps.botUserId && event.message.authorId === deps.botUserId) {
      return { accepted: false, duplicate: false, contextRevision: null, reason: 'own bot message' };
    }

    // Sanitization is idempotent, and happens before storage or any model use.
    const sanitized: InboundEvent = {
      ...event,
      message: sanitizeMessage(deps, event.message),
      snapshot: event.snapshot.map((message) => sanitizeMessage(deps, message)),
    };

    const accepted = await deps.store.acceptEvent(sanitized);
    if (!accepted.accepted) {
      return { accepted: false, duplicate: false, contextRevision: accepted.contextRevision, reason: accepted.reason };
    }
    if (accepted.duplicate) {
      return { accepted: true, duplicate: true, contextRevision: accepted.contextRevision, reason: 'duplicate event' };
    }

    // Committed first, dispatched second. A crash here leaves a pending intent for reconciliation.
    await dispatchIntent(deps, accepted.jobIntent);

    return { accepted: true, duplicate: false, contextRevision: accepted.contextRevision, reason: null };
  }

  async function acceptAction(rawAction: OwnerAction): Promise<ActionReceipt> {
    const action = validate(OwnerActionSchema, rawAction, 'OwnerAction');
    deps.privacy.assertAudience({ thread: action.thread, repository, datasetVersion: deps.dataset.version });

    const view = await deps.store.getThreadView(action.thread);
    if (!view.enrolled || !view.decision) {
      return { status: 'not_found', view: null };
    }

    // An exact replay of a click that already applied is idempotent, not a second confirmation.
    const prior = await deps.store.readOwnerAction(action.actionId);
    if (prior?.outcome === 'accepted') return { status: 'duplicate', view };

    // The actor is the transport-authenticated user, never a value carried by the button.
    if (action.actorId !== deps.ownerId) {
      await deps.store.recordOwnerAction(action, 'forbidden');
      return { status: 'forbidden', view };
    }

    // A control from an older card is visibly stale, with the current interpretation returned.
    if (action.expectedVersion !== view.decision.version || action.expectedContextRevision !== view.contextRevision) {
      await deps.store.recordOwnerAction(action, 'stale');
      return { status: 'stale', view };
    }

    await deps.store.recordOwnerAction(action, 'accepted');

    const status = ACTION_STATUS[action.kind];
    const intent = status === 'withdrawn' ? view.decision.intent : view.decision.intent;
    if (!isMaterialChange(view.decision, status, intent)) {
      return { status: 'accepted', view };
    }

    const threadRow = await deps.store.getThreadRowById(await resolveThreadId(action.thread, view));
    if (!threadRow) return { status: 'not_found', view: null };

    const now = deps.clock.now();
    const appended = await deps.store.appendDecisionVersion(threadRow.id, {
      decisionId: view.decision.id,
      status,
      intent,
      intentHash: intent ? policyIntentHash(intent) : null,
      ownerId: deps.ownerId,
      sourceMessageIds: view.decision.sourceMessageIds,
      contextRevision: view.contextRevision,
      confirmedBy: status === 'confirmed' ? action.actorId : null,
      confirmedAt: status === 'confirmed' ? now : null,
    });
    if (!appended) {
      return { status: 'stale', view: await deps.store.getThreadView(action.thread) };
    }

    if (status === 'withdrawn') {
      await deps.store.supersedeStaleInvestigations(threadRow.id, view.contextRevision + 1);
      const outcome = await deps.store.commitFinding({
        threadId: threadRow.id,
        finding: composeFinding({
          decision: appended,
          contextRevision: view.contextRevision,
          run: null,
          repository: null,
          impact: null,
          verification: null,
          question: null,
          reasons: ['Owner withdrew this change; pending work is fenced.'],
        }, now),
        now,
      });
      await dispatchIntent(deps, outcome.jobIntent);
    } else if (appended.intent) {
      await scheduleFromAction(appended, threadRow.id, view.contextRevision);
    }

    return { status: 'accepted', view: await deps.store.getThreadView(action.thread) };
  }

  async function scheduleFromAction(decision: Decision, threadId: string, contextRevision: number): Promise<void> {
    const run = {
      investigationId: crypto.randomUUID(),
      decisionId: decision.id,
      decisionVersion: decision.version,
      contextRevision,
      datasetVersion: deps.dataset.version,
      asOf: deps.dataset.asOf,
      mode: 'baseline' as const,
    };
    const investigation = await deps.store.createInvestigation(threadId, run);
    const { intent } = await deps.store.enqueueJobIntent({
      logicalKey: investigationJobKey(investigation.run),
      taskType: TASK_IDS.investigate,
      payload: {
        investigationId: investigation.id,
        decisionId: decision.id,
        decisionVersion: decision.version,
        contextRevision,
        pullRequestUrl: null,
      },
    });
    await dispatchIntent(deps, intent);
  }

  async function resolveThreadId(thread: ThreadRef, _view: ThreadView): Promise<string> {
    const row = await deps.store.getThreadRow(thread);
    return row?.id ?? '';
  }

  return {
    acceptEvent,
    acceptAction,
    getThreadView: (thread: ThreadRef) => deps.store.getThreadView(thread),
    async recordPublicationReceipt(raw: PublicationReceipt): Promise<void> {
      const receipt = validate(PublicationReceiptSchema, raw, 'PublicationReceipt');
      const outcome = await deps.store.recordPublicationReceipt(receipt);
      if (!outcome.recorded) {
        deps.logger.info('publication_receipt_ignored', { publicationId: receipt.publicationId, reason: outcome.reason });
      }
    },
    async triage(input: { message: string }): Promise<import('@accord/contracts').TriageResult> {
      if (!deps.model.triage) {
        throw new Error('Model port does not support triage');
      }
      return deps.model.triage(input);
    }
  };
}
