import { GITHUB_URL } from '@/lib/site';
import { Logo } from './Logo';
import { Reveal } from './Reveal';
import { StarButton } from './StarButton';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Features', href: '#features' },
      { label: 'Architecture', href: '#architecture' },
      { label: 'Tech stack', href: '#stack' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'GitHub repository', href: GITHUB_URL, external: true },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Request a demo', href: '#contact' },
      { label: 'Contact', href: '#contact' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative pt-8">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <Reveal className="relative overflow-hidden rounded-3xl bg-zinc-900 px-6 py-16 text-center sm:px-12">
          <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.45),transparent)] blur-2xl" />
          <h2 className="relative mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-[-0.03em] text-white sm:text-[2.6rem] sm:leading-[1.1]">
            Keep what you decided and what you shipped in accord.
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg text-[16px] text-zinc-400">
            Open source and read-only by design. A star helps other builders find it.
          </p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#contact" className="inline-flex h-12 items-center rounded-xl bg-white px-6 text-[15px] font-medium text-zinc-900 transition hover:bg-zinc-200">
              Request a demo
            </a>
            <StarButton variant="cta" />
          </div>
        </Reveal>

        <div className="grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-zinc-500">
              A grounded agent that checks your team&rsquo;s decisions against the real code and data, and answers only with evidence.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <div className="text-[13px] font-semibold text-zinc-900">{column.title}</div>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...('external' in link ? { target: '_blank', rel: 'noreferrer' } : {})}
                      className="text-[14px] text-zinc-500 transition hover:text-zinc-900"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-zinc-200 py-8 text-[13px] text-zinc-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Accord. MIT licensed.</p>
          <p>Built with Gemini, CopilotKit, Trigger.dev, PostgreSQL and ClickHouse.</p>
        </div>
      </div>
    </footer>
  );
}
