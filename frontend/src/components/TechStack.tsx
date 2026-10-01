import { TECHNOLOGIES } from '@/lib/site';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';
import { LogoTile } from './TechIcon';

const half = Math.ceil(TECHNOLOGIES.length / 2);
const ROWS = [TECHNOLOGIES.slice(0, half), TECHNOLOGIES.slice(half)];

export function TechStack() {
  return (
    <section id="stack" className="scroll-mt-24 overflow-hidden py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          eyebrow="Built with"
          title="A stack you already trust"
          body="Each piece has one job. Contracts are validated at every boundary, so a failure shows up as incomplete evidence, never as a wrong answer."
        />
      </div>

      <Reveal className="mask-fade-x mt-14 space-y-4" delay={0.1}>
        {ROWS.map((row, index) => (
          <Marquee key={index} items={row} reverse={index === 1} />
        ))}
      </Reveal>

      <p className="mt-10 text-center text-[13px] text-zinc-500">
        {TECHNOLOGIES.length} technologies · hover to pause
      </p>
    </section>
  );
}

function Marquee({ items, reverse }: { items: typeof TECHNOLOGIES; reverse?: boolean }) {
  // The list is rendered twice and the track moves by exactly half its width, so the loop is seamless.
  const loop = [...items, ...items];
  return (
    <div className="group flex overflow-hidden" aria-label="Technologies used by Accord">
      <ul
        className="marquee-track flex w-max shrink-0 animate-marquee gap-4 pr-4 motion-reduce:animate-none"
        style={reverse ? { animationDirection: 'reverse', animationDuration: '46s' } : undefined}
      >
        {loop.map((tech, index) => (
          <li
            key={`${tech.name}-${index}`}
            aria-hidden={index >= items.length}
            className="card-border flex w-[320px] items-center gap-4 rounded-2xl px-5 py-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(40,30,90,0.25)]"
          >
            <LogoTile name={tech.name} logo={tech.logo} tile={tech.tile} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight text-zinc-900">{tech.name}</div>
              <div className="mt-0.5 truncate text-[13px] text-zinc-500">{tech.role}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
