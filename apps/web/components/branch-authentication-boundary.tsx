'use client';
import type { ReactNode } from 'react';
import { useBranchCacheBoundary } from '@/hooks/use-branches';
import { OrganizationAuthenticationBoundary } from './organization-authentication-boundary';
export function BranchAuthenticationBoundary({
  children,
}: {
  children: (userId: string) => ReactNode;
}) {
  return (
    <OrganizationAuthenticationBoundary>
      {(userId) => (
        <BranchCacheBoundary key={userId} userId={userId}>
          {children(userId)}
        </BranchCacheBoundary>
      )}
    </OrganizationAuthenticationBoundary>
  );
}
function BranchCacheBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  useBranchCacheBoundary(userId);
  return children;
}
