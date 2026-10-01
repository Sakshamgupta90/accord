'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check, CircleDashed, ClipboardCheck, ExternalLink, Loader2, MessageSquare, Radio, Send, ShieldCheck, Wrench, X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyTraceEvent, LANES, type TraceInvocation, type TraceNode, type TraceStreamEvent } from '@/lib/traces';

type Connection = 'connecting' | 'live' | 'offline' | 'unconfigured';

/** Live, real traces of what Accord does each time it is triggered. Nothing here is simulated. */
export function Metrics() {
  const [invocations, setInvocations] = useState<TraceInvocation[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const followLatest = useRef(true);

  useEffect(() => {
    const source = new EventSource('/api/traces/stream');
    source.onopen = () => setConnection((c) => (c === 'unconfigured' ? c : 'live'));
    source.onerror = () => setConnection((c) => (c === 'unconfigured' ? c : 'offline'));
    source.onmessage = (message) => {
      let event: TraceStreamEvent;
      try {
        event = JSON.parse(message.data) as TraceStreamEvent;
      } catch {
        return;
      }
      if (event.type === 'status') {
        setConnection(event.state);
        setStatusMessage(event.message);
        if (event.state === 'unconfigured') source.close();
        return;
      }
      setConnection('live');
      setInvocations((list) => applyTraceEvent(list, event));
      if (event.type === 'invocation' && followLatest.current) {
        setSelectedId(event.invocation.id);
        setSelectedNodeId(null);
      }
    };
    return () => source.close();
  }, []);

  const selected = invocations.find((i) => i.id === selectedId) ?? invocations[0] ?? null;
  const selectedNode = selected?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const choose = (id: string) => {
    followLatest.current = id === invocations[0]?.id;
    setSelectedId(id);
    setSelectedNodeId(null);
  };

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-violet-600">Metrics</p>
          <h1 className="mt-1 text-[1.6rem] font-semibold tracking-[-0.03em] text-zinc-900 sm:text-[1.75rem]">Behind the scenes, live</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-zinc-600">
            Every time Accord is triggered, each real step it takes appears here as it happens: what it read, what it checked and what it delivered.
          </p>
        </div>
        <ConnectionPill state={connection} />
      </header>

      {invocations.length === 0 ? (
        <EmptyState state={connection} message={statusMessage} />
      ) : (
        <div className="mt-6 space-y-4">
          <InvocationList invocations={invocations} selectedId={selected?.id ?? null} onSelect={choose} />
          {selected && (
            <div className="min-w-0 space-y-4">
              <InvocationHeader invocation={selected} />
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-4">
                  <FlowCanvas invocation={selected} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
                  {/* below the flow on smaller screens, so details appear right where the user clicked */}
                  {selectedNode && (
                    <div className="2xl:hidden">
                      <NodeDetails node={selectedNode} onClose={() => setSelectedNodeId(null)} />
                    </div>
                  )}
                  <Timeline invocation={selected} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
                </div>
                <div className="hidden 2xl:block">
                  <NodeDetails node={selectedNode} onClose={() => setSelectedNodeId(null)} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const ms = (value: number) => (value < 1000 ? `${Math.max(0, Math.round(value))} ms` : `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`);

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const nodeDuration = (node: TraceNode, now: number) => (node.endedAt ? Date.parse(node.endedAt) : now) - Date.parse(node.startedAt);

/* ---------- connection + empty ---------- */

function ConnectionPill({ state }: { state: Connection }) {
  const map = {
    live: { label: 'Live', dot: 'bg-emerald-500', ring: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
    connecting: { label: 'Connecting…', dot: 'bg-amber-400', ring: 'text-amber-800 bg-amber-50 ring-amber-200' },
    offline: { label: 'Accord offline', dot: 'bg-zinc-400', ring: 'text-zinc-600 bg-zinc-100 ring-zinc-200' },
    unconfigured: { label: 'Not configured', dot: 'bg-zinc-400', ring: 'text-zinc-600 bg-zinc-100 ring-zinc-200' },
  }[state];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 ${map.ring}`}>
      <span className="relative flex h-2 w-2">
        {state === 'live' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${map.dot}`} />
      </span>
      {map.label}
    </span>
  );
}

function EmptyState({ state, message }: { state: Connection; message: string }) {
  const waiting = state === 'live' || state === 'connecting';
  return (
    <div className="card-border relative mt-6 overflow-hidden rounded-3xl px-6 py-16 text-center sm:py-20">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative mx-auto max-w-md">
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          {waiting && [0, 1, 2].map((i) => (
            <span key={i} className="absolute inset-0 animate-ping rounded-full border border-violet-300" style={{ animationDelay: `${i * 0.6}s`, animationDuration: '2.4s' }} />
          ))}
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-teal-400 text-white shadow-lg">
            <Radio className="h-6 w-6" />
          </span>
        </div>
        <h2 className="mt-6 text-xl font-semibold tracking-tight text-zinc-900">
          {waiting ? 'Waiting for Accord to be triggered' : state === 'offline' ? 'Accord isn’t running right now' : 'Live traces aren’t configured'}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
          {waiting
            ? 'Mention Accord in your connected team channel. Each step will appear here the moment it happens.'
            : message || 'Start the Accord bridge and this page connects automatically.'}
        </p>
      </div>
    </div>
  );
}

/* ---------- list + header ---------- */

function InvocationList({ invocations, selectedId, onSelect }: { invocations: TraceInvocation[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const now = useNow(invocations.some((i) => i.status === 'running'));
  return (
    <section className="card-border rounded-2xl p-3">
      <div className="px-2 pb-2 pt-1 text-[12px] font-medium uppercase tracking-wide text-zinc-400">Recent invocations</div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {invocations.map((invocation) => {
          const active = invocation.id === selectedId;
          return (
            <li key={invocation.id} className="w-64 shrink-0">
              <button
                type="button"
                onClick={() => onSelect(invocation.id)}
                aria-current={active}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-violet-400 bg-violet-50/60' : 'border-transparent hover:bg-zinc-50'}`}
              >
                <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
                  <StatusIcon status={invocation.status} small />
                  {invocation.actor} · {ago(invocation.startedAt, now)}
                </div>
                <p className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-zinc-800">{invocation.message || 'Message'}</p>
                <div className="mt-1 text-[11.5px] text-zinc-400">{invocation.nodes.length} steps</div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function InvocationHeader({ invocation }: { invocation: TraceInvocation }) {
  const now = useNow(invocation.status === 'running');
  const elapsed = (invocation.endedAt ? Date.parse(invocation.endedAt) : now) - Date.parse(invocation.startedAt);
  const stats = [
    { label: 'Elapsed', value: ms(elapsed) },
    { label: 'Steps', value: String(invocation.nodes.length) },
    { label: 'Knowledge read', value: String(invocation.nodes.filter((n) => n.lane === 'knowledge').length) },
    { label: 'Guardrails', value: String(invocation.nodes.filter((n) => n.lane === 'verify').length) },
  ];
  return (
    <section className="card-border rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
        <MessageSquare className="h-3.5 w-3.5" /> {invocation.channel} · {invocation.actor}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${invocation.status === 'running' ? 'bg-violet-50 text-violet-700' : invocation.status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {invocation.status === 'running' ? 'Running' : invocation.status === 'error' ? 'Finished with errors' : 'Completed'}
        </span>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-zinc-900">“{invocation.message || 'Message'}”</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-zinc-50 px-3 py-2">
            <dt className="text-[11.5px] text-zinc-500">{stat.label}</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums tracking-tight text-zinc-900">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- node visuals ---------- */

function NodeIcon({ icon, size = 'h-9 w-9' }: { icon: string; size?: string }) {
  if (icon.endsWith('.svg')) {
    const dark = icon === 'triggerdev.svg' || icon === 'clickhouse.svg';
    return (
      <span className={`flex ${size} shrink-0 items-center justify-center rounded-lg border ${dark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/${icon}`} alt="" className="h-5 w-5 object-contain" />
      </span>
    );
  }
  const Glyph = { message: MessageSquare, shield: ShieldCheck, send: Send, finding: ClipboardCheck }[icon] ?? Wrench;
  const tone = icon === 'shield' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-violet-200 bg-violet-50 text-violet-600';
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-lg border ${tone}`}>
      <Glyph className="h-4 w-4" />
    </span>
  );
}

function StatusIcon({ status, small }: { status: TraceNode['status'] | TraceInvocation['status']; small?: boolean }) {
  const size = small ? 'h-3.5 w-3.5' : 'h-4 w-4';
  if (status === 'running') return <Loader2 className={`${size} animate-spin text-violet-600`} />;
  if (status === 'error') return <X className={`${size} text-rose-600`} />;
  if (status === 'skipped') return <CircleDashed className={`${size} text-zinc-400`} />;
  return <Check className={`${size} text-emerald-600`} />;
}

function NodeCard({ node, selected, onSelect, register }: { node: TraceNode; selected: boolean; onSelect: () => void; register?: (el: HTMLButtonElement | null) => void }) {
  const now = useNow(node.status === 'running');
  const running = node.status === 'running';
  return (
    <motion.button
      ref={register}
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.9, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative w-full rounded-xl border bg-white p-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        selected ? 'border-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.18)]' : node.status === 'error' ? 'border-rose-200' : 'border-zinc-200 hover:border-zinc-300 hover:shadow-sm'
      } ${node.status === 'skipped' ? 'opacity-70' : ''}`}
    >
      {running && <span className="pointer-events-none absolute -inset-px animate-pulse rounded-xl ring-2 ring-violet-400/60" />}
      <div className="flex items-start gap-2.5">
        <NodeIcon icon={node.icon} size="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <span className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-zinc-900">{node.title}</span>
            <StatusIcon status={node.status} small />
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-zinc-500">{node.subtitle}</div>
          <div className="mt-1 font-mono text-[10.5px] text-zinc-400">{ms(nodeDuration(node, now))}</div>
        </div>
      </div>
    </motion.button>
  );
}

/* ---------- flow canvas (desktop lanes with live connectors; vertical timeline on small screens) ---------- */

type Edge = { from: string; to: string; d: string; live: boolean };

function FlowCanvas({ invocation, selectedNodeId, onSelect }: { invocation: TraceInvocation; selectedNodeId: string | null; onSelect: (id: string) => void }) {
  const reduce = useReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const order = invocation.nodes;

  const measure = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const lane = (id: string) => LANES.findIndex((l) => l.id === order.find((n) => n.id === id)?.lane);
    const next: Edge[] = [];
    for (let i = 1; i < order.length; i += 1) {
      const a = refs.current.get(order[i - 1].id);
      const b = refs.current.get(order[i].id);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const la = lane(order[i - 1].id);
      const lb = lane(order[i].id);
      let d: string;
      if (la === lb) {
        const x = ra.left - base.left + 14;
        const y1 = ra.bottom - base.top;
        const y2 = rb.top - base.top;
        d = `M ${x} ${y1} C ${x - 18} ${y1 + 12}, ${x - 18} ${y2 - 12}, ${x} ${y2}`;
      } else {
        const forward = lb > la;
        const x1 = (forward ? ra.right : ra.left) - base.left;
        const y1 = ra.top + ra.height / 2 - base.top;
        const x2 = (forward ? rb.left : rb.right) - base.left;
        const y2 = rb.top + rb.height / 2 - base.top;
        const bend = Math.max(30, Math.abs(x2 - x1) / 2);
        d = `M ${x1} ${y1} C ${x1 + (forward ? bend : -bend)} ${y1}, ${x2 - (forward ? bend : -bend)} ${y2}, ${x2} ${y2}`;
      }
      next.push({ from: order[i - 1].id, to: order[i].id, d, live: order[i].status === 'running' });
    }
    setEdges(next);
  }, [order]);

  useLayoutEffect(() => {
    measure();
    const frame = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 450);
    const root = container.current;
    const observer = root ? new ResizeObserver(measure) : null;
    if (root && observer) observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observer?.disconnect();
    };
  }, [measure]);

  return (
    <section className="card-border rounded-2xl p-4 sm:p-5">
      {/* wide screens: five lanes */}
      <div ref={container} className="relative hidden lg:block">
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="edge-grad" x1="0" x2="1">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#2dd4bf" />
            </linearGradient>
          </defs>
          {edges.map((edge) => (
            <g key={`${edge.from}-${edge.to}`}>
              <path d={edge.d} fill="none" stroke={edge.live ? 'url(#edge-grad)' : '#d4d4d8'} strokeWidth={edge.live ? 2 : 1.5} strokeDasharray={edge.live ? '6 6' : undefined}>
                {edge.live && !reduce && <animate attributeName="stroke-dashoffset" from="24" to="0" dur="0.8s" repeatCount="indefinite" />}
              </path>
              {!reduce && (
                <circle r={edge.live ? 4 : 2.5} fill={edge.live ? '#8b5cf6' : '#c4b5fd'}>
                  <animateMotion dur={edge.live ? '1.2s' : '3s'} repeatCount="indefinite" path={edge.d} />
                </circle>
              )}
            </g>
          ))}
        </svg>
        <div className="relative grid grid-cols-5 gap-5 xl:gap-7">
          {LANES.map((lane) => {
            const nodes = order.filter((n) => n.lane === lane.id);
            return (
              <div key={lane.id} className="min-w-0">
                <div className="mb-3 border-b border-zinc-100 pb-2">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-zinc-900">{lane.label}</div>
                  <div className="text-[11px] text-zinc-400">{lane.caption}</div>
                </div>
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {nodes.map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        selected={node.id === selectedNodeId}
                        onSelect={() => onSelect(node.id)}
                        register={(el) => {
                          if (el) refs.current.set(node.id, el);
                          else refs.current.delete(node.id);
                        }}
                      />
                    ))}
                  </AnimatePresence>
                  {nodes.length === 0 && <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-[11.5px] text-zinc-400">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* small screens: vertical timeline in the order steps happened */}
      <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-gradient-to-b before:from-violet-300 before:to-teal-300 lg:hidden">
        {order.map((node) => (
          <li key={node.id} className="relative pl-11">
            <span className="absolute left-[11px] top-4 h-3 w-3 rounded-full border-2 border-white bg-violet-500 ring-2 ring-violet-200" />
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-400">{LANES.find((l) => l.id === node.lane)?.label}</div>
            <NodeCard node={node} selected={node.id === selectedNodeId} onSelect={() => onSelect(node.id)} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- timeline (waterfall of real step durations) ---------- */

function Timeline({ invocation, selectedNodeId, onSelect }: { invocation: TraceInvocation; selectedNodeId: string | null; onSelect: (id: string) => void }) {
  const now = useNow(invocation.status === 'running');
  const start = Date.parse(invocation.startedAt);
  const end = Math.max(
    invocation.endedAt ? Date.parse(invocation.endedAt) : now,
    ...invocation.nodes.map((n) => (n.endedAt ? Date.parse(n.endedAt) : now)),
    start + 1,
  );
  const span = end - start;
  return (
    <section className="card-border rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-zinc-900">Timeline</h2>
        <span className="font-mono text-[11.5px] text-zinc-500">{ms(span)}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {invocation.nodes.map((node) => {
          const s = Date.parse(node.startedAt) - start;
          const e = (node.endedAt ? Date.parse(node.endedAt) : now) - start;
          const left = (s / span) * 100;
          const width = Math.max(((e - s) / span) * 100, 1.2);
          const color = node.status === 'error' ? 'bg-rose-400' : node.status === 'skipped' ? 'bg-zinc-300' : node.lane === 'knowledge' ? 'bg-teal-400' : node.lane === 'verify' ? 'bg-emerald-400' : 'bg-violet-400';
          return (
            <li key={node.id}>
              <button type="button" onClick={() => onSelect(node.id)} className={`grid w-full grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-3 rounded-lg px-2 py-1 text-left transition sm:grid-cols-[minmax(0,13rem)_1fr_4rem] ${node.id === selectedNodeId ? 'bg-violet-50' : 'hover:bg-zinc-50'}`}>
                <span className="truncate text-[12.5px] text-zinc-700">{node.title}</span>
                <span className="relative h-2.5 rounded-full bg-zinc-100">
                  <span className={`absolute inset-y-0 rounded-full ${color} ${node.status === 'running' ? 'animate-pulse' : ''}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
                </span>
                <span className="text-right font-mono text-[11px] text-zinc-500">{ms(e - s)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- details ---------- */

function NodeDetails({ node, onClose }: { node: TraceNode | null; onClose: () => void }) {
  const now = useNow(node?.status === 'running');
  if (!node) {
    return (
      <aside className="card-border flex flex-col items-center justify-center rounded-2xl p-6 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Wrench className="h-5 w-5" /></span>
        <p className="mt-3 text-[14px] font-medium text-zinc-800">Select a step</p>
        <p className="mt-1 text-[13px] text-zinc-500">Click any node or timeline row to see exactly what Accord did.</p>
      </aside>
    );
  }
  const lane = LANES.find((l) => l.id === node.lane);
  return (
    <motion.aside key={node.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="card-border rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <NodeIcon icon={node.icon} size="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-600">{lane?.label}</div>
          <h3 className="text-[15.5px] font-semibold leading-snug text-zinc-900">{node.title}</h3>
          <div className="text-[12.5px] text-zinc-500">{node.subtitle}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-zinc-600">
        <StatusIcon status={node.status} small /> <span className="capitalize">{node.status}</span>
        <span className="text-zinc-300">·</span>
        <span className="font-mono">{ms(nodeDuration(node, now))}</span>
      </div>
      {node.summary && <p className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-zinc-700">{node.summary}</p>}
      {node.facts.length > 0 && (
        <dl className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {node.facts.map(([key, value], index) => (
            <div key={`${key}-${index}`} className="flex justify-between gap-4 px-3 py-2 text-[12.5px]">
              <dt className="shrink-0 text-zinc-500">{key}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-zinc-800">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {node.items.length > 0 && (
        <div className="mt-4">
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-zinc-400">Read by Accord</div>
          <ul className="mt-2 space-y-1.5">
            {node.items.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.href ? (
                  <a href={item.href} target="_blank" rel="noreferrer" className="group flex items-start gap-2 rounded-lg bg-zinc-50 px-2.5 py-2 hover:bg-violet-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] text-zinc-800 group-hover:text-violet-700">{item.label}</span>
                      {item.detail && <span className="block truncate text-[11.5px] text-zinc-500">{item.detail}</span>}
                    </span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  </a>
                ) : (
                  <div className="rounded-lg bg-zinc-50 px-2.5 py-2">
                    <span className="block truncate font-mono text-[12px] text-zinc-800">{item.label}</span>
                    {item.detail && <span className="block truncate text-[11.5px] text-zinc-500">{item.detail}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.aside>
  );
}
