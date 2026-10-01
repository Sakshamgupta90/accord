import { Reveal } from './Reveal';

export function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: React.ReactNode; body?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-accent-600">{eyebrow}</p>
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-900 sm:text-[2.6rem] sm:leading-[1.1]">{title}</h2>
      {body && <p className="mt-5 text-pretty text-[16.5px] leading-relaxed text-zinc-600">{body}</p>}
    </Reveal>
  );
}
