/** Durable, scoped knowledge retrieval and read-only licence-cost scenarios.
 *
 * This module deliberately does not use Accord's policy/finding store APIs. Knowledge and
 * commercial facts can help the Slack assistant explain a codebase, but never become policy
 * evidence or change the durable retention-decision workflow.
 */
import { createHash, randomUUID } from 'node:crypto';
import mammoth from 'mammoth';
import pg from 'pg';

const { Pool } = pg;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 500_000;
const CHUNK_CHARS = 1_100;
const CHUNK_OVERLAP = 160;
const MAX_SEARCH_RESULTS = 6;

export interface KnowledgeScope {
  teamId: string;
  channelId: string;
}

export interface KnowledgeDocument {
  id: string;
  sourceName: string;
  mediaType: string;
  uploadedBy: string;
  createdAt: string;
  chunkCount?: number;
}

export interface KnowledgeHit {
  documentId: string;
  sourceName: string;
  chunkIndex: number;
  excerpt: string;
  score: number;
  createdAt: string;
}

export interface LicenseInventoryItem {
  id: string;
  vendor: string;
  product: string;
  sku: string;
  unitCostCents: number;
  activeSeats: number;
  assignedSeats: number;
  currency: string;
  renewalDate: string | null;
  status: 'active' | 'suspended' | 'expired';
}

export interface LicenseRemovalEstimate {
  matched: LicenseInventoryItem[];
  missingIds: string[];
  currencyTotals: Array<{ currency: string; seats: number; monthlyCents: number; annualCents: number }>;
  limitation: string;
}

export interface KnowledgeServicesConfig extends KnowledgeScope {
  databaseUrl: string;
  sanitize: (text: string) => string;
}

export class KnowledgeInputError extends Error {}

type DocumentPart = {
  type: 'document';
  source: { type: 'data'; value: string; mimeType: string };
  sourceName?: string;
};

function normaliseText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeSourceName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\\/]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Slack knowledge upload').slice(0, 255);
}

export function chunkKnowledgeText(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  while (start < text.length) {
    const ceiling = Math.min(text.length, start + CHUNK_CHARS);
    let end = ceiling;
    if (ceiling < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', ceiling), text.lastIndexOf(' ', ceiling));
      if (boundary > start + Math.floor(CHUNK_CHARS / 2)) end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) result.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return result;
}

function asDocumentPart(value: unknown): value is DocumentPart {
  if (!value || typeof value !== 'object') return false;
  const part = value as { type?: unknown; source?: { type?: unknown; value?: unknown; mimeType?: unknown } };
  return part.type === 'document' && part.source?.type === 'data'
    && typeof part.source.value === 'string' && typeof part.source.mimeType === 'string';
}

export function attachedDocuments(parts: readonly unknown[] | undefined): DocumentPart[] {
  return (parts ?? []).filter(asDocumentPart);
}

/**
 * Direct Slack channel callbacks carry message metadata but do not always include file bytes.
 * For an explicitly requested owner upload, retrieve only the exact message from the allowed
 * channel and download its private file URL with the bot token. Nothing is fetched for ordinary
 * conversation turns.
 */
export async function downloadSlackDocuments(input: {
  botToken: string;
  channelId: string;
  rootTs: string;
  messageTs: string;
}): Promise<DocumentPart[]> {
  const historyUrl = new URL('https://slack.com/api/conversations.replies');
  historyUrl.searchParams.set('channel', input.channelId);
  historyUrl.searchParams.set('ts', input.rootTs);
  historyUrl.searchParams.set('limit', '200');
  const history = await fetch(historyUrl, { headers: { Authorization: `Bearer ${input.botToken}` } });
  if (!history.ok) throw new KnowledgeInputError('Slack could not retrieve the uploaded document message.');
  const payload = await history.json() as {
    ok?: boolean;
    messages?: Array<{ ts?: string; files?: Array<{ name?: string; mimetype?: string; url_private?: string; size?: number }> }>;
  };
  const message = payload.ok ? payload.messages?.find((item) => item.ts === input.messageTs) : undefined;
  const files = (message?.files ?? []).slice(0, 5);
  if (files.length === 0) return [];
  const documents: DocumentPart[] = [];
  for (const file of files) {
    if (!file.url_private || !file.mimetype || (file.size !== undefined && file.size > MAX_FILE_BYTES)) continue;
    const response = await fetch(file.url_private, { headers: { Authorization: `Bearer ${input.botToken}` } });
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (!response.ok || (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES)) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) continue;
    documents.push({
      type: 'document',
      source: { type: 'data', value: bytes.toString('base64'), mimeType: file.mimetype },
      sourceName: safeSourceName(file.name ?? 'Slack knowledge upload'),
    });
  }
  return documents;
}

/** A file must be explicitly marked for ingestion; ordinary attachments never become training data. */
export function requestsKnowledgeIngestion(text: string): boolean {
  return /\b(?:add|upload|ingest|save|store)\b[\s\S]{0,80}\b(?:knowledge\s*base|knowledgebase|kb|documentation|docs?)\b/i.test(text)
    || /\b(?:knowledge\s*base|knowledgebase|kb)\b[\s\S]{0,80}\b(?:add|upload|ingest|save|store)\b/i.test(text);
}

async function extractText(part: DocumentPart): Promise<{ text: string; mediaType: string }> {
  const { value, mimeType } = part.source;
  if (value.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 16) {
    throw new KnowledgeInputError('The uploaded document is larger than the 5 MiB knowledge-base limit.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
    throw new KnowledgeInputError('The uploaded document is empty or larger than the 5 MiB knowledge-base limit.');
  }
  const type = mimeType.toLowerCase().split(';', 1)[0] ?? '';
  let text: string;
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    text = extracted.value;
  } else if (
    type.startsWith('text/')
    || type === 'application/json'
    || type === 'application/javascript'
    || type === 'application/xml'
    || type === 'text/csv'
  ) {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } else {
    throw new KnowledgeInputError('Unsupported document type. Upload .txt, .md, .csv, .json, .xml, or Word .docx files.');
  }
  const cleaned = normaliseText(text);
  if (!cleaned) throw new KnowledgeInputError('The uploaded document did not contain readable text.');
  if (cleaned.length > MAX_EXTRACTED_CHARS) {
    throw new KnowledgeInputError('The extracted document text exceeds the 500,000-character knowledge-base limit.');
  }
  return { text: cleaned, mediaType: type };
}

export class KnowledgeServices {
  private readonly pool: pg.Pool;
  private readonly scope: KnowledgeScope;
  private readonly sanitize: (text: string) => string;

  constructor(config: KnowledgeServicesConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 4, statement_timeout: 10_000, application_name: 'accord-knowledge' });
    this.scope = { teamId: config.teamId, channelId: config.channelId };
    this.sanitize = config.sanitize;
  }

  async close(): Promise<void> { await this.pool.end(); }

  async ingestSlackDocument(input: { part: unknown; sourceName: string; uploadedBy: string }): Promise<{ document: KnowledgeDocument; created: boolean }> {
    if (!asDocumentPart(input.part)) throw new KnowledgeInputError('No supported document attachment was received.');
    const extracted = await extractText(input.part);
    const text = normaliseText(this.sanitize(extracted.text));
    if (!text) throw new KnowledgeInputError('The document contained no storable text after secret redaction.');
    if (text.length > MAX_EXTRACTED_CHARS) throw new KnowledgeInputError('The redacted document exceeds the knowledge-base text limit.');
    const digest = createHash('sha256').update(text).digest('hex');
    const existing = await this.pool.query<{ id: string; source_name: string; media_type: string; uploaded_by: string; created_at: Date }>(
      `SELECT id, source_name, media_type, uploaded_by, created_at
       FROM accord_knowledge_documents
       WHERE team_id = $1 AND channel_id = $2 AND content_sha256 = $3`,
      [this.scope.teamId, this.scope.channelId, digest],
    );
    if (existing.rowCount) return { document: documentRow(existing.rows[0]!), created: false };

    const documentId = randomUUID();
    const pieces = chunkKnowledgeText(text);
    if (pieces.length === 0) throw new KnowledgeInputError('The document contained no indexable text.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO accord_knowledge_documents
         (id, team_id, channel_id, source_name, media_type, content_sha256, uploaded_by, extracted_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [documentId, this.scope.teamId, this.scope.channelId, safeSourceName(input.sourceName), extracted.mediaType, digest, input.uploadedBy, text],
      );
      for (const [index, content] of pieces.entries()) {
        await client.query(
          `INSERT INTO accord_knowledge_chunks (id, document_id, chunk_index, content)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), documentId, index, content],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return {
      created: true,
      document: { id: documentId, sourceName: safeSourceName(input.sourceName), mediaType: extracted.mediaType, uploadedBy: input.uploadedBy, createdAt: new Date().toISOString(), chunkCount: pieces.length },
    };
  }

  async listDocuments(limit = 20): Promise<KnowledgeDocument[]> {
    const result = await this.pool.query<{ id: string; source_name: string; media_type: string; uploaded_by: string; created_at: Date; chunk_count: string }>(
      `SELECT d.id, d.source_name, d.media_type, d.uploaded_by, d.created_at, count(c.id) AS chunk_count
       FROM accord_knowledge_documents d
       LEFT JOIN accord_knowledge_chunks c ON c.document_id = d.id
       WHERE d.team_id = $1 AND d.channel_id = $2
       GROUP BY d.id
       ORDER BY d.created_at DESC
       LIMIT $3`,
      [this.scope.teamId, this.scope.channelId, Math.min(Math.max(limit, 1), 50)],
    );
    return result.rows.map(documentRow);
  }

  async search(query: string, limit = MAX_SEARCH_RESULTS): Promise<KnowledgeHit[]> {
    const cleaned = query.trim().slice(0, 500);
    if (cleaned.length < 2) throw new KnowledgeInputError('Use at least two characters when searching the knowledge base.');
    const result = await this.pool.query<{ id: string; source_name: string; chunk_index: number; content: string; score: string; created_at: Date }>(
      `WITH terms AS (SELECT websearch_to_tsquery('english', $3) AS value)
       SELECT d.id, d.source_name, c.chunk_index, c.content,
              ts_rank_cd(c.search_vector, terms.value)::text AS score, d.created_at
       FROM accord_knowledge_documents d
       JOIN accord_knowledge_chunks c ON c.document_id = d.id
       CROSS JOIN terms
       WHERE d.team_id = $1 AND d.channel_id = $2 AND c.search_vector @@ terms.value
       ORDER BY ts_rank_cd(c.search_vector, terms.value) DESC, d.created_at DESC, c.chunk_index ASC
       LIMIT $4`,
      [this.scope.teamId, this.scope.channelId, cleaned, Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS)],
    );
    return result.rows.map((row) => ({
      documentId: row.id,
      sourceName: row.source_name,
      chunkIndex: row.chunk_index,
      excerpt: row.content.length > 1_000 ? `${row.content.slice(0, 1_000)}…[truncated]` : row.content,
      score: Number(row.score),
      createdAt: row.created_at.toISOString(),
    }));
  }

  async listLicenses(query: string, includeInactive: boolean): Promise<LicenseInventoryItem[]> {
    const needle = query.trim().slice(0, 160);
    const result = await this.pool.query<LicenseRow>(
      `SELECT id, vendor, product, sku, unit_cost_cents, active_seats, assigned_seats, currency, renewal_date, status
       FROM accord_license_inventory
       WHERE team_id = $1 AND channel_id = $2
         AND ($3::text = '' OR vendor ILIKE '%' || $3 || '%' OR product ILIKE '%' || $3 || '%' OR sku ILIKE '%' || $3 || '%')
         AND ($4::boolean OR status = 'active')
       ORDER BY vendor, product, sku
       LIMIT 50`,
      [this.scope.teamId, this.scope.channelId, needle, includeInactive],
    );
    return result.rows.map(licenseRow);
  }

  async estimateLicenseRemoval(ids: readonly string[]): Promise<LicenseRemovalEstimate> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 20);
    if (unique.length === 0) throw new KnowledgeInputError('Select at least one licence inventory ID before requesting an estimate.');
    const result = await this.pool.query<LicenseRow>(
      `SELECT id, vendor, product, sku, unit_cost_cents, active_seats, assigned_seats, currency, renewal_date, status
       FROM accord_license_inventory
       WHERE team_id = $1 AND channel_id = $2 AND id = ANY($3::uuid[]) AND status = 'active'
       ORDER BY vendor, product, sku`,
      [this.scope.teamId, this.scope.channelId, unique],
    );
    const matched = result.rows.map(licenseRow);
    const found = new Set(matched.map((row) => row.id));
    const totals = new Map<string, { currency: string; seats: number; monthlyCents: number; annualCents: number }>();
    for (const row of matched) {
      const current = totals.get(row.currency) ?? { currency: row.currency, seats: 0, monthlyCents: 0, annualCents: 0 };
      const monthlyCents = row.unitCostCents * row.activeSeats;
      current.seats += row.activeSeats;
      current.monthlyCents += monthlyCents;
      current.annualCents += monthlyCents * 12;
      totals.set(row.currency, current);
    }
    return {
      matched,
      missingIds: unique.filter((id) => !found.has(id)),
      currencyTotals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      limitation: 'Estimate only: it assumes every active seat in the selected inventory rows can be removed. It does not cancel licences, apply contract minimums, taxes, proration, exchange rates, or renewal penalties.',
    };
  }
}

type LicenseRow = {
  id: string; vendor: string; product: string; sku: string; unit_cost_cents: number;
  active_seats: number; assigned_seats: number; currency: string; renewal_date: Date | null;
  status: 'active' | 'suspended' | 'expired';
};

function documentRow(row: { id: string; source_name: string; media_type: string; uploaded_by: string; created_at: Date; chunk_count?: string }): KnowledgeDocument {
  return {
    id: row.id,
    sourceName: row.source_name,
    mediaType: row.media_type,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
    ...(row.chunk_count === undefined ? {} : { chunkCount: Number(row.chunk_count) }),
  };
}

function licenseRow(row: LicenseRow): LicenseInventoryItem {
  return {
    id: row.id, vendor: row.vendor, product: row.product, sku: row.sku,
    unitCostCents: row.unit_cost_cents, activeSeats: row.active_seats, assignedSeats: row.assigned_seats,
    currency: row.currency, renewalDate: row.renewal_date?.toISOString().slice(0, 10) ?? null, status: row.status,
  };
}
