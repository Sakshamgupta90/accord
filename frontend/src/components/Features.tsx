import { Code2, GitPullRequest, History, ListOrdered, ShieldCheck, Sparkles } from 'lucide-react';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

export function Features() {
  return (
    <section id="features" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="One agent, grounded in your code and data"
          body="Ask about decisions, code, commits, issues or pull requests. Every answer comes from a tool result, never from the model's memory."
        />

        <div className="mt-16 grid gap-4 md:grid-cols-6">
          <Reveal className="card-border overflow-hidden rounded-3xl md:col-span-4">
            <div className="grid h-full sm:grid-cols-[1.1fr_1fr]">
              <div className="p-7">
                <FeatureTitle icon={<Sparkles className="h-4 w-4" />} title="Decision drift detection" />
                <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
                  The owner confirms a decision; Accord traces the operative code path and the stored data, and posts a
                  conflict with record-level impact.
                </p>
                <ol className="mt-6 space-y-2 font-mono text-[12px]">
                  {[['source', 'retention.idl.json'], ['generated', 'retention-policy.json'], ['runtime', 'policy-resolver.ts']].map(([k, v], i) => (
                    <li key={k} className="flex items-center gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-[10px] text-zinc-500">{i + 1}</span>
                      <span className="w-16 shrink-0 text-zinc-400">{k}</span>
                      <span className="truncate text-zinc-800">{v}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="bg-dots flex flex-col justify-center gap-5 border-t border-zinc-100 bg-zinc-50/60 p-7 sm:border-l sm:border-t-0">
                <Bar label="Decided by the team" value="90 days" width="100%" tone="bg-sky-500" />
                <Bar label="Enforced in code" value="30 days" width="33%" tone="bg-amber-400" />
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-[13px] text-rose-700 shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <b className="font-semibold">7 records</b> at risk across 2 accounts
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.05} className="card-border rounded-3xl p-7 md:col-span-2">
            <FeatureTitle icon={<ListOrdered className="h-4 w-4" />} title="Ranked change suggestions" />
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
              Describe a change; get up to three approaches ranked by fit, risk, effort, testability and security.
            </p>
            <div className="mt-5 space-y-2">
              {[['#1', 'Extend the policy IDL', '9/10'], ['#2', 'Runtime override', '6/10'], ['#3', 'External service', '4/10']].map(([r, t, s], i) => (
                <div key={r} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px] ${i === 0 ? 'border-accent-500/30 bg-accent-500/[0.08]' : 'border-zinc-200/80 bg-zinc-50'}`}>
                  <span className="font-mono text-zinc-500">{r}</span>
                  <span className="flex-1 truncate text-zinc-800">{t}</span>
                  <span className="font-mono text-zinc-600">{s}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.05} className="card-border rounded-3xl p-7 md:col-span-2">
            <FeatureTitle icon={<Code2 className="h-4 w-4" />} title="Grounded code answers" />
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
              Searches and reads the repository at a pinned commit, and cites files with line ranges and links.
            </p>
          </Reveal>

          <Reveal delay={0.1} className="card-border rounded-3xl p-7 md:col-span-2">
            <FeatureTitle icon={<GitPullRequest className="h-4 w-4" />} title="GitHub activity" />
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
              Recent commits, who last changed a file, open issues and pull requests, straight from the GitHub API.
            </p>
          </Reveal>

          <Reveal delay={0.15} className="card-border rounded-3xl p-7 md:col-span-2">
            <FeatureTitle icon={<History className="h-4 w-4" />} title="Versioned decisions" />
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
              Tentative, amended and withdrawn decisions each get a version. Only the owner can make one binding.
            </p>
          </Reveal>

          <Reveal className="card-border flex flex-col justify-between gap-6 rounded-3xl p-7 md:col-span-6 md:flex-row md:items-center">
            <div>
              <FeatureTitle icon={<ShieldCheck className="h-4 w-4" />} title="Private by construction" />
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-zinc-600">
                Secret-bearing files are never read, credential-shaped text is redacted before the model sees it, and
                data queries return aggregate counts only.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {['.env blocked', 'Keys redacted', 'Counts only', 'No writes'].map((chip) => (
                <span key={chip} className="rounded-full border border-emerald-500/20 bg-emerald-400/[0.07] px-3 py-1.5 text-[12.5px] text-emerald-700">
                  {chip}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function FeatureTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-accent-600">{icon}</span>
      <h3 className="text-[17px] font-semibold tracking-tight text-zinc-900">{title}</h3>
    </div>
  );
}

function Bar({ label, value, width, tone }: { label: string; value: string; width: string; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-zinc-500">{label}</span>
        <span className="font-semibold tabular-nums text-zinc-900">{value}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-200/70">
        <div className={`h-full rounded-full ${tone}`} style={{ width }} />
      </div>
    </div>
  );
}
