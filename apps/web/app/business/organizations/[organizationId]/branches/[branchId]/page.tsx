import type { Metadata } from 'next';
import { BranchDetail } from '@/components/branch-detail';
export const metadata: Metadata = { title: 'Branch and opening hours · WashQueue KZ' };
export default async function BranchPage({
  params,
}: {
  params: Promise<{ organizationId: string; branchId: string }>;
}) {
  const { organizationId, branchId } = await params;
  return (
    <main className="organizations-page">
      <header>
        <p className="eyebrow">WashQueue KZ</p>
        <h1>Your branch</h1>
      </header>
      <BranchDetail organizationId={organizationId} branchId={branchId} />
    </main>
  );
}
