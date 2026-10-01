'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GITHUB_URL, NAV_LINKS } from '@/lib/site';
import { Logo } from './Logo';
import { GitHubMark } from './TechIcon';
import { StarButton } from './StarButton';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => window.innerWidth >= 768 && setMenuOpen(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6">
        <nav
          className={`mx-auto flex h-14 max-w-6xl items-center justify-between rounded-2xl px-4 transition-all duration-300 sm:px-5 ${
            scrolled || menuOpen
              ? 'border border-zinc-200 bg-white/80 shadow-[0_8px_30px_-12px_rgba(24,24,40,0.18)] backdrop-blur-xl'
              : 'border border-transparent'
          }`}
          aria-label="Main"
        >
          <a href="#top" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-400">
            <Logo />
          </a>

          <ul className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-accent-400"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <StarButton variant="nav" />
            <Link
              href="/signin"
              className="inline-flex h-9 items-center whitespace-nowrap rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
            >
              Sign in
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-700 hover:bg-zinc-100 md:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="mx-auto mt-2 max-w-6xl rounded-2xl border border-zinc-200 bg-white/80 p-2 backdrop-blur-xl md:hidden"
            >
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-xl px-4 py-3 text-[15px] text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  {link.label}
                </a>
              ))}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-[15px] text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <GitHubMark /> GitHub
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

    </>
  );
}
