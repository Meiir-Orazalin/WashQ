import type { Metadata } from 'next';
import { Branches } from '@/components/branches';
export const metadata: Metadata = { title: 'Organization branches · WashQueue KZ' };
export default async function BranchesPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return (
    <main className="organizations-page">
      <header>
        <p className="eyebrow">WashQueue KZ</p>
        <h1>Your branches</h1>
      </header>
      <Branches organizationId={organizationId} />
    </main>
  );
}
