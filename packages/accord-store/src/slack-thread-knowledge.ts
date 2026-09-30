/**
 * Durable semantic retrieval for Slack conversations.
 *
 * This is intentionally separate from Accord's decision store. It indexes only already
 * sanitized Slack messages, never feeds the retention decision pipeline, and can be queried
 * only inside the configured team/channel scope.
 */
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { SlackMessage } from '@accord/contracts';

const { Pool } = pg;

export const SLACK_THREAD_EMBEDDING_DIMENSIONS = 768;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_QUERY_CHARS = 1_000;
const MAX_BATCH_SIZE = 50;
const MAX_SEARCH_RESULTS = 8;
const SEMANTIC_EDGE_THRESHOLD = 0.82;

export type EmbeddingProvider = 'google' | 'openai';

export interface EmbeddingPort {
  readonly model: string;
  readonly dimensions: number;
  embed(text: string, purpose: 'document' | 'query'): Promise<number[]>;
}

export interface EmbeddingClientConfig {
  provider: EmbeddingProvider;
  apiKey: string;
  model: string;
  dimensions?: number;
  fetch?: typeof globalThis.fetch;
}

export interface SlackThreadKnowledgeScope {
  teamId: string;
  channelId: string;
}

export interface SlackThreadKnowledgeConfig extends SlackThreadKnowledgeScope {
  databaseUrl: string;
  embedding: EmbeddingPort;
  /** Defence in depth: callers pass normalised text, then this redacts it once more before persistence. */
  sanitize: (text: string) => string;
}

export interface SlackThreadKnowledgeHit {
  threadTs: string;
  messageTs: string;
  authorId: string;
  excerpt: string;
  score: number;
  connectedMessageCount: number;
}

export interface SlackThreadKnowledgeGraph {
  rootTs: string;
  messages: Array<{ messageTs: string; authorId: string; excerpt: string }>;
  edges: Array<{ fromMessageTs: string; toMessageTs: string; type: 'belongs_to_thread' | 'follows' | 'semantic_similarity'; score: number | null }>;
}

type QueueRow = {
  id: string;
  root_ts: string;
  message_ts: string;
  author_id: string;
  content: string;
  content_sha256: string;
  attempts: number;
};

function cleanText(value: string, maximum = MAX_MESSAGE_CHARS): string {
  return value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\s+$/g, '').trim().slice(0, maximum);
}

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

function normaliseVector(value: readonly number[], dimensions: number): number[] {
  if (value.length !== dimensions || value.some((part) => !Number.isFinite(part))) {
    throw new Error(`embedding provider returned an invalid ${value.length}-dimension vector`);
  }
  const magnitude = Math.hypot(...value);
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error('embedding provider returned a zero vector');
  return value.map((part) => part / magnitude);
}

function boundedProviderError(response: Response): Error {
  return new Error(`embedding provider request failed with HTTP ${response.status}`);
}

/**
 * Minimal, explicit provider adapter. The API key is sent only to the configured embedding
 * provider and never placed in a graph row, queue row, logger payload, or Slack tool result.
 */
export function createEmbeddingPort(config: EmbeddingClientConfig): EmbeddingPort {
  const dimensions = config.dimensions ?? SLACK_THREAD_EMBEDDING_DIMENSIONS;
  if (dimensions !== SLACK_THREAD_EMBEDDING_DIMENSIONS) {
    throw new Error(`Slack thread retrieval requires ${SLACK_THREAD_EMBEDDING_DIMENSIONS} embedding dimensions`);
  }
  if (!config.apiKey.trim()) throw new Error('embedding API key is required');
  const request = config.fetch ?? globalThis.fetch;

  return {
    model: config.model,
    dimensions,
    async embed(text, purpose) {
      const input = cleanText(text, MAX_QUERY_CHARS);
      if (!input) throw new Error('cannot embed an empty value');

      if (config.provider === 'openai') {
        const response = await request('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, model: config.model, dimensions, encoding_format: 'float' }),
        });
        if (!response.ok) throw boundedProviderError(response);
        const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
        const embedding = body.data?.[0]?.embedding;
        if (!Array.isArray(embedding) || !embedding.every((part) => typeof part === 'number')) {
          throw new Error('embedding provider returned no embedding');
        }
        return normaliseVector(embedding, dimensions);
      }

      const response = await request(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:embedContent`,
        {
          method: 'POST',
          // Keep the credential out of URLs, which are more likely than headers to appear in
          // proxy, server, or tracing logs.
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
          body: JSON.stringify({
            model: `models/${config.model}`,
            content: { parts: [{ text: input }] },
            taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            outputDimensionality: dimensions,
          }),
        },
      );
      if (!response.ok) throw boundedProviderError(response);
      const body = await response.json() as { embedding?: { values?: unknown } };
      const embedding = body.embedding?.values;
      if (!Array.isArray(embedding) || !embedding.every((part) => typeof part === 'number')) {
        throw new Error('embedding provider returned no embedding');
      }
      return normaliseVector(embedding, dimensions);
    },
  };
}

/** Reads the semantic configuration without coupling the store to the application config package. */
export function embeddingConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Omit<EmbeddingClientConfig, 'fetch'> {
  const providerValue = environment.ACCORD_EMBEDDING_PROVIDER ?? environment.ACCORD_MODEL_PROVIDER ?? 'google';
  if (providerValue !== 'google' && providerValue !== 'openai') {
    throw new Error('ACCORD_EMBEDDING_PROVIDER must be google or openai');
  }
  const provider: EmbeddingProvider = providerValue;
  const apiKey = environment[provider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY']?.trim() ?? '';
  if (!apiKey) throw new Error(`${provider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY'} is required for Slack semantic retrieval`);
  const model = environment.ACCORD_EMBEDDING_MODEL?.trim()
    || (provider === 'google' ? 'gemini-embedding-001' : 'text-embedding-3-small');
  return { provider, apiKey, model, dimensions: SLACK_THREAD_EMBEDDING_DIMENSIONS };
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(3_600, 10 * (2 ** Math.min(Math.max(attempts - 1, 0), 8)));
}

export class SlackThreadKnowledgeService {
  private readonly pool: pg.Pool;
  private readonly scope: SlackThreadKnowledgeScope;
  private readonly embedding: EmbeddingPort;
  private readonly sanitize: (text: string) => string;

  constructor(config: SlackThreadKnowledgeConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 4,
      statement_timeout: 15_000,
      application_name: 'accord-slack-thread-knowledge',
    });
    this.scope = { teamId: config.teamId, channelId: config.channelId };
    this.embedding = config.embedding;
    this.sanitize = config.sanitize;
  }

  async close(): Promise<void> { await this.pool.end(); }

  /** Durable, idempotent ingress. This never calls an embedding provider on the Slack event path. */
  async enqueue(rootTs: string, message: SlackMessage): Promise<void> {
    const content = cleanText(this.sanitize(message.text));
    if (!content) return;
    const digest = createHash('sha256').update(content).digest('hex');
    await this.pool.query(
      `INSERT INTO accord_slack_thread_knowledge_queue
         (id, team_id, channel_id, root_ts, message_ts, author_id, content, content_sha256, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now())
       ON CONFLICT (team_id, channel_id, message_ts) DO UPDATE
       SET root_ts = EXCLUDED.root_ts,
           author_id = EXCLUDED.author_id,
           content = EXCLUDED.content,
           content_sha256 = EXCLUDED.content_sha256,
           status = CASE WHEN accord_slack_thread_knowledge_queue.content_sha256 <> EXCLUDED.content_sha256 THEN 'pending' ELSE accord_slack_thread_knowledge_queue.status END,
           next_attempt_at = CASE WHEN accord_slack_thread_knowledge_queue.content_sha256 <> EXCLUDED.content_sha256 THEN now() ELSE accord_slack_thread_knowledge_queue.next_attempt_at END,
           last_error = CASE WHEN accord_slack_thread_knowledge_queue.content_sha256 <> EXCLUDED.content_sha256 THEN NULL ELSE accord_slack_thread_knowledge_queue.last_error END,
           updated_at = now()`,
      [randomUUID(), this.scope.teamId, this.scope.channelId, rootTs, message.ts, message.authorId, content, digest],
    );
  }

  /** Claims a small SKIP LOCKED batch, then performs all slow provider calls outside transactions. */
  async indexPending(limit = 20): Promise<{ claimed: number; indexed: number; deferred: number }> {
    const rows = await this.claim(Math.min(Math.max(limit, 1), MAX_BATCH_SIZE));
    let indexed = 0;
    let deferred = 0;
    for (const row of rows) {
      try {
        const embedding = await this.embedding.embed(row.content, 'document');
        if (await this.upsertGraph(row, embedding)) indexed += 1;
      } catch {
        await this.pool.query(
          `UPDATE accord_slack_thread_knowledge_queue
           SET status = 'pending', next_attempt_at = now() + ($2::integer * interval '1 second'),
               last_error = 'Embedding attempt failed; retry is scheduled.', updated_at = now()
           WHERE id = $1`,
          [row.id, retryDelaySeconds(row.attempts)],
        );
        deferred += 1;
      }
    }
    return { claimed: rows.length, indexed, deferred };
  }

  async search(query: string, limit = MAX_SEARCH_RESULTS): Promise<SlackThreadKnowledgeHit[]> {
    const text = cleanText(query, MAX_QUERY_CHARS);
    if (text.length < 2) throw new Error('Use at least two characters when searching Slack knowledge.');
    const embedding = await this.embedding.embed(text, 'query');
    const result = await this.pool.query<{
      root_ts: string; message_ts: string; author_id: string; content: string; score: string; connected_message_count: string;
    }>(
      `SELECT n.root_ts, n.message_ts, n.author_id, n.content,
              (1 - (n.embedding <=> $3::vector))::text AS score,
              (SELECT count(*) FROM accord_slack_thread_knowledge_nodes related
                WHERE related.team_id = n.team_id AND related.channel_id = n.channel_id
                  AND related.root_ts = n.root_ts AND related.node_type = 'message')::text AS connected_message_count
       FROM accord_slack_thread_knowledge_nodes n
       WHERE n.team_id = $1 AND n.channel_id = $2 AND n.node_type = 'message' AND n.embedding IS NOT NULL
       ORDER BY n.embedding <=> $3::vector, n.message_ts DESC
       LIMIT $4`,
      [this.scope.teamId, this.scope.channelId, vectorLiteral(embedding), Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS)],
    );
    return result.rows.map((row) => ({
      threadTs: row.root_ts,
      messageTs: row.message_ts,
      authorId: row.author_id,
      excerpt: row.content.length > 1_000 ? `${row.content.slice(0, 1_000)}…[truncated]` : row.content,
      score: Number(row.score),
      connectedMessageCount: Number(row.connected_message_count),
    }));
  }

  async inspectThread(rootTs: string, limit = 40): Promise<SlackThreadKnowledgeGraph | null> {
    const capped = Math.min(Math.max(limit, 1), 50);
    const messages = await this.pool.query<{ id: string; message_ts: string; author_id: string; content: string }>(
      `SELECT id, message_ts, author_id, content
       FROM accord_slack_thread_knowledge_nodes
       WHERE team_id = $1 AND channel_id = $2 AND root_ts = $3 AND node_type = 'message'
       ORDER BY message_ts ASC LIMIT $4`,
      [this.scope.teamId, this.scope.channelId, rootTs, capped],
    );
    if (!messages.rowCount) return null;
    const ids = messages.rows.map((row) => row.id);
    const edges = await this.pool.query<{ from_message_ts: string | null; to_message_ts: string | null; edge_type: 'belongs_to_thread' | 'follows' | 'semantic_similarity'; score: string | null }>(
      `SELECT source.message_ts AS from_message_ts, target.message_ts AS to_message_ts, e.edge_type, e.score::text
       FROM accord_slack_thread_knowledge_edges e
       JOIN accord_slack_thread_knowledge_nodes source ON source.id = e.source_node_id
       JOIN accord_slack_thread_knowledge_nodes target ON target.id = e.target_node_id
       WHERE e.team_id = $1 AND e.channel_id = $2
         AND (e.source_node_id = ANY($3::uuid[]) OR e.target_node_id = ANY($3::uuid[]))
       ORDER BY e.edge_type, source.message_ts NULLS FIRST, target.message_ts NULLS FIRST
       LIMIT 100`,
      [this.scope.teamId, this.scope.channelId, ids],
    );
    return {
      rootTs,
      messages: messages.rows.map((row) => ({
        messageTs: row.message_ts,
        authorId: row.author_id,
        excerpt: row.content.length > 1_000 ? `${row.content.slice(0, 1_000)}…[truncated]` : row.content,
      })),
      edges: edges.rows.map((row) => ({
        fromMessageTs: row.from_message_ts ?? rootTs,
        toMessageTs: row.to_message_ts ?? rootTs,
        type: row.edge_type,
        score: row.score === null ? null : Number(row.score),
      })),
    };
  }

  private async claim(limit: number): Promise<QueueRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<QueueRow>(
        `WITH due AS (
           SELECT id FROM accord_slack_thread_knowledge_queue
           WHERE team_id = $1 AND channel_id = $2 AND (
             (status = 'pending' AND next_attempt_at <= now())
             OR (status = 'processing' AND updated_at <= now() - interval '5 minutes')
           )
           ORDER BY next_attempt_at, created_at
           FOR UPDATE SKIP LOCKED LIMIT $3
         )
         UPDATE accord_slack_thread_knowledge_queue q
         SET status = 'processing', attempts = q.attempts + 1, updated_at = now()
         FROM due
         WHERE q.id = due.id
         RETURNING q.id, q.root_ts, q.message_ts, q.author_id, q.content, q.content_sha256, q.attempts`,
        [this.scope.teamId, this.scope.channelId, limit],
      );
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fences graph writes against a concurrent Slack edit. The queue row remains locked from the
   * digest comparison through marking it indexed, so a newer enqueue either wins before this
   * transaction (and this returns false) or queues a fresh revision immediately after it commits.
   */
  private async upsertGraph(row: QueueRow, embedding: readonly number[]): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ content_sha256: string; status: string }>(
        `SELECT content_sha256, status FROM accord_slack_thread_knowledge_queue WHERE id = $1 FOR UPDATE`,
        [row.id],
      );
      if (!current.rowCount || current.rows[0]!.content_sha256 !== row.content_sha256 || current.rows[0]!.status !== 'processing') {
        await client.query('COMMIT');
        return false;
      }
      const threadKey = `thread:${row.root_ts}`;
      const thread = await client.query<{ id: string }>(
        `INSERT INTO accord_slack_thread_knowledge_nodes
           (id, team_id, channel_id, root_ts, node_key, node_type, content, content_sha256)
         VALUES ($1, $2, $3, $4, $5, 'thread', $6, $7)
         ON CONFLICT (team_id, channel_id, node_key) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [randomUUID(), this.scope.teamId, this.scope.channelId, row.root_ts, threadKey, `Slack thread ${row.root_ts}`, createHash('sha256').update(threadKey).digest('hex')],
      );
      const message = await client.query<{ id: string }>(
        `INSERT INTO accord_slack_thread_knowledge_nodes
           (id, team_id, channel_id, root_ts, message_ts, author_id, node_key, node_type, content, content_sha256, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'message', $8, $9, $10::vector, $11)
         ON CONFLICT (team_id, channel_id, node_key) DO UPDATE
         SET root_ts = EXCLUDED.root_ts, author_id = EXCLUDED.author_id, content = EXCLUDED.content,
             content_sha256 = EXCLUDED.content_sha256, embedding = EXCLUDED.embedding,
             embedding_model = EXCLUDED.embedding_model, updated_at = now()
         RETURNING id`,
        [randomUUID(), this.scope.teamId, this.scope.channelId, row.root_ts, row.message_ts, row.author_id, `message:${row.message_ts}`, row.content, row.content_sha256, vectorLiteral(embedding), this.embedding.model],
      );
      const threadId = thread.rows[0]!.id;
      const messageId = message.rows[0]!.id;
      await client.query(
        `INSERT INTO accord_slack_thread_knowledge_edges (team_id, channel_id, source_node_id, target_node_id, edge_type)
         VALUES ($1, $2, $3, $4, 'belongs_to_thread')
         ON CONFLICT (source_node_id, target_node_id, edge_type) DO NOTHING`,
        [this.scope.teamId, this.scope.channelId, messageId, threadId],
      );
      const previous = await client.query<{ id: string }>(
        `SELECT id FROM accord_slack_thread_knowledge_nodes
         WHERE team_id = $1 AND channel_id = $2 AND root_ts = $3 AND node_type = 'message'
           AND id <> $4 AND message_ts::numeric < $5::numeric
         ORDER BY message_ts::numeric DESC LIMIT 1`,
        [this.scope.teamId, this.scope.channelId, row.root_ts, messageId, row.message_ts],
      );
      if (previous.rowCount) {
        await client.query(
          `INSERT INTO accord_slack_thread_knowledge_edges (team_id, channel_id, source_node_id, target_node_id, edge_type)
           VALUES ($1, $2, $3, $4, 'follows')
           ON CONFLICT (source_node_id, target_node_id, edge_type) DO NOTHING`,
          [this.scope.teamId, this.scope.channelId, previous.rows[0]!.id, messageId],
        );
      }
      await client.query(
        `DELETE FROM accord_slack_thread_knowledge_edges
         WHERE source_node_id = $1 AND edge_type = 'semantic_similarity'`,
        [messageId],
      );
      const neighbours = await client.query<{ id: string; score: string }>(
        `SELECT id, (1 - (embedding <=> $4::vector))::text AS score
         FROM accord_slack_thread_knowledge_nodes
         WHERE team_id = $1 AND channel_id = $2 AND node_type = 'message' AND id <> $3 AND embedding IS NOT NULL
         ORDER BY embedding <=> $4::vector LIMIT 4`,
        [this.scope.teamId, this.scope.channelId, messageId, vectorLiteral(embedding)],
      );
      for (const neighbour of neighbours.rows) {
        if (Number(neighbour.score) < SEMANTIC_EDGE_THRESHOLD) continue;
        await client.query(
          `INSERT INTO accord_slack_thread_knowledge_edges
             (team_id, channel_id, source_node_id, target_node_id, edge_type, score)
           VALUES ($1, $2, $3, $4, 'semantic_similarity', $5)
           ON CONFLICT (source_node_id, target_node_id, edge_type) DO UPDATE SET score = EXCLUDED.score`,
          [this.scope.teamId, this.scope.channelId, messageId, neighbour.id, Number(neighbour.score)],
        );
      }
      await client.query(
        `UPDATE accord_slack_thread_knowledge_queue
         SET status = 'indexed', indexed_at = now(), last_error = NULL, updated_at = now()
         WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
