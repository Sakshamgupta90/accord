import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export const metadata: Metadata = { title: 'Dashboard · Accord' };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/signin');

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/' });
  }

  const user = { name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null };
  return <DashboardShell user={user} signOutAction={signOutAction}>{children}</DashboardShell>;
}
