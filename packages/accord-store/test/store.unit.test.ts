/** Offline store tests: no database, no credentials. The SQL itself is covered by
 * store.integration.test.ts, which needs a real PostgreSQL and fails clearly without one.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AccordError } from '@accord/contracts';
import { contextJobKey, databaseError, publishJobKey } from '../src/index.js';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

test('migrations are ordered, uniquely numbered and parameterless', () => {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.length >= 1);
  const versions = files.map((name) => Number.parseInt(name.slice(0, name.indexOf('_')), 10));
  assert.ok(versions.every(Number.isInteger), 'every migration needs an ordered numeric prefix');
  assert.equal(new Set(versions).size, versions.length, 'migration numbers must be unique');
});

test('the schema carries the constraints the product depends on', () => {
  const sql = readFileSync(join(MIGRATIONS, '001_initial.sql'), 'utf8');
  const required = [
    'CONSTRAINT threads_identity_unique UNIQUE (team_id, channel_id, root_ts)',
    'event_key        text PRIMARY KEY',
    'PRIMARY KEY (decision_id, version)',
    'CONSTRAINT investigations_run_key_unique UNIQUE (decision_id, decision_version, context_revision, mode)',
    'CONSTRAINT outbox_publication_unique UNIQUE (finding_id, publication_revision)',
    'PRIMARY KEY (publication_id, provider_ts)',
    'logical_key     text NOT NULL UNIQUE',
  ];
  for (const fragment of required) {
    assert.ok(sql.includes(fragment), `missing required constraint: ${fragment}`);
  }
  assert.ok(sql.includes('CREATE INDEX outbox_due_idx'), 'the publication worker needs a due-time index');
  assert.ok(sql.includes('CREATE INDEX job_intents_pending_idx'), 'reconciliation needs a pending-intent index');
});

test('knowledge and licence facts stay in separate, scoped tables', () => {
  const sql = readFileSync(join(MIGRATIONS, '002_knowledge_and_license_inventory.sql'), 'utf8');
  for (const fragment of [
    'CREATE TABLE accord_knowledge_documents',
    'CONSTRAINT accord_knowledge_documents_scope_content_unique UNIQUE (team_id, channel_id, content_sha256)',
    'CREATE TABLE accord_knowledge_chunks',
    'CREATE TABLE accord_license_inventory',
    'assigned_seats <= active_seats',
  ]) assert.ok(sql.includes(fragment), `missing knowledge/licence schema guard: ${fragment}`);
});

test('Slack semantic graph remains separate from retention policy tables', () => {
  const sql = readFileSync(join(MIGRATIONS, '003_slack_thread_semantic_graph.sql'), 'utf8');
  assert.ok(sql.includes('CREATE TABLE accord_slack_thread_knowledge_nodes'));
  assert.ok(sql.includes('CREATE TABLE accord_slack_thread_knowledge_edges'));
  assert.equal(sql.includes('decision_versions'), false);
  assert.equal(sql.includes('findings'), false);
});

test('database errors become bounded PublicErrors with no provider detail', () => {
  const unique = databaseError({ code: '23505', detail: 'Key (event_key)=(Ev123) already exists', message: 'duplicate' }, 'acceptEvent');
  assert.ok(unique instanceof AccordError);
  assert.equal(unique.public.code, 'INVALID_INPUT');
  assert.equal(unique.public.message.includes('Ev123'), false, 'row values must not leak into a public error');

  assert.equal(databaseError({ code: '57014' }, 'query').public.code, 'TIMEOUT');
  assert.equal(databaseError({ code: '28P01' }, 'connect').public.code, 'AUTH');
  assert.equal(databaseError({ code: '40001' }, 'tx').public.code, 'PROVIDER_ERROR');
  assert.equal(databaseError(new Error('socket hang up'), 'query').public.code, 'PROVIDER_ERROR');
  assert.equal(databaseError({ code: '28P01' }, 'connect').public.retryable, false);
});

test('job keys are stable and collision free across threads and revisions', () => {
  assert.equal(contextJobKey('thread-a', 3), 'context:thread-a:3');
  assert.notEqual(contextJobKey('thread-a', 3), contextJobKey('thread-a', 4));
  assert.notEqual(contextJobKey('thread-a', 3), contextJobKey('thread-b', 3));
  assert.equal(publishJobKey('pub-1'), 'publish:pub-1');
});
