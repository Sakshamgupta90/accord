'use client';

import Link from 'next/link';
import { ArrowRight, BarChart3, Check, FileSearch, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { toolById } from '@/lib/tools';
import { useSelectedTools } from '@/lib/useSelectedTools';
import { LogoTile } from '../TechIcon';

const METRICS = [
  { label: 'Decisions tracked', icon: Sparkles },
  { label: 'Open conflicts', icon: ShieldAlert },
  { label: 'Records at risk', icon: Users },
  { label: 'Evidence items', icon: FileSearch },
];

export function Overview({ firstName }: { firstName: string }) {
  const { selected } = useSelectedTools();
  const tools = selected.map(toolById).filter((tool) => tool !== undefined);

  const steps = [
    { label: 'Sign in', done: true },
    { label: 'Choose the tools Accord can use', done: tools.length > 0, href: '/dashboard/integrations' },
    { label: 'Connect your first tool', done: false, note: 'Opens to design partners first' },
    { label: 'See your first decision checked', done: false },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <div>
      <header>
        <p className="text-[13px] font-medium text-violet-600">Overview</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold sm:text-[1.75rem] tracking-[-0.03em] text-zinc-900">Welcome, {firstName}</h1>
        <p className="mt-1 text-[15px] text-zinc-600">Here&rsquo;s where Accord will show how your team&rsquo;s decisions line up with your code and data.</p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 xl:grid-cols-4">
        {METRICS.map(({ label, icon: Icon }) => (
          <div key={label} className="card-border rounded-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2 text-[12.5px] leading-tight text-zinc-500 sm:text-[13px]">
              {label}
              <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
            </div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-300">—</div>
            <div className="mt-1 text-[12px] text-zinc-400">No data yet</div>
          </div>
        ))}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="card-border rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-zinc-900">Decision drift over time</h2>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11.5px] font-medium text-zinc-500">Last 30 days</span>
          </div>
          <div className="relative mt-6 h-44 sm:h-56">
            <div className="absolute inset-0 flex items-end gap-2 opacity-[0.35]" aria-hidden="true">
              {[28, 40, 34, 52, 46, 60, 44, 66, 58, 72, 64, 80].map((h, i) => (
                <div key={i} className="flex-1 rounded-t-md bg-zinc-200" style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 shadow-sm">
                <BarChart3 className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[14px] font-medium text-zinc-800">No data yet</p>
              <p className="mt-1 max-w-xs text-[13px] text-zinc-500">Charts appear once a connected tool sends its first decision.</p>
            </div>
          </div>
        </section>

        <section className="card-border rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-zinc-900">Get started</h2>
            <span className="text-[12.5px] text-zinc-500">{doneCount} of {steps.length}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-teal-400 transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="mt-5 space-y-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${step.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300 bg-white'}`}>
                  {step.done && <Check className="h-3 w-3" />}
                </span>
                <div className="min-w-0">
                  {step.href && !step.done ? (
                    <Link href={step.href} className="text-[14px] font-medium text-violet-700 hover:underline">{step.label}</Link>
                  ) : (
                    <span className={`text-[14px] ${step.done ? 'text-zinc-500 line-through decoration-zinc-300' : 'text-zinc-800'}`}>{step.label}</span>
                  )}
                  {step.note && <div className="text-[12px] text-zinc-400">{step.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card-border mt-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Your tools</h2>
            <p className="text-[13px] text-zinc-500">Saved in this browser until accounts sync.</p>
          </div>
          <Link href="/dashboard/integrations" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-zinc-700">
            {tools.length ? 'Manage tools' : 'Choose tools'} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {tools.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-[14px] text-zinc-500">
            No tools chosen yet. Pick where your team makes decisions and where your code and data live.
          </p>
        ) : (
          <ul className="mt-5 flex flex-wrap gap-2">
            {tools.map((tool) => (
              <li key={tool.id} className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white py-1.5 pl-1.5 pr-3">
                <LogoTile name={tool.name} logo={tool.logo} tile={tool.tile} size="sm" />
                <span className="text-[14px] font-medium text-zinc-800">{tool.name}</span>
                <StatusBadge status={tool.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function StatusBadge({ status }: { status: 'pilot' | 'soon' }) {
  return status === 'pilot' ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">Pilot</span>
  ) : (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">Coming soon</span>
  );
}
