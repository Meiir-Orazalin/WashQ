'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuthentication } from '@/providers/authentication-provider';
import { useOrganizationCacheBoundary } from '@/hooks/use-organizations';
import { LoginForm } from './login-form';

export function OrganizationAuthenticationBoundary({
  children,
}: {
  children: (userId: string) => ReactNode;
}) {
  const authentication = useAuthentication();
  if (authentication.status !== 'authenticated' || !authentication.currentUser)
    return (
      <>
        {authentication.status === 'unauthenticated' ||
        authentication.status === 'authenticating' ? (
          <p role="status">Sign in to create and view your organizations.</p>
        ) : (
          <LoginForm />
        )}
        <nav className="form-links" aria-label="Organization account options">
          <Link href="/login">Sign in</Link>
          <Link href="/">Back to home</Link>
        </nav>
      </>
    );
  const user = authentication.currentUser;
  return (
    <>
      <p>
        Signed in as{' '}
        <strong>
          {user.firstName} {user.lastName}
        </strong>
      </p>
      <nav className="authentication-actions" aria-label="Account options">
        <Link href="/profile">Your profile</Link>
        <Link href="/vehicles">Your vehicles</Link>
        <Link href="/login">Manage sign-in</Link>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void authentication.logout()}
        >
          Sign out
        </button>
        <Link href="/">Back to home</Link>
      </nav>
      <OwnedOrganizationBoundary key={user.id} userId={user.id}>
        {children(user.id)}
      </OwnedOrganizationBoundary>
    </>
  );
}

function OwnedOrganizationBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  useOrganizationCacheBoundary(userId);
  return children;
}
