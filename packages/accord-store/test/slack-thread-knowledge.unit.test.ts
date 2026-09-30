import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEmbeddingPort, embeddingConfigFromEnvironment, SLACK_THREAD_EMBEDDING_DIMENSIONS } from '../src/index.js';

const vector = Array.from({ length: SLACK_THREAD_EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 3 : index === 1 ? 4 : 0);

test('Google embeddings are retrieval-purpose tagged, bounded, and unit normalised', async () => {
  let request: RequestInit | undefined;
  let url = '';
  const port = createEmbeddingPort({
    provider: 'google', apiKey: 'google-test-key', model: 'gemini-embedding-001',
    fetch: async (input, init) => {
      url = String(input);
      request = init;
      return new Response(JSON.stringify({ embedding: { values: vector } }), { status: 200 });
    },
  });
  const result = await port.embed('legacy Pascal cleanup', 'query');
  assert.match(url, /gemini-embedding-001:embedContent/);
  assert.equal(url.includes('google-test-key'), false, 'embedding credentials must not be placed in a URL');
  assert.equal(new Headers(request?.headers).get('x-goog-api-key'), 'google-test-key');
  assert.equal(JSON.parse(String(request?.body)).taskType, 'RETRIEVAL_QUERY');
  assert.equal(result.length, SLACK_THREAD_EMBEDDING_DIMENSIONS);
  assert.ok(Math.abs(Math.hypot(...result) - 1) < 1e-12);
  assert.equal(result[0], 0.6);
  assert.equal(result[1], 0.8);
});

test('OpenAI embeddings request the fixed graph dimensionality', async () => {
  let request: RequestInit | undefined;
  const port = createEmbeddingPort({
    provider: 'openai', apiKey: 'openai-test-key', model: 'text-embedding-3-small',
    fetch: async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 });
    },
  });
  await port.embed('legacy Pascal cleanup', 'document');
  const body = JSON.parse(String(request?.body));
  assert.equal(body.model, 'text-embedding-3-small');
  assert.equal(body.dimensions, SLACK_THREAD_EMBEDDING_DIMENSIONS);
  assert.equal(body.encoding_format, 'float');
});

test('embedding environment selection defaults safely and rejects unsupported providers', () => {
  const google = embeddingConfigFromEnvironment({ GOOGLE_API_KEY: 'test' });
  assert.deepEqual(google, { provider: 'google', apiKey: 'test', model: 'gemini-embedding-001', dimensions: 768 });
  const openai = embeddingConfigFromEnvironment({ ACCORD_EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'test', ACCORD_EMBEDDING_MODEL: 'custom-embedding' });
  assert.deepEqual(openai, { provider: 'openai', apiKey: 'test', model: 'custom-embedding', dimensions: 768 });
  assert.throws(() => embeddingConfigFromEnvironment({ ACCORD_EMBEDDING_PROVIDER: 'other', GOOGLE_API_KEY: 'test' }), /must be google or openai/);
});

test('semantic graph migration enforces vector scope, queue idempotency, and typed edges', () => {
  const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '003_slack_thread_semantic_graph.sql'), 'utf8');
  for (const fragment of [
    'CREATE EXTENSION IF NOT EXISTS vector',
    'accord_slack_thread_knowledge_queue_scope_message_unique UNIQUE (team_id, channel_id, message_ts)',
    'embedding      vector(768)',
    'USING hnsw (embedding vector_cosine_ops)',
    "edge_type IN ('belongs_to_thread', 'follows', 'semantic_similarity')",
  ]) assert.ok(sql.includes(fragment), `missing semantic graph safeguard: ${fragment}`);
});
