import { CornerDownLeft, Eye, GitCommitHorizontal, LayoutDashboard, Lock, MessagesSquare, ShieldCheck } from 'lucide-react';
import { PRINCIPLES } from '@/lib/site';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';
import { LogoTile } from './TechIcon';

type Node = { name: string; logo?: string; tile?: 'dark'; title: string; detail: string };

const ZONES: ReadonlyArray<{ step: string; label: string; caption: string; nodes: Node[] }> = [
  {
    step: '01',
    label: 'Ingress',
    caption: 'Only decisions Accord is pointed to',
    nodes: [
      { name: 'Conversations', title: 'Team conversations', detail: 'The tools you connect in your dashboard' },
      { name: 'CopilotKit', logo: 'copilotkit.svg', title: 'Channel runtime', detail: 'Validates every event against strict schemas' },
    ],
  },
  {
    step: '02',
    label: 'Durable core',
    caption: 'Versioned, transactional, retried',
    nodes: [
      { name: 'PostgreSQL', logo: 'postgresql.svg', title: 'Decision store', detail: 'Versions, findings and outbox; the source of truth' },
      { name: 'Trigger.dev', logo: 'triggerdev.svg', tile: 'dark', title: 'Durable jobs', detail: 'Interpret → investigate → publish' },
      { name: 'Google Gemini', logo: 'gemini.svg', title: 'Interpretation', detail: 'Output validated before it can change state' },
    ],
  },
  {
    step: '03',
    label: 'Evidence',
    caption: 'Read-only, pinned, aggregate',
    nodes: [
      { name: 'GitHub', logo: 'github.svg', title: 'Code at a pinned commit', detail: 'Runtime files checked against trusted checksums' },
      { name: 'ClickHouse', logo: 'clickhouse.svg', tile: 'dark', title: 'Impact analysis', detail: 'One restricted view; counts, never rows' },
    ],
  },
];

const PRINCIPLE_ICONS = [Lock, Eye, GitCommitHorizontal, ShieldCheck];

export function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          eyebrow="Architecture"
          title="Durable by default, honest about what it doesn't know"
          body="PostgreSQL is the source of truth. Slow work runs as durable jobs, and one finding stays current where the decision was made."
        />

        <Reveal className="card-border bg-dots mt-16 overflow-hidden rounded-3xl p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col items-stretch lg:flex-row">
            {ZONES.map((zone, index) => (
              <div key={zone.label} className="contents">
                <Zone {...zone} />
                {index < ZONES.length - 1 && <Link />}
              </div>
            ))}
          </div>

          {/* return path: the finding goes back to where the decision was made */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-violet-200 bg-white px-4 py-3.5 shadow-sm sm:px-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <CornerDownLeft className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-zinc-600">
              <span className="font-semibold text-zinc-900">One finding, back where the decision was made</span>{' '}
              and in your dashboard. Published through an outbox; a reconcile job re-checks delivery every 30 seconds.
            </p>
            <span className="hidden shrink-0 sm:block">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600">
                <LayoutDashboard className="h-4 w-4" />
              </span>
            </span>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map((principle, index) => {
            const Icon = PRINCIPLE_ICONS[index];
            return (
              <Reveal key={principle.title} delay={index * 0.06} className="lg:border-l lg:border-zinc-200 lg:pl-6 lg:first:border-l-0 lg:first:pl-0">
                <Icon className="h-5 w-5 text-violet-600" />
                <h3 className="mt-4 text-[15.5px] font-semibold tracking-tight text-zinc-900">{principle.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">{principle.body}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Zone({ step, label, caption, nodes }: { step: string; label: string; caption: string; nodes: Node[] }) {
  return (
    <div className="flex-1 rounded-2xl border border-zinc-200 bg-zinc-50/90 p-3 backdrop-blur-sm sm:p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-violet-600">{step}</span>
          <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-900">{label}</span>
        </div>
        <span className="truncate text-[11.5px] text-zinc-500">{caption}</span>
      </div>
      <div className="space-y-2">
        {nodes.map((node) => (
          <div key={node.title} className="flex items-center gap-3 rounded-xl border border-zinc-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(24,24,40,0.04)]">
            {node.logo ? (
              <LogoTile name={node.name} logo={node.logo} tile={node.tile} size="sm" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-600">
                <MessagesSquare className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-zinc-900">{node.title}</div>
              <div className="text-[12.5px] leading-snug text-zinc-500">{node.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Animated connector between zones: horizontal on desktop, vertical when stacked. */
function Link() {
  return (
    <div className="flex shrink-0 items-center justify-center py-2 lg:px-2 lg:py-0" aria-hidden="true">
      <div className="relative flex h-8 w-full items-center justify-center lg:h-full lg:w-8">
        <div className="flow-y absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 lg:hidden" />
        <div className="flow-x absolute inset-x-0 top-1/2 hidden h-[2px] -translate-y-1/2 lg:block" />
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-600 shadow-sm">
          <svg viewBox="0 0 16 16" className="h-3 w-3 rotate-90 lg:rotate-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </span>
      </div>
    </div>
  );
}
