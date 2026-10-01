import type { Metadata } from 'next';
import { Integrations } from '@/components/dashboard/Integrations';

export const metadata: Metadata = { title: 'Integrations · Accord' };

export default function IntegrationsPage() {
  return <Integrations />;
}
