/** Ingress transaction and thread reads.
 * acceptEvent performs no network or model work: durable acceptance happens first.
 */
import { randomUUID } from 'node:crypto';
import type { InboundEvent, ThreadRef, ThreadView } from '@accord/contracts';
import type { Database, Queryable } from './client.js';
import { toDecision, toFinding, toInboundEvent, toJobIntent, toThreadRow } from './rows.js';
import type { RawDecision, RawJobIntent, RawThread } from './rows.js';
import type { AcceptedEvent, AcceptEventOptions, ThreadRow } from './types.js';

const THREAD_COLUMNS = 'id, team_id, channel_id, root_ts, enrolled, context_revision, active_decision_id, active_version, finding_message_ts';

export function contextJobKey(threadId: string, contextRevision: number): string {
  return `context:${threadId}:${contextRevision}`;
}

export async function getThreadRow(db: Queryable, thread: ThreadRef): Promise<ThreadRow | null> {
  const result = await db.query<RawThread>(
    `SELECT ${THREAD_COLUMNS} FROM threads WHERE team_id = $1 AND channel_id = $2 AND root_ts = $3`,
    [thread.teamId, thread.channelId, thread.rootTs],
  );
  const row = result.rows[0];
  return row ? toThreadRow(row) : null;
}

export async function getThreadRowById(db: Queryable, threadId: string): Promise<ThreadRow | null> {
  const result = await db.query<RawThread>(`SELECT ${THREAD_COLUMNS} FROM threads WHERE id = $1`, [threadId]);
  const row = result.rows[0];
  return row ? toThreadRow(row) : null;
}

/** Reading an unknown thread must not create it. */
export async function getThreadView(db: Queryable, thread: ThreadRef): Promise<ThreadView> {
  const row = await getThreadRow(db, thread);
  if (!row) {
    return { thread, enrolled: false, contextRevision: 0, decision: null, finding: null, publicationPending: false };
  }

  const decisionResult = row.activeDecisionId && row.activeVersion !== null
    ? await db.query<RawDecision>(
      `SELECT d.decision_id, d.version, t.team_id, t.channel_id, t.root_ts, d.context_revision, d.status,
              d.intent, d.intent_hash, d.owner_id, d.confirmed_by, d.confirmed_at, d.source_message_ids,
              d.created_at, d.updated_at
         FROM decision_versions d JOIN threads t ON t.id = d.thread_id
        WHERE d.decision_id = $1 AND d.version = $2`,
      [row.activeDecisionId, row.activeVersion],
    )
    : null;

  const findingResult = await db.query<{ payload: unknown }>(
    'SELECT payload FROM findings WHERE thread_id = $1 ORDER BY revision DESC LIMIT 1',
    [row.id],
  );

  const pendingResult = await db.query<{ pending: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM outbox
        WHERE thread_id = $1 AND status IN ('pending', 'sending', 'retryable', 'uncertain')
     ) AS pending`,
    [row.id],
  );

  const decisionRow = decisionResult?.rows[0];
  const findingRow = findingResult.rows[0];
  return {
    thread: row.thread,
    enrolled: row.enrolled,
    contextRevision: row.contextRevision,
    decision: decisionRow ? toDecision(decisionRow) : null,
    finding: findingRow ? toFinding(findingRow.payload) : null,
    publicationPending: pendingResult.rows[0]?.pending ?? false,
  };
}

/**
 * Durable acceptance in one transaction:
 * dedupe by event key, enroll on a verified mention (or an explicit triage enrollment),
 * increment the context revision, persist the sanitized snapshot, create exactly one context
 * job intent, and fence older work. Dispatch to Trigger.dev happens after the commit, never inside it.
 */
export async function acceptEvent(db: Database, event: InboundEvent, options: AcceptEventOptions = {}): Promise<AcceptedEvent> {
  return db.transaction(async (tx) => {
    const existing = await tx.query<RawThread>(
      `SELECT ${THREAD_COLUMNS} FROM threads
        WHERE team_id = $1 AND channel_id = $2 AND root_ts = $3 FOR UPDATE`,
      [event.thread.teamId, event.thread.channelId, event.thread.rootTs],
    );
    let row = existing.rows[0] ? toThreadRow(existing.rows[0]) : null;
    let enrolled = false;

    if (!row || !row.enrolled) {
      // An unenrolled thread is only entered through a verified mention or an application-level
      // triage decision. Other messages in unenrolled threads are ignored and create no state.
      if (!event.wasMention && !options.enroll) {
        return { accepted: false, duplicate: false, enrolled: false, reason: 'thread not enrolled', threadId: row?.id ?? null, contextRevision: row?.contextRevision ?? null, jobIntent: null };
      }
      enrolled = true;
      if (!row) {
        const inserted = await tx.query<RawThread>(
          `INSERT INTO threads (id, team_id, channel_id, root_ts, enrolled)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (team_id, channel_id, root_ts) DO UPDATE SET enrolled = true, updated_at = now()
           RETURNING ${THREAD_COLUMNS}`,
          [randomUUID(), event.thread.teamId, event.thread.channelId, event.thread.rootTs],
        );
        row = toThreadRow(inserted.rows[0]!);
      } else {
        await tx.query('UPDATE threads SET enrolled = true, updated_at = now() WHERE id = $1', [row.id]);
        row = { ...row, enrolled: true };
      }
    }

    const nextRevision = row.contextRevision + 1;

    // The unique event key is the dedupe authority. A duplicate changes nothing at all.
    const insertedEvent = await tx.query<{ event_key: string }>(
      `INSERT INTO inbound_events (event_key, thread_id, payload, context_revision, status)
       VALUES ($1, $2, $3::jsonb, $4, 'accepted')
       ON CONFLICT (event_key) DO NOTHING
       RETURNING event_key`,
      [event.eventKey, row.id, JSON.stringify(event), nextRevision],
    );
    if (insertedEvent.rows.length === 0) {
      return { accepted: true, duplicate: true, enrolled: false, reason: 'duplicate event', threadId: row.id, contextRevision: row.contextRevision, jobIntent: null };
    }

    await tx.query('UPDATE threads SET context_revision = $2, updated_at = now() WHERE id = $1', [row.id, nextRevision]);

    const intent = await tx.query<RawJobIntent>(
      `INSERT INTO job_intents (id, logical_key, task_type, payload, status)
       VALUES ($1, $2, 'accord-process-context', $3::jsonb, 'pending')
       ON CONFLICT (logical_key) DO NOTHING
       RETURNING id, logical_key, task_type, payload, status, trigger_run_id, attempts, next_attempt_at`,
      [
        randomUUID(),
        contextJobKey(row.id, nextRevision),
        JSON.stringify({ threadId: row.id, eventKey: event.eventKey, contextRevision: nextRevision }),
      ],
    );

    // Fence queued and running investigations from an older revision. No model call is killed
    // inside the transaction: the old run simply cannot become current afterwards.
    await tx.query(
      `UPDATE investigations SET status = 'superseded', updated_at = now()
        WHERE thread_id = $1 AND context_revision < $2
          AND status NOT IN ('completed', 'superseded', 'failed', 'cancelled')`,
      [row.id, nextRevision],
    );

    const intentRow = intent.rows[0];
    return {
      accepted: true,
      duplicate: false,
      enrolled,
      reason: null,
      threadId: row.id,
      contextRevision: nextRevision,
      jobIntent: intentRow ? toJobIntent(intentRow) : null,
    };
  });
}

export async function markEventProcessed(db: Queryable, eventKey: string): Promise<void> {
  await db.query(
    `UPDATE inbound_events SET status = 'processed', processed_at = now() WHERE event_key = $1`,
    [eventKey],
  );
}

export async function readEvent(db: Queryable, eventKey: string) {
  const result = await db.query<{ payload: unknown }>('SELECT payload FROM inbound_events WHERE event_key = $1', [eventKey]);
  const row = result.rows[0];
  return row ? toInboundEvent(row.payload) : null;
}
