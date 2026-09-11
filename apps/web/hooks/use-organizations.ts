'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationIdParamsSchema, type CreateOrganizationRequest } from '@washqueue/contracts';
import { useEffect, useRef } from 'react';
import {
  createOrganization,
  getOwnedOrganization,
  listOwnedOrganizations,
} from '@/lib/organization-api-client';
import { useAuthentication } from '@/providers/authentication-provider';

export const organizationListKey = (userId: string) => ['organizations', userId] as const;
export const organizationDetailKey = (userId: string, organizationId: string) =>
  ['organization', userId, organizationId] as const;

/** Both route caches belong to this authenticated identity, not the provider. */
export function useOrganizationCacheBoundary(userId: string) {
  const client = useQueryClient();
  useEffect(
    () => () => {
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          (query.queryKey[0] === 'organizations' || query.queryKey[0] === 'organization') &&
          query.queryKey[1] === userId,
      };
      void client.cancelQueries(filters);
      client.removeQueries(filters);
    },
    [client, userId],
  );
}

export function useOwnedOrganizations(userId: string) {
  const { runWithAccessToken, status, currentUser } = useAuthentication();
  const client = useQueryClient();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const enabled = status === 'authenticated' && currentUser?.id === userId;
  const query = useQuery({
    queryKey: organizationListKey(userId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => runWithAccessToken((token) => listOwnedOrganizations(token, signal)),
  });
  const mutation = useMutation({
    mutationKey: ['organizations', userId, 'create'],
    retry: false,
    gcTime: 0,
    mutationFn: async ({
      input,
      signal,
    }: {
      input: CreateOrganizationRequest;
      signal: AbortSignal;
    }): Promise<void> => {
      await runWithAccessToken((token) => createOrganization(token, input, signal));
      if (active.current && !signal.aborted)
        await client.invalidateQueries({ queryKey: organizationListKey(userId), exact: true });
    },
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, [userId]);
  async function submit(input: CreateOrganizationRequest): Promise<boolean> {
    if (!enabled || !active.current || request.current) return false;
    const abort = new AbortController();
    request.current = abort;
    try {
      await mutation.mutateAsync({ input, signal: abort.signal });
      return active.current && !abort.signal.aborted;
    } catch {
      return false;
    } finally {
      if (request.current === abort) request.current = null;
    }
  }
  return { query, mutation, submit };
}

export function useOwnedOrganization(userId: string, organizationId: string) {
  const { runWithAccessToken, status, currentUser } = useAuthentication();
  const validId = organizationIdParamsSchema.safeParse({ organizationId }).success;
  const query = useQuery({
    queryKey: organizationDetailKey(userId, organizationId),
    enabled: validId && status === 'authenticated' && currentUser?.id === userId,
    retry: false,
    queryFn: ({ signal }) =>
      runWithAccessToken((token) => getOwnedOrganization(token, organizationId, signal)),
  });
  return { query, validId };
}
