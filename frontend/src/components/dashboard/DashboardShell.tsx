'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, BookOpen, LayoutGrid, Lock, LogOut, Plug, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '../Logo';

type NavItem = { href: string; label: string; short: string; icon: typeof LayoutGrid; locked?: boolean };

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', short: 'Overview', icon: LayoutGrid },
  { href: '/dashboard/metrics', label: 'Metrics', short: 'Metrics', icon: Activity },
  { href: '/dashboard/integrations', label: 'Integrations', short: 'Tools', icon: Plug },
  { href: '/dashboard/knowledge', label: 'Knowledge base', short: 'Knowledge', icon: BookOpen, locked: true },
];

export interface DashboardUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

export function DashboardShell({ user, signOutAction, children }: { user: DashboardUser; signOutAction: () => Promise<void>; children: React.ReactNode }) {
  const pathname = usePathname();
  const initials = (user.name ?? user.email ?? '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const isActive = (href: string) => (href === '/dashboard' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-dvh bg-[#fbfbfe] lg:grid lg:grid-cols-[248px_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-zinc-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/"><Logo /></Link>
        </div>
        <nav className="flex flex-col gap-1 px-3 pt-2" aria-label="Dashboard">
          {NAV.map((item) => (
            <SideLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
          <span className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-zinc-400" title="Coming soon">
            <Settings className="h-4 w-4" /> Settings
            <span className="ml-auto rounded bg-zinc-100 px-1.5 text-[10.5px] font-medium">Soon</span>
          </span>
        </nav>
        <div className="mt-auto border-t border-zinc-200 p-4">
          <UserInfo user={user} initials={initials} />
          <form action={signOutAction} className="mt-3">
            <button type="submit" className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* mobile + tablet top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:hidden">
        <Link href="/"><Logo /></Link>
        <UserMenu user={user} initials={initials} signOutAction={signOutAction} />
      </header>

      <main className="min-w-0 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12 lg:pt-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {/* mobile + tablet bottom tab bar */}
      <nav
        aria-label="Dashboard"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.map(({ href, short, icon: Icon, locked }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${active ? 'text-violet-700' : 'text-zinc-500'}`}
            >
              {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-violet-600" />}
              <span className="relative">
                <Icon className="h-5 w-5" />
                {locked && <Lock className="absolute -right-2 -top-1 h-3 w-3 rounded-full bg-white text-zinc-400" />}
              </span>
              {short}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const { href, label, icon: Icon, locked } = item;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition ${
        active ? 'bg-zinc-900 text-white' : locked ? 'text-zinc-400 hover:bg-zinc-50' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      {locked && <Lock className={`ml-auto h-3.5 w-3.5 ${active ? 'text-white/70' : 'text-zinc-400'}`} />}
    </Link>
  );
}

function Avatar({ user, initials, size = 'h-8 w-8' }: { user: DashboardUser; initials: string; size?: string }) {
  return user.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.image} alt="" referrerPolicy="no-referrer" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-teal-400 text-[12px] font-semibold text-white`}>{initials}</span>
  );
}

function UserInfo({ user, initials }: { user: DashboardUser; initials: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar user={user} initials={initials} />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-zinc-900">{user.name ?? 'Signed in'}</div>
        <div className="truncate text-[12px] text-zinc-500">{user.email}</div>
      </div>
    </div>
  );
}

function UserMenu({ user, initials, signOutAction }: { user: DashboardUser; initials: string; signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label="Account menu" className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500">
        <Avatar user={user} initials={initials} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-11 w-64 rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(24,24,40,0.25)]"
          >
            <UserInfo user={user} initials={initials} />
            <form action={signOutAction} className="mt-3 border-t border-zinc-100 pt-3">
              <button type="submit" role="menuitem" className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
