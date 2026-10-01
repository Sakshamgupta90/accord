/** @accord/channel — live invocation traces.
 * Records what Accord actually does each time it is triggered (accepted event, tool calls and what
 * they read, the durable decision pipeline as it progresses) and streams those steps to the
 * dashboard. In-memory only: it holds the latest invocations of this bridge process. Text is
 * redacted, Slack user ids are never exposed, and nothing here influences Accord's behaviour.
 */
import { randomUUID } from 'node:crypto';
import type { ApplicationPort, ThreadRef, ThreadView } from '@accord/contracts';

export type TraceLane = 'trigger' | 'understand' | 'knowledge' | 'verify' | 'respond';
export type TraceStatus = 'running' | 'done' | 'error' | 'skipped';

export interface TraceItem { label: string; detail?: string; href?: string }

export interface TraceNode {
  id: string;
  lane: TraceLane;
  title: string;
  subtitle: string;
  /** Key of a logo in the dashboard's /logos folder, or a generic icon name. */
  icon: string;
  status: TraceStatus;
  startedAt: string;
  endedAt: string | null;
  summary: string;
  facts: Array<[string, string]>;
  items: TraceItem[];
}

export interface TraceInvocation {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: 'running' | 'done' | 'error';
  message: string;
  actor: string;
  channel: string;
  nodes: TraceNode[];
}

export type TraceEvent =
  | { type: 'invocation'; invocation: TraceInvocation }
  | { type: 'node'; invocationId: string; node: TraceNode }
  | { type: 'end'; invocationId: string; status: 'done' | 'error'; endedAt: string };

const MAX_INVOCATIONS = 20;
const MAX_TEXT = 280;
const WATCH_INTERVAL_MS = 1500;
const WATCH_LIMIT_MS = 150_000;
/** With no decision change by then, the message was a question rather than a decision. */
const QUIET_LIMIT_MS = 25_000;
const SETTLE_MS = 4000;

const now = () => new Date().toISOString();
const clip = (text: string, limit = MAX_TEXT) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

export class TraceHub {
  private readonly invocations: TraceInvocation[] = [];
  private readonly listeners = new Set<(event: TraceEvent) => void>();
  /** conversationKey -> invocation currently running in that conversation. */
  private readonly active = new Map<string, string>();
  private readonly settleTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly redact: (text: string) => string) {}

  snapshot(): TraceInvocation[] {
    return this.invocations.map((invocation) => ({ ...invocation, nodes: [...invocation.nodes] }));
  }

  subscribe(listener: (event: TraceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(input: { conversationKey: string; message: string; actor: string; channel: string }): string {
    const invocation: TraceInvocation = {
      id: randomUUID(),
      startedAt: now(),
      endedAt: null,
      status: 'running',
      message: clip(this.redact(input.message)),
      actor: input.actor,
      channel: input.channel,
      nodes: [],
    };
    this.invocations.unshift(invocation);
    this.invocations.length = Math.min(this.invocations.length, MAX_INVOCATIONS);
    this.active.set(input.conversationKey, invocation.id);
    this.emit({ type: 'invocation', invocation: { ...invocation, nodes: [] } });
    return invocation.id;
  }

  invocationFor(conversationKey: string): string | null {
    return this.active.get(conversationKey) ?? null;
  }

  /** Adds a node, or updates it when the id already exists. Returns the node id. */
  node(invocationId: string, node: Partial<TraceNode> & Pick<TraceNode, 'id' | 'lane' | 'title' | 'icon'>): string {
    const invocation = this.invocations.find((item) => item.id === invocationId);
    if (!invocation) return node.id;
    const existing = invocation.nodes.find((item) => item.id === node.id);
    const merged: TraceNode = {
      subtitle: '',
      status: 'running',
      startedAt: existing?.startedAt ?? now(),
      endedAt: null,
      summary: '',
      facts: [],
      items: [],
      ...existing,
      ...node,
    };
    if (merged.status !== 'running' && !merged.endedAt) merged.endedAt = now();
    merged.summary = clip(this.redact(merged.summary), 600);
    merged.facts = merged.facts.map(([key, value]) => [key, clip(this.redact(value), 200)]);
    merged.items = merged.items.slice(0, 12).map((item) => ({ ...item, label: clip(this.redact(item.label), 160), detail: item.detail ? clip(this.redact(item.detail), 200) : undefined }));
    if (existing) Object.assign(existing, merged);
    else invocation.nodes.push(merged);
    this.emit({ type: 'node', invocationId, node: merged });
    this.scheduleSettle(invocation);
    return merged.id;
  }

  end(invocationId: string, status: 'done' | 'error' = 'done') {
    const invocation = this.invocations.find((item) => item.id === invocationId);
    if (!invocation || invocation.status !== 'running') return;
    invocation.status = status;
    invocation.endedAt = now();
    for (const [key, id] of this.active) if (id === invocationId) this.active.delete(key);
    this.emit({ type: 'end', invocationId, status, endedAt: invocation.endedAt });
  }

  /** An invocation ends once nothing is running and no new step has arrived for a few seconds. */
  private scheduleSettle(invocation: TraceInvocation) {
    clearTimeout(this.settleTimers.get(invocation.id));
    this.settleTimers.set(invocation.id, setTimeout(() => {
      if (!invocation.nodes.some((node) => node.status === 'running')) this.end(invocation.id, invocation.nodes.some((n) => n.status === 'error') ? 'error' : 'done');
    }, SETTLE_MS));
  }

  private emit(event: TraceEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must never affect Accord.
      }
    }
  }
}

/** A short, human summary of a tool result for the trace. Never the raw payload. */
function summarizeResult(name: string, result: unknown): { summary: string; facts: Array<[string, string]>; items: TraceItem[] } {
  const r = result as Record<string, unknown> | unknown[] | string | null;
  if (typeof r === 'string') return { summary: r, facts: [], items: [] };
  if (Array.isArray(r)) {
    const items = r.slice(0, 8).map((entry) => {
      const e = entry as Record<string, unknown>;
      const label = String(e.title ?? e.message ?? e.path ?? e.name ?? e.sha ?? '').split('\n')[0];
      const detail = [e.sha, e.author, e.state, e.date].filter(Boolean).map(String).join(' · ');
      return { label: label || 'item', detail, href: typeof e.link === 'string' ? e.link : undefined };
    });
    return { summary: `${r.length} result${r.length === 1 ? '' : 's'} returned`, facts: [['Results', String(r.length)]], items };
  }
  if (r && typeof r === 'object') {
    const facts: Array<[string, string]> = [];
    const items: TraceItem[] = [];
    for (const key of ['path', 'commit', 'lines', 'total', 'totalFiles', 'query', 'sha', 'author', 'state', 'number']) {
      if (r[key] !== undefined && r[key] !== null) facts.push([key, String(r[key])]);
    }
    if (typeof r.link === 'string') items.push({ label: String(r.path ?? r.title ?? 'Open on GitHub'), detail: typeof r.lines === 'string' ? `lines ${r.lines}` : undefined, href: r.link });
    const list = (r.paths ?? r.results ?? r.changedFiles) as unknown[] | undefined;
    if (Array.isArray(list)) {
      for (const entry of list.slice(0, 10)) {
        const e = entry as Record<string, unknown> | string;
        items.push(typeof e === 'string' ? { label: e } : { label: String(e.path ?? ''), detail: Array.isArray(e.matches) ? String(e.matches[0] ?? '') : undefined });
      }
    }
    const summary = name === 'read_repo_file' ? `Read ${String(r.path)} (${String(r.lines)})` : facts.length ? facts.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Completed';
    return { summary, facts, items };
  }
  return { summary: 'Completed', facts: [], items: [] };
}

const TOOL_META: Record<string, { lane: TraceLane; title: string; icon: string }> = {
  list_repo_files: { lane: 'knowledge', title: 'Listed repository files', icon: 'github.svg' },
  search_repo_code: { lane: 'knowledge', title: 'Searched the code', icon: 'github.svg' },
  read_repo_file: { lane: 'knowledge', title: 'Read a file', icon: 'github.svg' },
  list_recent_commits: { lane: 'knowledge', title: 'Read commit history', icon: 'github.svg' },
  get_commit: { lane: 'knowledge', title: 'Read a commit', icon: 'github.svg' },
  list_issues: { lane: 'knowledge', title: 'Read issues', icon: 'github.svg' },
  get_issue: { lane: 'knowledge', title: 'Read an issue', icon: 'github.svg' },
  list_pull_requests: { lane: 'knowledge', title: 'Read pull requests', icon: 'github.svg' },
  get_pull_request: { lane: 'knowledge', title: 'Read a pull request', icon: 'github.svg' },
  get_current_finding: { lane: 'knowledge', title: 'Loaded the current finding', icon: 'postgresql.svg' },
  present_change_options: { lane: 'verify', title: 'Checked and posted ranked options', icon: 'shield' },
};

/**
 * Wraps channel tools so each call becomes a trace node. The wrapped handler behaves exactly like the
 * original; tracing failures are swallowed.
 */
export function traceTools<T extends { name: string; handler: (args: never, ctx: never) => unknown }>(hub: TraceHub, tools: T[]): T[] {
  return tools.map((tool) => {
    const original = tool.handler as (args: unknown, ctx: { thread?: { conversationKey?: string } }) => unknown;
    const meta = TOOL_META[tool.name] ?? { lane: 'knowledge' as const, title: tool.name.replace(/_/g, ' '), icon: 'tool' };
    let calls = 0;
    const handler = async (args: unknown, ctx: { thread?: { conversationKey?: string } }) => {
      const invocationId = ctx?.thread?.conversationKey ? hub.invocationFor(ctx.thread.conversationKey) : null;
      const id = `${tool.name}-${++calls}-${Date.now()}`;
      const argFacts = Object.entries((args ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined && typeof v !== 'object')
        .map(([k, v]) => [k, String(v)] as [string, string]);
      if (invocationId) hub.node(invocationId, { id, ...meta, subtitle: tool.name, facts: argFacts, summary: 'Running…' });
      try {
        const result = await original(args, ctx);
        if (invocationId) {
          const { summary, facts, items } = summarizeResult(tool.name, result);
          const rejected = tool.name === 'present_change_options' && typeof result === 'string' && result.startsWith('Not posted');
          hub.node(invocationId, {
            id, ...meta, subtitle: tool.name,
            title: rejected ? 'Rejected ungrounded file paths' : meta.title,
            status: rejected ? 'error' : 'done',
            summary, facts: [...argFacts, ...facts], items,
          });
        }
        return result;
      } catch (error) {
        if (invocationId) hub.node(invocationId, { id, ...meta, subtitle: tool.name, status: 'error', summary: 'The tool failed; Accord reported it instead of guessing.' });
        throw error;
      }
    };
    return { ...tool, handler } as T;
  });
}

/**
 * Follows the durable decision pipeline for one thread by polling the persisted thread view, and turns
 * each state change into a trace node. Stops when the finding is delivered or after a time limit.
 */
export function watchDecisionPipeline(hub: TraceHub, app: ApplicationPort, invocationId: string, thread: ThreadRef, before: ThreadView | null) {
  const startedAt = Date.now();
  const seen = { decision: before?.decision ? `${before.decision.version}:${before.decision.status}` : '', finding: before?.finding ? before.finding.updatedAt : '' };
  let interpreting = true;

  const tick = async () => {
    let view: ThreadView;
    try {
      view = await app.getThreadView(thread);
    } catch {
      return schedule();
    }

    const decisionKey = view.decision ? `${view.decision.version}:${view.decision.status}` : '';
    if (view.decision && decisionKey !== seen.decision) {
      seen.decision = decisionKey;
      interpreting = false;
      hub.node(invocationId, { id: 'pipeline', lane: 'understand', icon: 'triggerdev.svg', title: 'Durable pipeline', subtitle: 'Trigger.dev · interpret → investigate', status: 'done', summary: 'The background job picked up the message and found a decision change.' });
      const d = view.decision;
      const scope = d.intent ? `${d.intent.scope.plans.join('/')} · ${d.intent.scope.organizationTypes.join('/')} · verified ${d.intent.scope.universityVerified.join('/')}` : 'No complete intent';
      hub.node(invocationId, {
        id: 'interpretation', lane: 'understand', icon: 'gemini.svg', title: 'Interpreted the decision', subtitle: 'Gemini · strict JSON schema', status: 'done',
        summary: d.intent ? `Retain existing records for ${d.intent.retentionDays} days, ${d.intent.effective}.` : 'The message was understood, but no complete retention intent was stated.',
        facts: [['Scope', scope], ['Retention', d.intent ? `${d.intent.retentionDays} days` : '—'], ['Decision version', `v${d.version}`]],
      });
      hub.node(invocationId, {
        id: 'authorization', lane: 'verify', icon: 'shield', title: d.status === 'confirmed' ? 'Owner confirmed the decision' : `Recorded as ${d.status}`, subtitle: 'Authorization in code',
        status: 'done',
        summary: d.status === 'confirmed' ? 'The configured owner confirmed it, so it became binding.' : 'Only the configured decision owner can make a decision binding.',
        facts: [['Status', d.status], ['Version', `v${d.version}`]],
      });
    }

    const finding = view.finding;
    if (finding && finding.updatedAt !== seen.finding) {
      seen.finding = finding.updatedAt;
      const repo = finding.repository;
      if (repo) {
        hub.node(invocationId, {
          id: 'repository', lane: 'knowledge', icon: 'github.svg', title: `Read code at ${repo.target.sha.slice(0, 7)}`, subtitle: `${repo.target.repository.owner}/${repo.target.repository.name}`,
          status: 'done', summary: repo.summary,
          facts: [['Conclusion', repo.conclusion], ['Generated policy', repo.generatorConsistency], ['Path', repo.target.pathPrefix]],
          items: repo.evidence.map((e) => ({ label: e.path ?? e.summary, detail: e.startLine ? `lines ${e.startLine}-${e.endLine}` : e.summary, href: e.locator.startsWith('https://') ? e.locator : undefined })),
        });
        hub.node(invocationId, {
          id: 'trusted-runtime', lane: 'verify', icon: 'shield', title: repo.trustedRuntime === 'matched' ? 'Runtime matches trusted checksums' : 'Runtime not verified',
          subtitle: 'Trusted profile check', status: repo.trustedRuntime === 'matched' ? 'done' : 'error',
          summary: repo.trustedRuntime === 'matched' ? 'The runtime files match their committed checksums, so the code evidence can be trusted.' : 'The runtime could not be verified, so Accord reports the result as unsupported instead of guessing.',
          facts: [['Trusted runtime', repo.trustedRuntime]],
        });
      }
      const impact = finding.impact;
      if (impact) {
        const n = (value: number | null) => (value === null ? 'unknown' : String(value));
        hub.node(invocationId, {
          id: 'impact', lane: 'knowledge', icon: 'clickhouse.svg', title: 'Counted affected records', subtitle: `Read-only view · ${impact.run.datasetVersion}`,
          status: impact.status === 'complete' ? 'done' : 'error',
          summary: impact.status === 'complete' ? `${n(impact.prematurelySelectedRecords)} records across ${n(impact.prematurelySelectedAccounts)} accounts would be cleaned up too early.` : `Impact ${impact.status}; unknown counts stay unknown.`,
          facts: [['Records cleaned too early', n(impact.prematurelySelectedRecords)], ['Accounts affected', n(impact.prematurelySelectedAccounts)], ['Records in scope', n(impact.eligibleRecords)], ['Selected by current code', n(impact.observedSelectedTotal)]],
        });
      }
      hub.node(invocationId, {
        id: 'finding', lane: 'respond', icon: 'finding', title: finding.title || 'Finding updated', subtitle: finding.status.replace(/_/g, ' '),
        status: finding.status === 'investigating' ? 'running' : 'done', summary: finding.summary,
        facts: [['Status', finding.status.replace(/_/g, ' ')], ['Decision version', `v${finding.decisionVersion}`], ['Evidence items', String(finding.evidence.length)]],
      });
    }

    if (finding && finding.updatedAt === seen.finding && finding.status !== 'investigating' && !view.publicationPending) {
      hub.node(invocationId, { id: 'delivery', lane: 'respond', icon: 'send', title: 'Delivered to the thread', subtitle: 'Outbox · reconcile every 30s', status: 'done', summary: 'The finding was published to the same conversation.' });
      return;
    }
    if (interpreting && Date.now() - startedAt > QUIET_LIMIT_MS) {
      hub.node(invocationId, { id: 'pipeline', lane: 'understand', icon: 'triggerdev.svg', title: 'No decision change', subtitle: 'Trigger.dev · interpret', status: 'skipped', summary: 'The background job found no retention decision in this message, so it was answered as a question.' });
      return;
    }
    if (Date.now() - startedAt > WATCH_LIMIT_MS) {
      hub.node(invocationId, { id: 'finding', lane: 'respond', icon: 'finding', title: 'Still investigating', subtitle: 'Watch window ended', status: 'skipped', summary: 'The investigation is still running; the finding will update in the conversation when it completes.' });
      return;
    }
    schedule();
  };
  const schedule = () => void setTimeout(() => void tick(), WATCH_INTERVAL_MS);
  schedule();
}
