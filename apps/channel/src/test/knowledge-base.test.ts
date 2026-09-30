import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { attachedDocuments, chunkKnowledgeText, downloadSlackDocuments, requestsKnowledgeIngestion } from '../knowledge-base.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('knowledge ingestion requires an explicit upload request', () => {
  for (const text of [
    '@Accord add this to the knowledge base',
    'Please upload this document to KB',
    'Store these docs in the knowledge base.',
  ]) assert.equal(requestsKnowledgeIngestion(text), true, text);

  for (const text of [
    'Can you explain the legacy Pascal cleanup routine?',
    'The knowledge base should probably be updated someday.',
    'Here is a file for review.',
  ]) assert.equal(requestsKnowledgeIngestion(text), false, text);
});

test('only document data attachments are candidates for knowledge ingestion', () => {
  const parts = attachedDocuments([
    { type: 'text', text: 'not a document' },
    { type: 'document', source: { type: 'data', value: 'aGVsbG8=', mimeType: 'text/plain' } },
    { type: 'document', source: { type: 'url', value: 'https://example.test', mimeType: 'text/plain' } },
  ]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.source.mimeType, 'text/plain');
});

test('explicit Slack uploads retrieve only the exact thread message files', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const value = String(url);
    seen.push(value);
    if (value.startsWith('https://slack.com/api/conversations.replies')) {
      return new Response(JSON.stringify({ ok: true, messages: [
        { ts: '1.000', files: [{ name: 'wrong.txt', mimetype: 'text/plain', url_private: 'https://files.test/wrong' }] },
        { ts: '2.000', files: [{ name: 'legacy.md', mimetype: 'text/markdown', url_private: 'https://files.test/right', size: 12 }] },
      ] }), { status: 200 });
    }
    if (value === 'https://files.test/right') return new Response('Delphi ownership notes', { status: 200 });
    throw new Error(`unexpected fetch ${value}`);
  }) as typeof fetch;

  const files = await downloadSlackDocuments({ botToken: 'xoxb-test', channelId: 'C1', rootTs: '1.000', messageTs: '2.000' });
  assert.equal(files.length, 1);
  assert.equal(files[0]?.sourceName, 'legacy.md');
  assert.equal(Buffer.from(files[0]!.source.value, 'base64').toString('utf8'), 'Delphi ownership notes');
  assert.equal(seen.some((url) => url === 'https://files.test/wrong'), false);
});

test('knowledge chunking is bounded, deterministic and overlap-aware', () => {
  const text = `${'legacy Delphi ownership rules '.repeat(55)}\n${'Pascal compatibility notes '.repeat(55)}`;
  const first = chunkKnowledgeText(text);
  const second = chunkKnowledgeText(text);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first.every((chunk) => chunk.length <= 1_100 && chunk.length > 0));
  assert.ok(first.slice(0, -1).every((chunk, index) => first[index + 1]!.includes(chunk.slice(-40).trim().split(/\s+/)[0]!)));
});
