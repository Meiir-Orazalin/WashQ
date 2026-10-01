import { WashBoxes } from '@/components/wash-boxes';
export default async function WashBoxPage({
  params,
}: {
  params: Promise<{ organizationId: string; branchId: string; washBoxId: string }>;
}) {
  const { organizationId, branchId, washBoxId } = await params;
  return (
    <main className="organizations-page">
      <h1>Wash box</h1>
      <WashBoxes organizationId={organizationId} branchId={branchId} washBoxId={washBoxId} />
    </main>
  );
}
