import { Check, Database, FileCode2 } from 'lucide-react';
import { STEPS } from '@/lib/site';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="From a decision to verified evidence"
          body="Accord only looks at the decisions you point it to. Everything it concludes is tied to a decision version, a commit and a dataset version."
        />
        <div className="mt-16 grid gap-5 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.08} className="card-border flex flex-col overflow-hidden rounded-3xl">
              <div className="bg-dots flex h-48 items-center justify-center border-b border-zinc-100 bg-zinc-50/60 p-6">
                {index === 0 && <MentionVisual />}
                {index === 1 && <InvestigateVisual />}
                {index === 2 && <FindingVisual />}
              </div>
              <div className="p-7">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-[12px] font-semibold text-white">{index + 1}</span>
                  <h3 className="text-[17px] font-semibold tracking-tight text-zinc-900">{step.title}</h3>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function MiniCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`w-full max-w-[280px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_24px_-12px_rgba(24,24,40,0.18)] ${className}`}>{children}</div>;
}

function MentionVisual() {
  return (
    <MiniCard>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500 text-[11px] font-semibold text-white">M</span>
        <span className="text-[12.5px] font-bold text-zinc-900">Maya Chen</span>
        <span className="rounded bg-zinc-100 px-1 text-[9.5px] font-medium uppercase text-zinc-500">Owner</span>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-600">
        <span className="rounded bg-sky-100 px-1 font-medium text-sky-700">@Accord</span> Confirmed: verified university accounts keep records 90 days.
      </p>
    </MiniCard>
  );
}

function InvestigateVisual() {
  const rows = [
    { icon: <FileCode2 className="h-3.5 w-3.5" />, label: 'policy-resolver.ts', meta: '81c9b75' },
    { icon: <FileCode2 className="h-3.5 w-3.5" />, label: 'retention-policy.json', meta: 'generated' },
    { icon: <Database className="h-3.5 w-3.5" />, label: 'accord_retention_view', meta: 'counts only' },
  ];
  return (
    <MiniCard className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5">
          <span className="text-violet-600">{row.icon}</span>
          <span className="truncate font-mono text-[11.5px] text-zinc-800">{row.label}</span>
          <span className="ml-auto flex items-center gap-1 text-[10.5px] text-zinc-400">
            {row.meta} <Check className="h-3 w-3 text-emerald-600" />
          </span>
        </div>
      ))}
    </MiniCard>
  );
}

function FindingVisual() {
  const history = [
    { v: 'v1', label: 'Conflict found', tone: 'bg-rose-500' },
    { v: 'v2', label: 'Tentative: legal review', tone: 'bg-amber-400' },
    { v: 'PR', label: 'Fix verified at commit', tone: 'bg-emerald-500' },
  ];
  return (
    <MiniCard>
      <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-zinc-200">
        {history.map((item) => (
          <li key={item.v} className="relative flex items-center gap-3 pl-0">
            <span className={`relative z-10 h-[11px] w-[11px] rounded-full ring-2 ring-white ${item.tone}`} />
            <span className="font-mono text-[11px] text-zinc-400">{item.v}</span>
            <span className="text-[12.5px] text-zinc-700">{item.label}</span>
          </li>
        ))}
      </ol>
    </MiniCard>
  );
}
