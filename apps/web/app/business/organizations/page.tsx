import type { Metadata } from 'next';
import { Organizations } from '@/components/organizations';

export const metadata: Metadata = { title: 'Your organizations · WashQueue KZ' };
export default function OrganizationsPage() {
  return (
    <main className="organizations-page">
      <header>
        <p className="eyebrow">WashQueue KZ</p>
        <h1>Your business organizations</h1>
      </header>
      <Organizations />
    </main>
  );
}
