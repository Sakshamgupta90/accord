-- Durable, scoped semantic index for sanitized Slack messages. This schema is intentionally
-- outside Accord's policy/finding tables: semantic retrieval helps a conversation, never decides
-- a retention policy or becomes evidence for an investigation.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE accord_slack_thread_knowledge_queue (
  id              uuid PRIMARY KEY,
  team_id         text NOT NULL,
  channel_id      text NOT NULL,
  root_ts         text NOT NULL,
  message_ts      text NOT NULL,
  author_id       text NOT NULL,
  content         text NOT NULL CHECK (length(content) > 0 AND length(content) <= 8000),
  content_sha256  char(64) NOT NULL,
  status          text NOT NULL CHECK (status IN ('pending', 'processing', 'indexed')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  indexed_at      timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accord_slack_thread_knowledge_queue_scope_message_unique UNIQUE (team_id, channel_id, message_ts)
);

CREATE INDEX accord_slack_thread_knowledge_queue_due_idx
  ON accord_slack_thread_knowledge_queue (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE TABLE accord_slack_thread_knowledge_nodes (
  id             uuid PRIMARY KEY,
  team_id        text NOT NULL,
  channel_id     text NOT NULL,
  root_ts        text NOT NULL,
  message_ts     text,
  author_id      text,
  node_key       text NOT NULL,
  node_type      text NOT NULL CHECK (node_type IN ('thread', 'message')),
  content        text NOT NULL CHECK (length(content) > 0 AND length(content) <= 8000),
  content_sha256 char(64) NOT NULL,
  embedding      vector(768),
  embedding_model text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accord_slack_thread_knowledge_nodes_scope_key_unique UNIQUE (team_id, channel_id, node_key),
  CONSTRAINT accord_slack_thread_knowledge_nodes_shape_check CHECK (
    (node_type = 'thread' AND message_ts IS NULL AND author_id IS NULL AND embedding IS NULL)
    OR (node_type = 'message' AND message_ts IS NOT NULL AND author_id IS NOT NULL AND embedding IS NOT NULL AND embedding_model IS NOT NULL)
  )
);

CREATE INDEX accord_slack_thread_knowledge_nodes_scope_thread_idx
  ON accord_slack_thread_knowledge_nodes (team_id, channel_id, root_ts, message_ts)
  WHERE node_type = 'message';

CREATE INDEX accord_slack_thread_knowledge_nodes_embedding_hnsw_idx
  ON accord_slack_thread_knowledge_nodes USING hnsw (embedding vector_cosine_ops)
  WHERE node_type = 'message';

CREATE TABLE accord_slack_thread_knowledge_edges (
  team_id        text NOT NULL,
  channel_id     text NOT NULL,
  source_node_id uuid NOT NULL REFERENCES accord_slack_thread_knowledge_nodes (id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES accord_slack_thread_knowledge_nodes (id) ON DELETE CASCADE,
  edge_type      text NOT NULL CHECK (edge_type IN ('belongs_to_thread', 'follows', 'semantic_similarity')),
  score          real,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_node_id, target_node_id, edge_type),
  CONSTRAINT accord_slack_thread_knowledge_edges_scope_check CHECK (team_id <> '' AND channel_id <> ''),
  CONSTRAINT accord_slack_thread_knowledge_edges_score_check CHECK (
    (edge_type = 'semantic_similarity' AND score >= -1 AND score <= 1)
    OR (edge_type <> 'semantic_similarity' AND score IS NULL)
  )
);

CREATE INDEX accord_slack_thread_knowledge_edges_scope_source_idx
  ON accord_slack_thread_knowledge_edges (team_id, channel_id, source_node_id);
