/**
 * Read-only, operator-invoked historical Slack backfill for the semantic graph.
 *
 * It reads only the configured channel, stores only redacted text in the durable queue, and does
 * not call the embedding provider itself. The scheduled worker performs embeddings afterwards.
 */
import { SlackThreadKnowledgeService } from '@accord/store';
import { sanitizeText } from '@accord/privacy';

type SlackMessageResponse = {
  ts?: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  reply_count?: number;
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackMessageResponse[];
  response_metadata?: { next_cursor?: string };
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseLimit(args: readonly string[]): number {
  const raw = args.find((argument) => argument.startsWith('--max='))?.slice('--max='.length) ?? '1000';
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error('Use --max=<1..10000> to bound the number of Slack messages backfilled.');
  }
  return value;
}

async function slackApi(token: string, endpoint: string, values: Record<string, string>): Promise<SlackApiResponse> {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Slack ${endpoint} failed with HTTP ${response.status}`);
  const body = await response.json() as SlackApiResponse;
  if (!body.ok) throw new Error(`Slack ${endpoint} failed: ${body.error ?? 'unknown error'}`);
  return body;
}

function isHumanMessage(message: SlackMessageResponse): message is Required<Pick<SlackMessageResponse, 'ts' | 'user' | 'text'>> & SlackMessageResponse {
  return Boolean(message.ts && message.user && typeof message.text === 'string' && !message.bot_id && message.subtype !== 'bot_message');
}

const maxMessages = parseLimit(process.argv.slice(2));
const botToken = required('SLACK_BOT_TOKEN');
const teamId = required('ACCORD_SLACK_TEAM_ID');
const channelId = required('ACCORD_SLACK_CHANNEL_ID');
const databaseUrl = required('DATABASE_URL');
const knownSecrets = [
  botToken, process.env.SLACK_APP_TOKEN, process.env.GITHUB_TOKEN, process.env.GOOGLE_API_KEY,
  process.env.OPENAI_API_KEY, process.env.INTELLIGENCE_API_KEY, process.env.TRIGGER_SECRET_KEY,
  process.env.CLICKHOUSE_PASSWORD,
]
  .filter((value): value is string => Boolean(value?.trim()));
const service = new SlackThreadKnowledgeService({
  databaseUrl,
  teamId,
  channelId,
  // Queue-only command: it never contacts an embedding provider. The worker validates and owns
  // that credential when it drains these rows.
  embedding: {
    model: 'backfill-queue-only',
    dimensions: 768,
    async embed() { throw new Error('the backfill command never embeds messages'); },
  },
  sanitize: (text) => sanitizeText(text, knownSecrets),
});

let queued = 0;
let cursor = '';
try {
  do {
    const page = await slackApi(botToken, 'conversations.history', { channel: channelId, limit: '200', cursor });
    for (const root of page.messages ?? []) {
      if (queued >= maxMessages) break;
      if (isHumanMessage(root)) {
        await service.enqueue(root.thread_ts ?? root.ts, {
          id: `${teamId}:${channelId}:${root.ts}`,
          ts: root.ts,
          authorId: root.user,
          text: root.text,
          permalink: null,
          editedTs: null,
        });
        queued += 1;
      }
      if (!root.ts || !root.reply_count || queued >= maxMessages) continue;
      let replyCursor = '';
      do {
        const replies = await slackApi(botToken, 'conversations.replies', { channel: channelId, ts: root.ts, limit: '200', cursor: replyCursor });
        for (const reply of replies.messages ?? []) {
          if (queued >= maxMessages) break;
          if (reply.ts === root.ts) continue; // replies includes the root on the first page
          if (!isHumanMessage(reply)) continue;
          await service.enqueue(root.ts, {
            id: `${teamId}:${channelId}:${reply.ts}`,
            ts: reply.ts,
            authorId: reply.user,
            text: reply.text,
            permalink: null,
            editedTs: null,
          });
          queued += 1;
        }
        replyCursor = replies.response_metadata?.next_cursor ?? '';
      } while (replyCursor && queued < maxMessages);
    }
    cursor = page.response_metadata?.next_cursor ?? '';
  } while (cursor && queued < maxMessages);

  console.log(`Queued ${queued} redacted Slack messages for semantic indexing. The worker will embed them on its next scheduled run.`);
  if (queued === maxMessages && cursor) console.log('Backfill stopped at --max; run again with a higher limit to continue reading channel history.');
} finally {
  await service.close();
}
