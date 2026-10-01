import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import { auth, isProviderEnabled, signIn, type ProviderId } from '@/auth';
import { Logo } from '@/components/Logo';

export const metadata: Metadata = { title: 'Sign in · Accord' };

const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string; logo: string; hint: string }> = [
  { id: 'google', label: 'Continue with Google', logo: 'google.svg', hint: 'Gmail and Google Workspace accounts' },
];

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: 'That email is already linked to a different sign-in method.',
  AccessDenied: 'Access was denied. Please try another account.',
  Configuration: 'Sign-in is not fully configured yet. Please try again later.',
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const session = await auth();
  if (session?.user) redirect('/dashboard');
  const { error } = await searchParams;
  const anyEnabled = PROVIDERS.some((p) => isProviderEnabled(p.id));

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-zinc-900 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.45),transparent)]" />
        <div className="pointer-events-none absolute -bottom-40 right-[-120px] h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(45,212,191,0.25),transparent)]" />
        <Link href="/" className="relative w-fit [&_span]:!text-white">
          <Logo />
        </Link>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-balance text-4xl font-semibold leading-[1.1] tracking-[-0.03em]">
            A grounded agent for your team&rsquo;s decisions.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-zinc-400">
            Connect the tools where your team decides and builds. Accord checks each decision against the real code and
            data, and answers only with evidence it can cite.
          </p>
          <ul className="mt-8 space-y-3 text-[15px] text-zinc-300">
            {['Choose which tools Accord can use', 'See drift and impact metrics in one place', 'A knowledge base built from your connected tools'].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10">
                  <Check className="h-3 w-3" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-16 text-[13px] text-zinc-500">Read-only by design · Private preview</p>
      </section>

      <section className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="inline-flex w-fit items-center gap-1.5 text-[14px] text-zinc-500 transition hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" /> Back to site
        </Link>
        <div className="m-auto w-full max-w-sm py-12">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h1 className="mt-8 text-3xl font-semibold tracking-[-0.03em] text-zinc-900 lg:mt-0">Sign in to Accord</h1>
          <p className="mt-2 text-[15px] text-zinc-600">Use your Google account.</p>

          {error && (
            <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13.5px] text-rose-700">
              {ERRORS[error] ?? 'Sign-in failed. Please try again.'}
            </p>
          )}

          <div className="mt-8 space-y-3">
            {PROVIDERS.map((provider) => {
              const enabled = isProviderEnabled(provider.id);
              return (
                <form
                  key={provider.id}
                  action={async () => {
                    'use server';
                    await signIn(provider.id, { redirectTo: '/dashboard' });
                  }}
                >
                  <button
                    type="submit"
                    disabled={!enabled}
                    className="group flex h-12 w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 text-[15px] font-medium text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/logos/${provider.logo}`} alt="" className="h-5 w-5" />
                    <span className="flex-1 text-left">{provider.label}</span>
                    {!enabled && <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">Not configured</span>}
                  </button>
                  <p className="mt-1.5 pl-1 text-[12.5px] text-zinc-500">{provider.hint}</p>
                </form>
              );
            })}
          </div>

          {!anyEnabled && (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
              Sign-in providers are not configured on this deployment yet. Accord is in private preview;{' '}
              <Link href="/#contact" className="font-medium underline underline-offset-2">request a demo</Link>.
            </p>
          )}

          <p className="mt-10 text-[12.5px] leading-relaxed text-zinc-500">
            Signing in only shares your name, email and profile picture with Accord. It does not give Accord access to
            your mailbox; mail integrations are connected separately from the dashboard.
          </p>
        </div>
      </section>
    </main>
  );
}
