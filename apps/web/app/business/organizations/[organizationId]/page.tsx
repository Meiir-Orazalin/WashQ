import type { Metadata } from 'next';
import { OrganizationDetail } from '@/components/organization-detail';

export const metadata: Metadata = { title: 'Organization details · WashQueue KZ' };
export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return (
    <main className="organizations-page">
      <header>
        <p className="eyebrow">WashQueue KZ</p>
        <h1>Your organization</h1>
      </header>
      <OrganizationDetail organizationId={organizationId} />
    </main>
  );
}
