'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FAQS, GITHUB_URL } from '@/lib/site';
import { Reveal } from './Reveal';

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-accent-600">FAQ</p>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-900 sm:text-[2.6rem] sm:leading-[1.1]">
            Questions, answered plainly
          </h2>
          <p className="mt-5 max-w-sm text-[16px] leading-relaxed text-zinc-600">
            Can&rsquo;t find what you need? Read the code on{' '}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900">
              GitHub
            </a>{' '}
            or{' '}
            <a href="#contact" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900">
              get in touch
            </a>
            .
          </p>
        </Reveal>

        <Reveal delay={0.08} className="divide-y divide-zinc-200 border-y border-zinc-200">
          {FAQS.map((item, index) => {
            const isOpen = open === index;
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${index}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${index}`}
                    onClick={() => setOpen(isOpen ? null : index)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left text-[16px] font-medium text-zinc-900 transition hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                  >
                    {item.q}
                    <Plus className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`} />
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-a-${index}`}
                      role="region"
                      aria-labelledby={`faq-q-${index}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-zinc-600">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
