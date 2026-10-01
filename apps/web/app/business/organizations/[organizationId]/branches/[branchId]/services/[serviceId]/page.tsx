import { BranchServices } from '@/components/branch-services';
export default async function ServicePage({
  params,
}: {
  params: Promise<{ organizationId: string; branchId: string; serviceId: string }>;
}) {
  const { organizationId, branchId, serviceId } = await params;
  return (
    <main className="organizations-page">
      <h1>Service</h1>
      <BranchServices organizationId={organizationId} branchId={branchId} serviceId={serviceId} />
    </main>
  );
}
