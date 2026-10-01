import type { Metadata } from 'next';
import { Knowledge } from '@/components/dashboard/Knowledge';

export const metadata: Metadata = { title: 'Knowledge base · Accord' };

export default function KnowledgePage() {
  return <Knowledge />;
}
