'use client';

import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { StarButton } from './StarButton';
import { ProductDemo } from './ProductDemo';

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-32 sm:pt-40">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] -z-10 h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.22),rgba(45,212,191,0.10)_60%,transparent)]" />

      <div className="mx-auto max-w-4xl px-5 text-center sm:px-6">
        <motion.a
          {...rise(0)}
          href="#features"
          className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 py-1 pl-1 pr-3 text-[13px] text-zinc-600 shadow-sm backdrop-blur transition hover:border-zinc-300"
        >
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">New</span>
          Ranked change suggestions, grounded in your code
          <ArrowRight className="h-3.5 w-3.5 text-zinc-400" />
        </motion.a>

        <motion.h1
          {...rise(0.06)}
          className="mt-7 text-balance text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.045em] text-zinc-900 sm:text-[4.25rem] lg:text-[5rem]"
        >
          Your team decided.
          <br />
          <span className="text-gradient">Does your code agree?</span>
        </motion.h1>

        <motion.p {...rise(0.12)} className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-zinc-600 sm:text-lg">
          Accord is a grounded agent that checks your team&rsquo;s decisions against the real code and data they affect,
          wherever those decisions are made. Every answer cites its evidence, and nothing is guessed.
        </motion.p>

        <motion.div {...rise(0.18)} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#contact"
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-[15px] font-medium text-white shadow-[0_10px_30px_-10px_rgba(24,24,40,0.5)] transition hover:bg-zinc-700 sm:w-auto"
          >
            Request a demo
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <StarButton variant="hero" />
        </motion.div>

        <motion.p {...rise(0.24)} className="mt-5 text-[13px] text-zinc-500">
          Open source · Read-only access · Evidence you can check
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto mt-16 max-w-6xl px-3 sm:mt-20 sm:px-6"
      >
        <ProductDemo />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#fbfbfe] to-transparent" />
      </motion.div>
    </section>
  );
}
