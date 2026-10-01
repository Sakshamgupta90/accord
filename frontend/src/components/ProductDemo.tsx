'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  BookOpen, Check, FileCode2, GitCommitHorizontal, LayoutGrid, ListChecks, Loader2, MessagesSquare, Plug, Search, Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';

/** Hero product shot: an Accord workspace checking one decision. The scenario is the repository's
 * synthetic fixture: 90 days decided, 30 enforced, 7 records across 2 accounts. */
const STAGES = 5;
const DURATIONS = [1500, 1300, 1300, 1400, 4600];

const NAV = [
  { label: 'Overview', icon: LayoutGrid },
  { label: 'Decisions', icon: ListChecks, active: true, count: 3 },
  { label: 'Integrations', icon: Plug },
  { label: 'Knowledge base', icon: BookOpen },
];

export function ProductDemo() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(reduce ? STAGES - 1 : 0);

  useEffect(() => {
    if (reduce) return;
    const timer = setTimeout(() => setStage((s) => (s + 1) % STAGES), DURATIONS[stage]);
    return () => clearTimeout(timer);
  }, [stage, reduce]);

  const enter = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, transition: { duration: 0.2 } },
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_40px_100px_-30px_rgba(40,30,90,0.35),0_0_0_1px_rgba(24,24,40,0.02)] sm:rounded-3xl">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto hidden w-full max-w-sm items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-400 sm:flex">
          app.accord / decisions
        </div>
      </div>

      <div className="grid min-h-[440px] grid-cols-1 md:grid-cols-[210px_1fr] lg:grid-cols-[210px_1fr_280px]">
        {/* sidebar */}
        <aside className="hidden flex-col border-r border-zinc-100 bg-zinc-50/60 px-3 py-4 md:flex">
          <div className="flex items-center gap-2 px-2">
            <AccordMark />
            <span className="text-[14px] font-semibold text-zinc-900">Acme</span>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] text-zinc-400">
            <Search className="h-3.5 w-3.5" /> Ask Accord…
          </div>
          <ul className="mt-4 space-y-0.5 text-[13.5px]">
            {NAV.map(({ label, icon: Icon, active, count }) => (
              <li key={label} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${active ? 'bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200' : 'text-zinc-500'}`}>
                <Icon className="h-4 w-4" /> {label}
                {count && <span className="ml-auto rounded-md bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-600">{count}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-auto rounded-xl border border-zinc-200 bg-white p-3">
            <div className="text-[11.5px] text-zinc-500">Connected tools</div>
            <div className="mt-2 flex -space-x-1.5">
              {['github.svg', 'postgresql.svg', 'clickhouse.svg'].map((logo) => (
                <span key={logo} className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white ${logo === 'clickhouse.svg' ? 'bg-zinc-900' : 'bg-zinc-100'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/logos/${logo}`} alt="" className="h-4 w-4" />
                </span>
              ))}
            </div>
          </div>
        </aside>

        {/* decision */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <span className="truncate text-[15px] font-semibold text-zinc-900">Retention for verified university accounts</span>
            <span className="ml-auto shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">v1</span>
          </div>
          <div className="flex-1 space-y-5 px-5 py-5">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
                <MessagesSquare className="h-3.5 w-3.5" /> Captured from a team conversation
                <span className="text-zinc-300">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-sky-500 text-[9px] font-semibold text-white">M</span>
                  Maya Chen, owner
                </span>
              </div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-zinc-800">
                “Free accounts with verified university status keep existing records for <b className="text-zinc-900">90 days</b>, effective now.”
              </p>
            </div>

            <AnimatePresence mode="popLayout">
              {stage >= 1 && (
                <motion.ul key="work" {...enter} className="space-y-1.5 text-[13.5px] text-zinc-500">
                  <Step done={stage >= 2} label="Read the policy code at commit 81c9b75" />
                  <Step done={stage >= 3} label="Counted affected records from a read-only view" />
                </motion.ul>
              )}
              {stage >= 3 && (
                <motion.div key="finding" {...enter}>
                  <FindingCard highlight={stage >= 4} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* evidence panel */}
        <aside className="hidden border-l border-zinc-100 bg-zinc-50/60 p-5 lg:block">
          <div className="text-[12px] font-medium uppercase tracking-wide text-zinc-400">Evidence</div>
          <div className="mt-3 space-y-2.5">
            <Evidence icon={<GitCommitHorizontal className="h-3.5 w-3.5" />} title="Commit 81c9b75" detail="Pinned for this investigation" show={stage >= 2} />
            <Evidence icon={<FileCode2 className="h-3.5 w-3.5" />} title="retention.idl.json" detail="defaultDays: 30 · rules: []" show={stage >= 2} />
            <Evidence icon={<FileCode2 className="h-3.5 w-3.5" />} title="policy-resolver.ts" detail="Runtime reads generated policy" show={stage >= 2} />
            <Evidence icon={<Check className="h-3.5 w-3.5" />} title="Dataset accord-demo" detail="6 accounts · 19 records" show={stage >= 3} />
          </div>
          <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-3">
            <div className="text-[11.5px] text-zinc-500">Decision</div>
            <div className="mt-0.5 text-[13px] font-medium text-zinc-900">v1 · confirmed by owner</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AccordMark() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-teal-400">
      <svg viewBox="0 0 32 32" className="h-4 w-4" aria-hidden="true">
        <rect x="4" y="4" width="15" height="15" rx="4" fill="none" stroke="#fff" strokeWidth="3" />
        <rect x="13" y="13" width="15" height="15" rx="4" fill="#fff" />
      </svg>
    </span>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      <span className={done ? 'text-zinc-700' : ''}>{label}</span>
    </li>
  );
}

function FindingCard({ highlight }: { highlight: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex">
        <div className="w-1 shrink-0 bg-rose-500" />
        <div className="flex-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
              Confirmed conflict
            </span>
            <span className="text-[12px] text-zinc-400">decision v1</span>
          </div>
          <p className="mt-2.5 text-[14.5px] font-semibold leading-snug text-zinc-900">Cleanup still enforces 30 days; the decision requires 90.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat value="7" label="records cleaned too early" highlight={highlight} />
            <Stat value="2" label="accounts affected" highlight={highlight} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 transition-colors duration-700 ${highlight ? 'border-rose-200 bg-rose-50/70' : 'border-zinc-200 bg-zinc-50'}`}>
      <div className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">{value}</div>
      <div className="text-[11.5px] leading-tight text-zinc-500">{label}</div>
    </div>
  );
}

function Evidence({ icon, title, detail, show }: { icon: React.ReactNode; title: string; detail: string; show: boolean }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border bg-white p-3 transition-all duration-500 ${show ? 'border-zinc-200 opacity-100' : 'translate-y-1 border-transparent opacity-0'}`}>
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600">{icon}</span>
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-medium text-zinc-800">{title}</div>
        <div className="truncate text-[11.5px] text-zinc-500">{detail}</div>
      </div>
    </div>
  );
}
