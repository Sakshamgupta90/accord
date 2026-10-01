'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarCheck, CheckCircle2, Loader2, Mail, ShieldCheck, Timer } from 'lucide-react';
import { useState } from 'react';
import { EMAIL_MAX, normalizeDemoRequest, validateDemoRequest } from '@/lib/contact';
import { Reveal } from './Reveal';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

const POINTS = [
  { icon: Timer, label: 'Live walkthrough' },
  { icon: CalendarCheck, label: 'Grounded in real code and data' },
  { icon: ShieldCheck, label: 'Read-only, nothing changes' },
];

export function Contact() {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = normalizeDemoRequest({ email, website });
    const error = validateDemoRequest(input);
    if (error) {
      setStatus({ kind: 'error', message: error });
      document.getElementById('demo-email')?.focus();
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setStatus({ kind: 'sent' });
        setEmail('');
        return;
      }
      setStatus({ kind: 'error', message: data.error ?? 'Something went wrong. Please try again.' });
    } catch {
      setStatus({ kind: 'error', message: 'Network error. Check your connection and try again.' });
    }
  }

  const invalid = status.kind === 'error';

  return (
    <section id="contact" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-5 sm:px-6">
        <Reveal className="card-border relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-14 sm:py-16">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-56 w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.18),transparent)]" />

          <div className="relative">
            <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-accent-600">Request a demo</p>
            <h2 className="mx-auto mt-4 max-w-xl text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-900 sm:text-[2.6rem] sm:leading-[1.1]">
              See Accord on <span className="text-gradient">your own decisions</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-[16.5px] leading-relaxed text-zinc-600">
              Leave your organisation email and we&rsquo;ll reach out to schedule a live demo.
            </p>

            <AnimatePresence mode="wait">
              {status.kind === 'sent' ? (
                <motion.div
                  key="sent"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="status"
                  className="mx-auto mt-9 flex max-w-md items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left"
                >
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                  <div>
                    <div className="text-[15px] font-semibold text-zinc-900">Thanks, request received</div>
                    <div className="text-[13.5px] text-zinc-600">We&rsquo;ll email you to set up a time.</div>
                  </div>
                </motion.div>
              ) : (
                <motion.form key="form" onSubmit={submit} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto mt-9 max-w-md">
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <label htmlFor="demo-email" className="sr-only">Organisation email</label>
                    <div className="relative flex-1">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <input
                        id="demo-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        maxLength={EMAIL_MAX}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          if (status.kind === 'error') setStatus({ kind: 'idle' });
                        }}
                        placeholder="you@company.com"
                        aria-invalid={invalid}
                        aria-describedby="demo-note"
                        className={`h-12 w-full rounded-xl border bg-white pl-10 pr-3.5 text-[15px] text-zinc-900 shadow-[0_1px_2px_rgba(24,24,40,0.04)] placeholder:text-zinc-400 transition focus:outline-none focus:ring-4 ${
                          invalid ? 'border-rose-400 focus:ring-rose-500/15' : 'border-zinc-200 focus:border-accent-500 focus:ring-accent-500/15'
                        }`}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={status.kind === 'sending'}
                      className="group inline-flex h-12 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-zinc-900 px-6 text-[15px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-70"
                    >
                      {status.kind === 'sending' ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                      ) : (
                        <>Request a demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>
                      )}
                    </button>
                  </div>

                  {/* Honeypot for bots: hidden from people and assistive technology. */}
                  <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                    <label htmlFor="demo-website">Website</label>
                    <input id="demo-website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                  </div>

                  <p id="demo-note" role={invalid ? 'alert' : undefined} className={`mt-2.5 min-h-5 text-left text-[13px] ${invalid ? 'text-rose-600' : 'text-zinc-500'}`}>
                    {invalid ? status.message : 'We only use your email to arrange the demo.'}
                  </p>
                </motion.form>
              )}
            </AnimatePresence>

            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13.5px] text-zinc-600">
              {POINTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-1.5">
                  <Icon className="h-4 w-4 text-violet-600" /> {label}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
