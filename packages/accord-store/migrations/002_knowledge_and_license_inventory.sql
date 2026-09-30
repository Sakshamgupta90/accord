-- Knowledge documents and business facts are intentionally separate from Accord's
-- decision/finding tables. They enrich Slack exploration only; they cannot alter
-- retention decisions, policy verification, ClickHouse impact, or the outbox.

CREATE TABLE accord_knowledge_documents (
  id            uuid PRIMARY KEY,
  team_id       text NOT NULL,
  channel_id    text NOT NULL,
  source_name   text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 255),
  media_type    text NOT NULL CHECK (char_length(media_type) BETWEEN 1 AND 255),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by   text NOT NULL,
  extracted_text text NOT NULL CHECK (char_length(extracted_text) BETWEEN 1 AND 500000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accord_knowledge_documents_scope_content_unique UNIQUE (team_id, channel_id, content_sha256)
);

CREATE INDEX accord_knowledge_documents_scope_idx
  ON accord_knowledge_documents (team_id, channel_id, created_at DESC);

CREATE TABLE accord_knowledge_chunks (
  id            uuid PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES accord_knowledge_documents (id) ON DELETE CASCADE,
  chunk_index   integer NOT NULL CHECK (chunk_index >= 0),
  content       text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1400),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accord_knowledge_chunks_document_position_unique UNIQUE (document_id, chunk_index)
);

CREATE INDEX accord_knowledge_chunks_search_idx
  ON accord_knowledge_chunks USING GIN (search_vector);

-- Loaded by an administrator or an approved ETL process, never by a Slack tool.
-- The rows contain commercial metadata, not licence keys or other credentials.
CREATE TABLE accord_license_inventory (
  id                uuid PRIMARY KEY,
  team_id           text NOT NULL,
  channel_id        text NOT NULL,
  vendor            text NOT NULL CHECK (char_length(vendor) BETWEEN 1 AND 160),
  product            text NOT NULL CHECK (char_length(product) BETWEEN 1 AND 160),
  sku                text NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 160),
  unit_cost_cents    integer NOT NULL CHECK (unit_cost_cents >= 0),
  active_seats       integer NOT NULL CHECK (active_seats >= 0),
  assigned_seats     integer NOT NULL CHECK (assigned_seats >= 0 AND assigned_seats <= active_seats),
  currency           char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  renewal_date       date,
  status             text NOT NULL CHECK (status IN ('active', 'suspended', 'expired')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accord_license_inventory_scope_idx
  ON accord_license_inventory (team_id, channel_id, status, vendor, product);
