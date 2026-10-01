import { Code2, MessageSquareText, TriangleAlert } from 'lucide-react';
import { Reveal } from './Reveal';

export function Problem() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-accent-600">The gap</p>
          <p className="mt-4 text-balance text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-zinc-900 sm:text-[2.4rem]">
            Decisions happen in chat. Code changes somewhere else.{' '}
            <span className="text-zinc-400">Nobody notices when they drift apart, until it&rsquo;s an incident.</span>
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-14">
          <div className="card-border overflow-hidden rounded-3xl">
            <div className="grid md:grid-cols-2">
              <div className="min-w-0 border-b border-zinc-100 p-7 sm:p-9 md:border-b-0 md:border-r">
                <Label icon={<MessageSquareText className="h-3.5 w-3.5" />} tone="text-sky-700 bg-sky-50 ring-sky-200">
                  Decided by the team
                </Label>
                <blockquote className="mt-6 text-[1.35rem] font-medium leading-snug tracking-[-0.01em] text-zinc-800 sm:text-[1.5rem]">
                  “Free accounts with verified university status keep existing records for{' '}
                  <mark className="rounded bg-sky-100 px-1 text-sky-800">90 days</mark>, effective now.”
                </blockquote>
                <div className="mt-6 flex items-center gap-2.5 text-[13px] text-zinc-500">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500 text-[11px] font-semibold text-white">M</span>
                  Maya Chen · decision owner
                </div>
              </div>

              <div className="min-w-0 bg-zinc-50/70 p-7 sm:p-9">
                <Label icon={<Code2 className="h-3.5 w-3.5" />} tone="text-amber-800 bg-amber-50 ring-amber-200">
                  Shipped in code · 81c9b75
                </Label>
                <pre className="mt-6 overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-5 font-mono text-[13px] leading-6 text-zinc-600">
                  <span className="text-zinc-400">{'// policy/retention.idl.json'}</span>
                  {'\n{\n  '}
                  <span className="text-violet-700">&quot;schemaVersion&quot;</span>: 1,
                  {'\n'}
                  <span className="-mx-5 block bg-amber-50 px-5 ring-1 ring-inset ring-amber-200">
                    {'  '}
                    <span className="text-violet-700">&quot;defaultDays&quot;</span>: <b className="text-amber-700">30</b>,
                    <span className="ml-3 text-[11.5px] text-amber-700">← applies to everyone</span>
                  </span>
                  {'  '}
                  <span className="text-violet-700">&quot;rules&quot;</span>: []{'\n}'}
                </pre>
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-rose-100 bg-rose-50/60 px-7 py-5 sm:flex-row sm:items-center sm:px-9">
              <Label icon={<TriangleAlert className="h-3.5 w-3.5" />} tone="text-rose-700 bg-white ring-rose-200">
                Accord finds
              </Label>
              <p className="text-[15px] text-zinc-700">
                <b className="text-zinc-900">7 records</b> across <b className="text-zinc-900">2 accounts</b> would be
                cleaned up before the 90 days the team agreed to.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Label({ icon, tone, children }: { icon: React.ReactNode; tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ${tone}`}>
      {icon}
      {children}
    </span>
  );
}
