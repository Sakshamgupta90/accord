import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS } from '@accord/contracts';
import { threadHistory } from '../channel.js';

const inbound = { ts: '1757635200.000900', authorId: 'U0ENGINEER', text: 'ok, 30 days for debug logs' };

test('triage history keeps earlier human messages and always ends with the inbound message', async () => {
  const thread = {
    getMessages: async () => [
      { ts: '1757635200.000100', text: 'Debug logs are 2TB now', user: { id: 'U0OWNER' } },
      { ts: '1757635200.000200', text: 'bot noise', isBot: true },
      { ts: '1757635200.000300', text: 'no author' },
      { ts: '1757635200.000900', text: 'ok, 30 days for debug logs', user: { id: 'U0ENGINEER' } },
      { ts: '1757635200.000950', text: 'a later reply', user: { id: 'U0OWNER' } },
    ],
  };
  const { history, complete } = await threadHistory(thread, inbound);
  assert.deepEqual(history.map((m) => m.text), ['Debug logs are 2TB now', 'ok, 30 days for debug logs']);
  assert.equal(complete, true);
});

test('triage history fits one snapshot and degrades to the inbound message when history fails', async () => {
  const big = 'x'.repeat(LIMITS.messageText);
  const many = Array.from({ length: 5 }, (_, i) => ({ ts: `1757635200.00010${i}`, text: big, user: { id: 'U0OWNER' } }));
  const capped = await threadHistory({ getMessages: async () => many }, inbound);
  assert.ok(capped.history.reduce((sum, m) => sum + m.text.length, 0) <= LIMITS.snapshotCharacters);
  assert.equal(capped.history.at(-1)!.ts, inbound.ts);
  assert.equal(capped.complete, false);

  const failed = await threadHistory({ getMessages: async () => { throw new Error('missing scope'); } }, inbound);
  assert.deepEqual(failed.history, [inbound]);
});
