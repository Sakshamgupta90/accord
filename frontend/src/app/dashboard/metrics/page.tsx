import type { Metadata } from 'next';
import { Metrics } from '@/components/dashboard/Metrics';

export const metadata: Metadata = { title: 'Metrics · Accord' };

export default function MetricsPage() {
  return <Metrics />;
}
