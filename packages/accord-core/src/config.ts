/** Configuration shape and environment parsing contract. Owner: Agent 1.
 * Names match .env.example and 01-SHARED-CONTRACTS section 11. Each factory validates only what it needs.
 * There is no fallback from live providers to test doubles, and no production 'mock' mode.
 */
export type AccordMode = 'demo' | 'live';

export interface AccordConfig {
  mode: AccordMode;
  model: { apiKey: string; model: string; provider?: 'openai' | 'google'; reasoningEffort?: string };
  intelligence: { apiKey: string; channelCode: string };
  slack: { botToken: string; appToken: string; teamId: string; channelId: string; ownerUserId: string };
  github: { token: string; owner: string; name: string; ref: string; pathPrefix: string };
  postgres: { databaseUrl: string };
  clickhouse: { url: string; username: string; password: string; database: string };
  trigger: { secretKey: string; projectRef: string };
  dataset: { version: string; asOf: string | null };
  port: number;
}

export const REQUIRED_ENVIRONMENT_NAMES = [
  'ACCORD_MODEL', 'INTELLIGENCE_API_KEY', 'CHANNEL_CODE', 'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN', 'ACCORD_SLACK_TEAM_ID', 'ACCORD_SLACK_CHANNEL_ID', 'ACCORD_OWNER_SLACK_USER_ID',
  'GITHUB_TOKEN', 'ACCORD_GITHUB_OWNER', 'ACCORD_GITHUB_REPO', 'ACCORD_REPO_REF', 'ACCORD_REPO_PATH_PREFIX',
  'DATABASE_URL', 'CLICKHOUSE_URL', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD', 'CLICKHOUSE_DATABASE',
  'TRIGGER_SECRET_KEY', 'TRIGGER_PROJECT_REF', 'ACCORD_MODE', 'ACCORD_DATASET_VERSION', 'PORT',
] as const;

export const DEMO_ONLY_ENVIRONMENT_NAMES = [
  'ACCORD_DEMO_AS_OF', 'ACCORD_TRUSTED_PROFILE_PATH', 'ACCORD_DEMO_RESET_ENABLED',
] as const;

export type RequiredEnvironmentName = (typeof REQUIRED_ENVIRONMENT_NAMES)[number];

import { AccordError, isIsoTime, normalizeIsoTime, publicError } from '@accord/contracts';
import type { ClockPort } from '@accord/contracts';

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim() === '') {
    // Missing live configuration fails clearly. There is no fallback to a test double.
    throw new AccordError(publicError('INVALID_INPUT', `${name} is required but not set`));
  }
  return value.trim();
}

function optional(environment: NodeJS.ProcessEnv, name: string): string | null {
  const value = environment[name];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/** Parses and validates the whole runtime configuration. Each factory still validates its own slice. */
export function loadAccordConfig(environment: NodeJS.ProcessEnv = process.env): AccordConfig {
  const mode = required(environment, 'ACCORD_MODE');
  if (mode !== 'demo' && mode !== 'live') {
    throw new AccordError(publicError('INVALID_INPUT', 'ACCORD_MODE must be demo or live'));
  }

  const asOf = optional(environment, 'ACCORD_DEMO_AS_OF');
  if (asOf !== null && !isIsoTime(asOf)) {
    throw new AccordError(publicError('INVALID_INPUT', 'ACCORD_DEMO_AS_OF must be UTC ISO 8601 with milliseconds'));
  }

  const port = Number.parseInt(required(environment, 'PORT'), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new AccordError(publicError('INVALID_INPUT', 'PORT must be a positive integer'));
  }

  return {
    mode,
    model: loadModelConfig(environment),
    intelligence: { apiKey: required(environment, 'INTELLIGENCE_API_KEY'), channelCode: required(environment, 'CHANNEL_CODE') },
    slack: {
      botToken: required(environment, 'SLACK_BOT_TOKEN'),
      appToken: required(environment, 'SLACK_APP_TOKEN'),
      teamId: required(environment, 'ACCORD_SLACK_TEAM_ID'),
      channelId: required(environment, 'ACCORD_SLACK_CHANNEL_ID'),
      ownerUserId: required(environment, 'ACCORD_OWNER_SLACK_USER_ID'),
    },
    github: {
      token: required(environment, 'GITHUB_TOKEN'),
      owner: required(environment, 'ACCORD_GITHUB_OWNER'),
      name: required(environment, 'ACCORD_GITHUB_REPO'),
      ref: required(environment, 'ACCORD_REPO_REF'),
      pathPrefix: required(environment, 'ACCORD_REPO_PATH_PREFIX'),
    },
    postgres: { databaseUrl: required(environment, 'DATABASE_URL') },
    clickhouse: {
      url: required(environment, 'CLICKHOUSE_URL'),
      username: required(environment, 'CLICKHOUSE_USER'),
      password: required(environment, 'CLICKHOUSE_PASSWORD'),
      database: required(environment, 'CLICKHOUSE_DATABASE'),
    },
    trigger: { secretKey: required(environment, 'TRIGGER_SECRET_KEY'), projectRef: required(environment, 'TRIGGER_PROJECT_REF') },
    dataset: { version: required(environment, 'ACCORD_DATASET_VERSION'), asOf },
    port,
  };
}

export interface TriageConfig {
  model: AccordConfig['model'];
  /** A `policy_proposed` below this confidence does not enroll the thread. */
  minConfidence: number;
}

/**
 * Autonomous triage of messages in unenrolled threads. On by default; `ACCORD_TRIAGE=off` disables it.
 * Uses the interpretation provider and key, with an optional cheaper `ACCORD_TRIAGE_MODEL`.
 */
export function loadTriageConfig(environment: NodeJS.ProcessEnv = process.env): TriageConfig | null {
  const mode = (optional(environment, 'ACCORD_TRIAGE') ?? 'on').toLowerCase();
  if (mode === 'off') return null;
  if (mode !== 'on') throw new AccordError(publicError('INVALID_INPUT', 'ACCORD_TRIAGE must be on or off'));

  const base = loadModelConfig(environment);
  const minConfidence = Number(optional(environment, 'ACCORD_TRIAGE_MIN_CONFIDENCE') ?? '0.75');
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new AccordError(publicError('INVALID_INPUT', 'ACCORD_TRIAGE_MIN_CONFIDENCE must be between 0 and 1'));
  }
  const reasoningEffort = optional(environment, 'ACCORD_TRIAGE_REASONING_EFFORT');
  return {
    model: {
      ...(base.provider ? { provider: base.provider } : {}),
      apiKey: base.apiKey,
      model: optional(environment, 'ACCORD_TRIAGE_MODEL') ?? base.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
    minConfidence,
  };
}

/** Optional: our own bot user id, so this app's findings never re-trigger an investigation. */
export function botUserIdFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string | null {
  return optional(environment, 'ACCORD_BOT_USER_ID');
}

export function systemClock(): ClockPort {
  return { now: () => normalizeIsoTime(new Date()) };
}

/**
 * The as-of instant used by an investigation. In demo mode it is the fixed configured clock, so
 * evaluation never depends on wall time; in live mode it is the moment the run starts.
 */
export function datasetAsOf(config: AccordConfig, clock: ClockPort): string {
  if (config.mode === 'demo' && config.dataset.asOf) return config.dataset.asOf;
  return clock.now();
}

/** Shared selection for the coordinator, worker and live checks. */
export function loadModelConfig(environment: NodeJS.ProcessEnv = process.env): AccordConfig['model'] {
  const provider = environment.ACCORD_MODEL_PROVIDER ?? 'google';
  if (provider !== 'google' && provider !== 'openai') {
    throw new AccordError(publicError('INVALID_INPUT', 'ACCORD_MODEL_PROVIDER must be google or openai'));
  }
  return {
    provider,
    apiKey: required(environment, provider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY'),
    model: required(environment, 'ACCORD_MODEL'),
    // Optional. Unset keeps the provider default; `low` cuts Gemini interpretation from ~12s to ~2s.
    ...(environment.ACCORD_MODEL_REASONING_EFFORT?.trim() ? { reasoningEffort: environment.ACCORD_MODEL_REASONING_EFFORT.trim() } : {}),
  };
}
