/** @accord/channel — server & bridge configuration loader.
 * Validates environment variables required for the direct Slack adapter and CopilotKit runtime.
 */
import { AccordError, publicError } from '@accord/contracts';

export interface ChannelAppConfig {
  intelligenceApiKey: string;
  channelCode: string;
  slackBotToken: string;
  slackAppToken: string;
  teamId: string;
  channelId: string;
  ownerUserId: string;
  databaseUrl: string;
  botUserId: string | null;
  embedding: { provider: 'google' | 'openai'; apiKey: string; model: string };
  github: { token: string; owner: string; name: string; ref: string };
  /** Configured credential values, redacted from any repository text the agent reads. */
  knownSecretValues: string[];
  port: number;
  mode: 'demo' | 'live';
  intelligenceApiUrl?: string;
  intelligenceWsUrl?: string;
}

export function loadChannelConfig(env: Record<string, string | undefined> = process.env): ChannelAppConfig {
  const missing: string[] = [];

  const get = (key: string): string => {
    const val = env[key];
    if (!val || val.trim() === '') {
      missing.push(key);
      return '';
    }
    return val.trim();
  };

  const intelligenceApiKey = get('INTELLIGENCE_API_KEY');
  const channelCode = get('CHANNEL_CODE');
  const slackBotToken = get('SLACK_BOT_TOKEN');
  const slackAppToken = get('SLACK_APP_TOKEN');
  const teamId = get('ACCORD_SLACK_TEAM_ID');
  const channelId = get('ACCORD_SLACK_CHANNEL_ID');
  const ownerUserId = get('ACCORD_OWNER_SLACK_USER_ID');
  const databaseUrl = get('DATABASE_URL');
  const embeddingProvider = (env.ACCORD_EMBEDDING_PROVIDER ?? env.ACCORD_MODEL_PROVIDER ?? 'google').trim();
  if (embeddingProvider !== 'google' && embeddingProvider !== 'openai') {
    throw new AccordError(publicError('INVALID_INPUT', 'ACCORD_EMBEDDING_PROVIDER must be google or openai'));
  }
  const embeddingApiKey = get(embeddingProvider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY');
  const embeddingModel = (env.ACCORD_EMBEDDING_MODEL?.trim()
    || (embeddingProvider === 'google' ? 'gemini-embedding-001' : 'text-embedding-3-small'));
  const github = {
    token: get('GITHUB_TOKEN'),
    owner: get('ACCORD_GITHUB_OWNER'),
    name: get('ACCORD_GITHUB_REPO'),
    ref: get('ACCORD_REPO_REF'),
  };

  if (missing.length > 0) {
    throw new AccordError(
      publicError('AUTH', `Missing required environment configuration: ${missing.join(', ')}`),
    );
  }

  const portRaw = env.PORT ?? '3000';
  const port = parseInt(portRaw, 10);
  const mode = env.ACCORD_MODE === 'live' ? 'live' : 'demo';

  return {
    intelligenceApiKey,
    channelCode,
    slackBotToken,
    slackAppToken,
    teamId,
    channelId,
    ownerUserId,
    databaseUrl,
    botUserId: env.ACCORD_BOT_USER_ID?.trim() || null,
    embedding: { provider: embeddingProvider, apiKey: embeddingApiKey, model: embeddingModel },
    github,
    knownSecretValues: [
      intelligenceApiKey, slackBotToken, slackAppToken, github.token,
      env.GOOGLE_API_KEY, env.OPENAI_API_KEY, env.CLICKHOUSE_PASSWORD, env.TRIGGER_SECRET_KEY,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    port: Number.isFinite(port) ? port : 3000,
    mode,
    intelligenceApiUrl: env.INTELLIGENCE_API_URL,
    intelligenceWsUrl: env.INTELLIGENCE_GATEWAY_WS_URL,
  };
}
