import Link from 'next/link';
import { ArrowRight, BookOpen, Lock } from 'lucide-react';

/** Locked until connectors can index real content. The page explains what it will hold. */
export function Knowledge() {
  return (
    <div>
      <header>
        <p className="text-[13px] font-medium text-violet-600">Knowledge base</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold tracking-[-0.03em] text-zinc-900 sm:text-[1.75rem]">What Accord knows</h1>
      </header>

      <div className="card-border relative mt-8 overflow-hidden rounded-3xl px-6 py-16 text-center sm:py-20">
        <div className="bg-dots pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative mx-auto max-w-md">
          <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-500 shadow-sm">
            <BookOpen className="h-6 w-6" />
            <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-white ring-4 ring-white">
              <Lock className="h-3 w-3" />
            </span>
          </span>
          <h2 className="mt-6 text-xl font-semibold tracking-tight text-zinc-900">Knowledge base is locked</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
            It unlocks once your tools are connected. Every entry will come from a connected source, with a link back
            to where it came from.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <Link href="/dashboard/metrics" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-[14px] font-medium text-white transition hover:bg-zinc-700">
              See how Accord uses knowledge <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/dashboard/integrations" className="inline-flex h-10 items-center rounded-lg border border-zinc-200 bg-white px-4 text-[14px] font-medium text-zinc-700 transition hover:border-zinc-300">
              Choose tools
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
