import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TraceHub, traceTools, type TraceEvent } from '../trace.js';

const redact = (text: string) => text.replace(/sk-[a-z0-9]+/gi, '[REDACTED]');

test('a turn records nodes in order, redacts text and streams every change', () => {
  const hub = new TraceHub(redact);
  const events: TraceEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const id = hub.start({ conversationKey: 'C1::1.2', message: 'key sk-abc123 leaked?', actor: 'Team member', channel: 'Team channel' });
  hub.node(id, { id: 'message', lane: 'trigger', icon: 'message', title: 'Message received', status: 'done', summary: 'sk-zzz9' });
  hub.node(id, { id: 'agent', lane: 'understand', icon: 'gemini.svg', title: 'Accord agent' });
  hub.node(id, { id: 'agent', lane: 'understand', icon: 'gemini.svg', title: 'Accord agent', status: 'done' });

  const [invocation] = hub.snapshot();
  assert.equal(invocation.message, 'key [REDACTED] leaked?');
  assert.deepEqual(invocation.nodes.map((n) => [n.id, n.status]), [['message', 'done'], ['agent', 'done']]);
  assert.equal(invocation.nodes[0].summary, '[REDACTED]');
  assert.ok(invocation.nodes[1].endedAt);
  assert.deepEqual(events.map((e) => e.type), ['invocation', 'node', 'node', 'node']);
});

test('wrapped tools return the original result and become trace nodes', async () => {
  const hub = new TraceHub(redact);
  const id = hub.start({ conversationKey: 'C1::9.9', message: 'who changed it?', actor: 'Team member', channel: 'Team channel' });
  const [tool] = traceTools(hub, [{ name: 'read_repo_file', handler: async (args: { path: string }) => ({ path: args.path, lines: '1-5 of 9', link: 'https://github.com/a/b/blob/x/f.ts#L1-L5' }) }]);
  const result = await (tool.handler as (a: unknown, c: unknown) => Promise<unknown>)({ path: 'f.ts', startLine: 1, endLine: 5 }, { thread: { conversationKey: 'C1::9.9' } });
  assert.deepEqual(result, { path: 'f.ts', lines: '1-5 of 9', link: 'https://github.com/a/b/blob/x/f.ts#L1-L5' });
  const node = hub.snapshot()[0].nodes.find((n) => n.id.startsWith('read_repo_file'))!;
  assert.equal(node.status, 'done');
  assert.equal(node.lane, 'knowledge');
  assert.equal(node.items[0].href, 'https://github.com/a/b/blob/x/f.ts#L1-L5');
  assert.equal(id, hub.snapshot()[0].id);
});

test('a failing listener never breaks tracing, and tools outside a traced turn still run', async () => {
  const hub = new TraceHub(redact);
  hub.subscribe(() => { throw new Error('listener down'); });
  const id = hub.start({ conversationKey: 'k', message: 'x', actor: 'a', channel: 'c' });
  assert.doesNotThrow(() => hub.node(id, { id: 'n', lane: 'trigger', icon: 'message', title: 't' }));
  const [tool] = traceTools(hub, [{ name: 'list_issues', handler: async () => 'There are no open issues.' }]);
  assert.equal(await (tool.handler as (a: unknown, c: unknown) => Promise<unknown>)({}, {}), 'There are no open issues.');
});
