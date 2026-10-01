import { siGithub } from 'simple-icons';

/** An official brand logo on a square tile. Logos designed for dark backgrounds get a dark tile. */
export function LogoTile({ name, logo, tile, size = 'md' }: { name: string; logo: string; tile?: 'dark'; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-9 w-9 rounded-lg' : 'h-12 w-12 rounded-xl';
  const img = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';
  return (
    <span
      className={`flex shrink-0 items-center justify-center border ${box} ${
        tile === 'dark' ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200/80 bg-white'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/logos/${logo}`} alt={`${name} logo`} className={`${img} object-contain`} loading="lazy" draggable={false} />
    </span>
  );
}

export function GitHubMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d={siGithub.path} />
    </svg>
  );
}
