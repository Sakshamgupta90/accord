/** Shapes of the live trace stream. Mirrors apps/channel/src/trace.ts in the Accord bridge. */

export type TraceLane = 'trigger' | 'understand' | 'knowledge' | 'verify' | 'respond';
export type TraceStatus = 'running' | 'done' | 'error' | 'skipped';

export interface TraceItem { label: string; detail?: string; href?: string }

export interface TraceNode {
  id: string;
  lane: TraceLane;
  title: string;
  subtitle: string;
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

export type TraceStreamEvent =
  | { type: 'snapshot'; invocations: TraceInvocation[] }
  | { type: 'invocation'; invocation: TraceInvocation }
  | { type: 'node'; invocationId: string; node: TraceNode }
  | { type: 'end'; invocationId: string; status: 'done' | 'error'; endedAt: string }
  | { type: 'status'; state: 'offline' | 'unconfigured'; message: string };

export const LANES: Array<{ id: TraceLane; label: string; caption: string }> = [
  { id: 'trigger', label: 'Trigger', caption: 'What started it' },
  { id: 'understand', label: 'Understand', caption: 'Reasoning and jobs' },
  { id: 'knowledge', label: 'Knowledge', caption: 'What Accord read' },
  { id: 'verify', label: 'Verify', caption: 'Guardrails checked' },
  { id: 'respond', label: 'Respond', caption: 'What it delivered' },
];

/** Applies one stream event to the list of invocations (newest first). Pure, for React state. */
export function applyTraceEvent(list: TraceInvocation[], event: TraceStreamEvent): TraceInvocation[] {
  switch (event.type) {
    case 'snapshot':
      return event.invocations;
    case 'invocation':
      return [event.invocation, ...list.filter((i) => i.id !== event.invocation.id)].slice(0, 20);
    case 'node':
      return list.map((i) => {
        if (i.id !== event.invocationId) return i;
        const exists = i.nodes.some((n) => n.id === event.node.id);
        return { ...i, nodes: exists ? i.nodes.map((n) => (n.id === event.node.id ? event.node : n)) : [...i.nodes, event.node] };
      });
    case 'end':
      return list.map((i) => (i.id === event.invocationId ? { ...i, status: event.status, endedAt: event.endedAt } : i));
    default:
      return list;
  }
}
