'use client';

import { useId } from 'react';

/** Accord mark: two overlapping rounded squares that align — a decision and its implementation. */
export function Logo({ className = '' }: { className?: string }) {
  // Unique per instance: a gradient defined inside a hidden copy would otherwise break the others.
  const gradient = `accord-logo-${useId().replace(/:/g, '')}`;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c4b5fd" />
            <stop offset="1" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="17" height="17" rx="5" fill="none" stroke={`url(#${gradient})`} strokeWidth="2.5" />
        <rect x="12" y="12" width="17" height="17" rx="5" fill={`url(#${gradient})`} opacity="0.9" />
        <path d="M16.5 20.5l2.5 2.5 5-5" fill="none" stroke="#07070b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-zinc-900">Accord</span>
    </span>
  );
}
