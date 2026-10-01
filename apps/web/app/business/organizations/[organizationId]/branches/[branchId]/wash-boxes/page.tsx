import { WashBoxes } from '@/components/wash-boxes';
export default async function WashBoxesPage({
  params,
}: {
  params: Promise<{ organizationId: string; branchId: string }>;
}) {
  const { organizationId, branchId } = await params;
  return (
    <main className="organizations-page">
      <h1>Branch wash boxes</h1>
      <WashBoxes organizationId={organizationId} branchId={branchId} />
    </main>
  );
}
