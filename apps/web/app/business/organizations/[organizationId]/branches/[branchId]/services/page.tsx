import { BranchServices } from '@/components/branch-services';
export default async function ServicesPage({
  params,
}: {
  params: Promise<{ organizationId: string; branchId: string }>;
}) {
  const { organizationId, branchId } = await params;
  return (
    <main className="organizations-page">
      <h1>Branch services</h1>
      <BranchServices organizationId={organizationId} branchId={branchId} />
    </main>
  );
}
