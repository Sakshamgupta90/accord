import { auth } from '@/auth';
import { Overview } from '@/components/dashboard/Overview';

export default async function DashboardPage() {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.email ?? 'there';
  return <Overview firstName={name.split(/[\s@]/)[0]} />;
}
