'use client';

import Link from 'next/link';
import { useOwnedOrganization } from '@/hooks/use-organizations';
import { ApiClientError } from '@/lib/api-client';
import { OrganizationAuthenticationBoundary } from './organization-authentication-boundary';

export function OrganizationDetail({ organizationId }: { organizationId: string }) {
  return (
    <OrganizationAuthenticationBoundary>
      {(userId) => <OwnedOrganizationDetail userId={userId} organizationId={organizationId} />}
    </OrganizationAuthenticationBoundary>
  );
}
function OwnedOrganizationDetail({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const { query, validId } = useOwnedOrganization(userId, organizationId);
  return (
    <>
      {!validId ? (
        <p role="alert">Invalid organization address.</p>
      ) : query.isPending ? (
        <p role="status">Loading your organization…</p>
      ) : query.isError ? (
        <p role="alert">
          {query.error instanceof ApiClientError &&
          query.error.status === 404 &&
          query.error.code === 'ORGANIZATION_NOT_FOUND'
            ? 'This organization is not available.'
            : 'We could not load your organization.'}
        </p>
      ) : (
        <section aria-label="Organization details">
          <h2>{query.data.organization.name}</h2>
          {query.data.organization.description ? (
            <p className="organization-description">{query.data.organization.description}</p>
          ) : null}
          <p>
            Created{' '}
            <time dateTime={query.data.organization.createdAt}>
              {query.data.organization.createdAt.slice(0, 10)} (UTC)
            </time>
          </p>
          <p>Branches will be added in the next version.</p>
        </section>
      )}
      <Link href="/business/organizations">Back to your organizations</Link>
    </>
  );
}
