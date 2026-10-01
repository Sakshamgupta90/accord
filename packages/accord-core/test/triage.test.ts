/** Autonomous triage: prefilter, enrollment gate, provider adapter and configuration. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccordError, publicError } from '@accord/contracts';
import type { TriagePort, TriageResult } from '@accord/contracts';
import { createApplication, createOpenAITriage, loadTriageConfig, mayProposeRetentionPolicy } from '../src/index.js';
import { BOT, ENGINEER, THREAD, baseDeps, fixedClock, inbound, message, silentLogger, testPrivacy } from './harness.js';

function fakeTriage(reply: TriageResult | Error): TriagePort & { calls: number } {
  const port = {
    calls: 0,
    async triage(): Promise<TriageResult> {
      port.calls += 1;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return port;
}

const PROPOSED: TriageResult = { classification: 'policy_proposed', confidence: 0.92, rationale: 'Concrete retention rule.' };

function triageDeps(reply: TriageResult | Error, minConfidence = 0.75) {
  const port = fakeTriage(reply);
  return { deps: { ...baseDeps(), triage: { port, minConfidence } }, port };
}

test('the prefilter passes concrete retention proposals and drops chatter and questions', () => {
  for (const text of [
    "Let's keep free-tier logs for 30 days.",
    'Agreed: purge inactive accounts after a year.',
    'ok, 90 days it is for audit events',
    'Can we set a TTL on session rows?',
  ]) assert.equal(mayProposeRetentionPolicy(text), true, text);
  for (const text of [
    'Are we still getting pizza for lunch?',
    'Where is the retention job implemented?',
    'lgtm',
    'x'.repeat(5_000) + ' delete',
  ]) assert.equal(mayProposeRetentionPolicy(text), false, text);
});

test('a confident policy_proposed enrolls the thread once and schedules the context job', async () => {
  const { deps, port } = triageDeps(PROPOSED);
  const application = createApplication(deps);
  assert.ok(application.triageEvent);

  const outcome = await application.triageEvent(inbound("Let's keep free-tier logs for 30 days.", { authorId: ENGINEER }));
  assert.equal(outcome.enrolled, true);
  assert.equal(outcome.receipt.accepted, true);
  assert.equal(outcome.triage?.classification, 'policy_proposed');
  assert.equal(port.calls, 1);
  assert.equal(deps.scheduler.dispatched.length, 1);
  assert.equal((await deps.store.getThreadView(THREAD)).enrolled, true);

  // The thread is now enrolled: the next message is accepted without another model call or card.
  const next = await application.triageEvent(inbound('and 90 days for paid accounts', { authorId: ENGINEER }));
  assert.equal(next.receipt.accepted, true);
  assert.equal(next.enrolled, false);
  assert.equal(port.calls, 1);
  assert.equal((await application.acceptEvent(inbound('sounds good', { authorId: ENGINEER }))).accepted, true);
});

test('below-threshold, exploratory and failed classifications leave the thread unenrolled', async () => {
  for (const reply of [
    { ...PROPOSED, confidence: 0.5 },
    { classification: 'exploratory', confidence: 0.95, rationale: 'Only an idea.' } as TriageResult,
    new AccordError(publicError('RATE_LIMIT', 'limited')),
  ]) {
    const { deps } = triageDeps(reply);
    const outcome = await createApplication(deps).triageEvent!(inbound("Let's keep free-tier logs for 30 days."));
    assert.equal(outcome.enrolled, false);
    assert.equal(outcome.receipt.accepted, false);
    assert.equal(deps.scheduler.dispatched.length, 0);
    assert.equal((await deps.store.getThreadView(THREAD)).enrolled, false);
    if (reply instanceof Error) assert.ok(deps.logger.events.includes('error:triage_failed'));
  }
});

test('the prefilter and own-bot check run before any model call', async () => {
  const { deps, port } = triageDeps(PROPOSED);
  const application = createApplication(deps);
  assert.equal((await application.triageEvent!(inbound('Are we still getting pizza?'))).receipt.reason, 'triage prefilter');
  assert.equal((await application.triageEvent!(inbound("Let's keep logs for 30 days.", { authorId: BOT }))).receipt.reason, 'own bot message');
  assert.equal(port.calls, 0);
});

test('without triage configured the application exposes no autonomous entry', () => {
  assert.equal(createApplication(baseDeps()).triageEvent, undefined);
});

function stubFetch(reply: unknown, finishReason = 'stop'): { restore: () => void; bodies: Record<string, unknown>[] } {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    const content = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }), { headers: { 'content-type': 'application/json' } });
  };
  return { restore: () => { globalThis.fetch = original; }, bodies };
}

const deps = () => ({ privacy: testPrivacy(), clock: fixedClock(), logger: silentLogger() });

test('the Gemini triage adapter sends thread context and validates the classification', async () => {
  const stub = stubFetch(PROPOSED);
  try {
    const triage = createOpenAITriage({ provider: 'google', apiKey: 'test-key', model: 'gemini-3.1-flash-lite' }, deps());
    const earlier = message('Logs are 2TB now.', ENGINEER);
    const target = message('ok, 30 days for debug logs', ENGINEER);
    const result = await triage.triage({ message: target, context: [earlier, target] });
    assert.deepEqual(result, PROPOSED);
    const body = stub.bodies[0]!;
    assert.equal(body.model, 'gemini-3.1-flash-lite');
    const user = (body.messages as { content: string }[])[1]!.content;
    assert.match(user, /Logs are 2TB now/);
    assert.match(user, /TARGET message[\s\S]*30 days for debug logs/);
  } finally { stub.restore(); }
});

test('the triage adapter rejects malformed, out-of-range and truncated output', async () => {
  for (const [reply, finish, code] of [
    ['not json', 'stop', 'INVALID_INPUT'],
    [{ ...PROPOSED, confidence: 7 }, 'stop', 'INVALID_INPUT'],
    [{ ...PROPOSED, extra: true }, 'stop', 'INVALID_INPUT'],
    [PROPOSED, 'length', 'PROVIDER_ERROR'],
  ] as const) {
    const stub = stubFetch(reply, finish);
    try {
      const triage = createOpenAITriage({ provider: 'google', apiKey: 'test-key', model: 'm' }, deps());
      await assert.rejects(
        () => triage.triage({ message: message("let's keep logs 30 days"), context: [] }),
        (error: unknown) => error instanceof AccordError && error.public.code === code,
      );
    } finally { stub.restore(); }
  }
});

test('triage configuration defaults on, follows the interpretation provider and validates its floor', () => {
  const base = { ACCORD_MODEL: 'gemini-3.5-flash', GOOGLE_API_KEY: 'test-key' };
  const defaults = loadTriageConfig(base)!;
  assert.equal(defaults.model.model, 'gemini-3.5-flash');
  assert.equal(defaults.model.provider, 'google');
  assert.equal(defaults.minConfidence, 0.75);
  assert.equal(loadTriageConfig({ ...base, ACCORD_TRIAGE_MODEL: 'gemini-3.1-flash-lite' })!.model.model, 'gemini-3.1-flash-lite');
  assert.equal(loadTriageConfig({ ...base, ACCORD_TRIAGE: 'off' }), null);
  assert.throws(() => loadTriageConfig({ ...base, ACCORD_TRIAGE_MIN_CONFIDENCE: '2' }), /between 0 and 1/);
  assert.throws(() => loadTriageConfig({ ...base, ACCORD_TRIAGE: 'maybe' }), /on or off/);
});
