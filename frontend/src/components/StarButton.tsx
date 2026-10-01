'use client';

import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GITHUB_REPO, GITHUB_URL } from '@/lib/site';
import { GitHubMark } from './TechIcon';

const CACHE_KEY = `stars:${GITHUB_REPO}`;
const CACHE_MS = 10 * 60 * 1000;

/** Live stargazer count from the public GitHub API, cached per visitor for ten minutes. */
function useStarCount(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as { n: number; at: number } | null;
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setStars(cached.n);
        return;
      }
    } catch {
      // Storage unavailable (private mode): fall through to the network.
    }
    const controller = new AbortController();
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (typeof data?.stargazers_count !== 'number') return;
        setStars(data.stargazers_count);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ n: data.stargazers_count, at: Date.now() }));
        } catch {
          // Ignore: the count is a nicety.
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return stars;
}

const format = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

type Variant = 'nav' | 'hero' | 'cta';

const STYLES: Record<Variant, string> = {
  nav: 'hidden sm:inline-flex h-9 gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 hover:border-zinc-300 hover:text-zinc-900',
  hero: 'inline-flex h-12 w-full justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-6 text-[15px] font-medium text-zinc-800 shadow-sm hover:border-zinc-300 sm:w-auto',
  cta: 'inline-flex h-12 gap-2 rounded-xl border border-white/15 bg-white/5 px-6 text-[15px] font-medium text-white hover:bg-white/10',
};

const LABELS: Record<Variant, string> = {
  nav: 'Star',
  hero: 'Star on GitHub',
  cta: 'Star on GitHub',
};

/** A "star the repo" link: GitHub mark, label, and the live count once it is above zero. */
export function StarButton({ variant, className = '' }: { variant: Variant; className?: string }) {
  const stars = useStarCount();
  const showCount = stars !== null && stars > 0;
  const countTone = variant === 'cta' ? 'border-white/20 text-white/90' : 'border-zinc-200 text-zinc-600';
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={showCount ? `${LABELS[variant]}, ${stars} stars` : LABELS[variant]}
      className={`group items-center whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ${STYLES[variant]} ${className}`}
    >
      <GitHubMark className={variant === 'nav' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
      <Star className="h-4 w-4 text-amber-500 transition-transform duration-300 group-hover:rotate-[72deg] group-hover:scale-110" fill="currentColor" />
      {LABELS[variant]}
      {showCount && (
        <span className={`ml-1 rounded-md border px-1.5 py-px text-[12px] font-semibold tabular-nums ${countTone}`}>{format(stars)}</span>
      )}
    </a>
  );
}
