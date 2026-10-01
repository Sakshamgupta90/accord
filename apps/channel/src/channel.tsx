/** @accord/channel — CopilotKit Channels Slack channel setup.
 * Handles direct Slack Socket Mode events, enrollment, inbound normalization, and native interaction routing.
 */
import { createChannel } from '@copilotkit/channels';
import { slack, defaultSlackTools, defaultSlackContext } from '@copilotkit/channels/slack';
import type { ApplicationPort, OwnerAction } from '@accord/contracts';
import { LIMITS } from '@accord/contracts';
import { mayProposeRetentionPolicy } from '@accord/core';
import { randomUUID } from 'node:crypto';
import { makeChannelAgent } from './agent.js';
import { ConfirmationCard, EnrollmentCard, KnowledgeUploadCard, StatusCard, TriageEnrollmentCard } from './components.js';
import type { ChannelAppConfig } from './config.js';
import { isAllowedAudience, normalizeInboundEvent, normalizeSlackMessage } from './normalize.js';
import { createCodeTools, createRepositorySnapshot, redact } from './code-tools.js';
import { createGitHubTools } from './github-tools.js';
import { attachedDocuments, downloadSlackDocuments, KnowledgeInputError, KnowledgeServices, requestsKnowledgeIngestion } from './knowledge-base.js';
import { createKnowledgeTools } from './knowledge-tools.js';
import { createSuggestTools } from './suggest-tools.js';
import { createChannelTools } from './tools.js';

const SLACK_TS = /^\d+\.\d+$/;

const RETENTION_TERMS = /\b(retain|retained|retaining|retention|purge|purging|deletion|delete|deleting|clean ?up|keep(?:ing)?\b.{0,40}\b(?:data|records?)|\d+\s*days?)\b/i;
const LOOKUP_QUESTION = /^(?:@\S+\s+|<@[^>]+>\s*)*(?:where|what|what's|how|which|who|why|when|show|list|explain|find|summari[sz]e|describe|can you (?:show|explain|find|tell))\b/i;

type AttachmentMessage = { contentParts?: readonly unknown[] };

/**
 * Whether a mention reads like a retention decision or proposal, so the enrollment card is shown
 * only then. Presentation only: every mention is still enrolled and interpreted by the model, so
 * a decision this heuristic misses is still investigated and its finding still posted.
 */
export function looksLikeRetentionDecision(text: string): boolean {
  const trimmed = text.trim();
  return RETENTION_TERMS.test(trimmed) && !LOOKUP_QUESTION.test(trimmed);
}

/**
 * Real Slack identifiers for a Channels turn. The Slack adapter keys a conversation as
 * `<channel>::<threadTs>`, reports the Slack user as `actor.id` (`user.id` is the canonical
 * application id, not the Slack id) and the message ts as `operation.logicalMessageId`.
 * Returns null rather than inventing a timestamp: a fabricated ts makes Slack post the
 * finding at channel level instead of in the thread.
 */
function slackIdentifiers(
  thread: { conversationKey: string },
  message: unknown,
): { channelId: string; authorId: string; messageTs: string; rootTs: string } | null {
  const msg = message as {
    actor?: { id?: string } | null;
    operation?: { logicalMessageId?: string } | null;
    ref?: { id?: string } | null;
  };
  const [channelId = '', scope = ''] = thread.conversationKey.split('::');
  const messageTs = [msg.operation?.logicalMessageId, msg.ref?.id].find((v) => typeof v === 'string' && SLACK_TS.test(v));
  const authorId = msg.actor?.id;
  if (!messageTs || !authorId) {
    return null;
  }
  return { channelId, authorId, messageTs, rootTs: SLACK_TS.test(scope) ? scope : messageTs };
}

type HistoryEntry = { ts: string; authorId: string; text: string };

/**
 * Earlier human messages of a thread Accord has not joined, bounded to what one snapshot can hold,
 * so triage and, after enrollment, interpretation read the decision in context. Capability-gated:
 * an adapter that cannot read history yields only the inbound message.
 */
export async function threadHistory(
  thread: { getMessages: () => Promise<{ ts?: string; text?: string; isBot?: boolean; user?: { id?: string } }[]> },
  inbound: HistoryEntry,
): Promise<{ history: HistoryEntry[]; complete: boolean }> {
  let earlier: HistoryEntry[] = [];
  try {
    earlier = (await thread.getMessages())
      .filter((m) => !m.isBot && typeof m.ts === 'string' && SLACK_TS.test(m.ts) && m.ts < inbound.ts && typeof m.user?.id === 'string')
      .map((m) => ({ ts: m.ts!, authorId: m.user!.id!, text: (m.text ?? '').slice(0, LIMITS.messageText) }));
  } catch {
    earlier = [];
  }
  const history = [...earlier, inbound].slice(-LIMITS.snapshotMessages);
  let total = history.reduce((sum, m) => sum + m.text.length, 0);
  while (history.length > 1 && total > LIMITS.snapshotCharacters) total -= history.shift()!.text.length;
  return { history, complete: history.length === earlier.length + 1 };
}

async function ingestRequestedKnowledge(
  services: KnowledgeServices,
  config: ChannelAppConfig,
  thread: { post: (ui: ReturnType<typeof KnowledgeUploadCard>) => Promise<unknown> },
  message: AttachmentMessage,
  input: { text: string; authorId: string; messageTs: string; rootTs: string },
): Promise<boolean> {
  if (!requestsKnowledgeIngestion(input.text)) return false;
  if (input.authorId !== config.ownerUserId) {
    await thread.post(<KnowledgeUploadCard accepted={[]} skipped={['Only the configured Accord owner can add documents to this knowledge base.']} />);
    return true;
  }
  let documents = attachedDocuments(message.contentParts);
  if (documents.length === 0) {
    try {
      documents = await downloadSlackDocuments({
        botToken: config.slackBotToken,
        channelId: config.channelId,
        rootTs: input.rootTs,
        messageTs: input.messageTs,
      });
    } catch (error) {
      const reason = error instanceof KnowledgeInputError ? error.message : 'Slack could not download the uploaded document safely.';
      await thread.post(<KnowledgeUploadCard accepted={[]} skipped={[reason]} />);
      return true;
    }
  }
  if (documents.length === 0) {
    await thread.post(<KnowledgeUploadCard accepted={[]} skipped={['Attach a .txt, .md, .csv, .json, .xml, or Word .docx file to add it.']} />);
    return true;
  }
  const accepted: string[] = [];
  const skipped: string[] = [];
  for (const [index, document] of documents.entries()) {
    const sourceName = document.sourceName ?? `Slack upload ${input.messageTs} (${index + 1})`;
    try {
      const result = await services.ingestSlackDocument({ part: document, sourceName, uploadedBy: input.authorId });
      accepted.push(`${result.document.sourceName}${result.created ? '' : ' (already indexed)'}`);
    } catch (error) {
      skipped.push(error instanceof KnowledgeInputError ? error.message : 'A document could not be indexed safely.');
    }
  }
  await thread.post(<KnowledgeUploadCard accepted={accepted} skipped={skipped} />);
  return true;
}

export function createSlackChannel(app: ApplicationPort, config: ChannelAppConfig) {
  const codeConfig = {
    githubToken: config.github.token,
    owner: config.github.owner,
    name: config.github.name,
    ref: config.github.ref,
    knownSecretValues: config.knownSecretValues,
  };
  const repository = createRepositorySnapshot(codeConfig);
  const knowledge = new KnowledgeServices({
    databaseUrl: config.databaseUrl,
    teamId: config.teamId,
    channelId: config.channelId,
    sanitize: (text) => redact(text, config.knownSecretValues),
  });
  const tools = [
    ...createChannelTools(app, { teamId: config.teamId, channelId: config.channelId }),
    ...createCodeTools(codeConfig, repository),
    ...createKnowledgeTools(knowledge),
    ...createSuggestTools(repository),
    ...createGitHubTools({
      githubToken: config.github.token,
      owner: config.github.owner,
      name: config.github.name,
      knownSecretValues: config.knownSecretValues,
    }),
    ...defaultSlackTools,
  ];

  const channel = createChannel({
    name: config.channelCode,
    identifyUser: 'platform',
    adapters: [
      slack({
        botToken: config.slackBotToken,
        appToken: config.slackAppToken,
      }),
    ],
    agent: makeChannelAgent,
    tools,
    context: [
      ...defaultSlackContext,
      {
        description: 'Role',
        value: 'Accord compliance and data retention verification assistant.',
      },
      {
        description: 'Allowed Audience',
        value: `Team: ${config.teamId}, Channel: ${config.channelId}`,
      },
    ],
  });

  // Handle Mentions (Enrolls thread)
  channel.onMention(async ({ thread, message }) => {
    const rawText = message.text ?? '';
    const ids = slackIdentifiers(thread, message);
    if (!ids) {
      return;
    }
    const { channelId, authorId, messageTs, rootTs } = ids;

    const inbound = normalizeInboundEvent(
      {
        teamId: config.teamId,
        channelId,
        rootTs,
        messageTs,
        authorId,
        text: rawText,
        wasMention: true,
      },
      { teamId: config.teamId, channelId: config.channelId },
    );

    if (!inbound) {
      return;
    }

    const receipt = await app.acceptEvent(inbound);
    if (receipt.accepted) {
      await thread.subscribe();
      const knowledgeUpload = !receipt.duplicate && await ingestRequestedKnowledge(knowledge, config, thread, message, { text: rawText, authorId, messageTs, rootTs });
      if (looksLikeRetentionDecision(rawText)) {
        await thread.post(EnrollmentCard());
      }
      // Answer the mention itself (e.g. a code question) instead of waiting for a thread reply.
      // Do not pass a raw uploaded document to the model on the ingestion turn. Future questions
      // use bounded, redacted retrieval results instead.
      if (!knowledgeUpload) await thread.runAgent();
    }
  });

  /**
   * Autonomous entry: a message in a thread Accord has not joined. Order matters for cost and
   * privacy: audience, then the free keyword prefilter, then history, then the triage model.
   */
  async function triageUnenrolled(
    thread: Parameters<Parameters<typeof channel.onMessage>[0]>[0]['thread'],
    input: { channelId: string; authorId: string; messageTs: string; rootTs: string; text: string },
  ): Promise<void> {
    if (!app.triageEvent) return;
    const allowed = { teamId: config.teamId, channelId: config.channelId };
    if (!isAllowedAudience(config.teamId, input.channelId, allowed)) return;
    if (!mayProposeRetentionPolicy(input.text)) return;

    const { history, complete } = await threadHistory(thread, { ts: input.messageTs, authorId: input.authorId, text: input.text });
    const inbound = normalizeInboundEvent(
      {
        teamId: config.teamId,
        channelId: input.channelId,
        rootTs: input.rootTs,
        messageTs: input.messageTs,
        authorId: input.authorId,
        text: input.text,
        wasMention: false,
        history,
        historyComplete: complete,
      },
      allowed,
    );
    if (!inbound) return;

    const outcome = await app.triageEvent(inbound);
    if (!outcome.receipt.accepted) return;
    await thread.subscribe();
    // Only the acceptance that enrolled the thread announces it; a racing message does not repeat it.
    if (outcome.enrolled) await thread.post(TriageEnrollmentCard());
  }

  // Handle messages: enrolled threads follow along, others go through autonomous triage.
  channel.onMessage(async ({ thread, message }) => {
    const rawText = message.text ?? '';
    const ids = slackIdentifiers(thread, message);
    if (!ids) {
      return;
    }
    const { channelId, authorId, messageTs, rootTs } = ids;

    if (!(await thread.isSubscribed())) {
      try {
        await triageUnenrolled(thread, { channelId, authorId, messageTs, rootTs, text: rawText });
      } catch (error) {
        // Triage is best effort and must never break the channel; a mention still enrolls.
        console.error('accord_triage_error', error instanceof Error ? error.name : 'unknown');
      }
      return;
    }

    const inbound = normalizeInboundEvent(
      {
        teamId: config.teamId,
        channelId,
        rootTs,
        messageTs,
        authorId,
        text: rawText,
        wasMention: false,
      },
      { teamId: config.teamId, channelId: config.channelId },
    );

    if (!inbound) {
      return;
    }

    const receipt = await app.acceptEvent(inbound);
    if (receipt.accepted) {
      const knowledgeUpload = !receipt.duplicate && await ingestRequestedKnowledge(knowledge, config, thread, message, { text: rawText, authorId, messageTs, rootTs });
      if (!knowledgeUpload) await thread.runAgent();
    }
  });

  return { channel, close: () => knowledge.close() };
}
