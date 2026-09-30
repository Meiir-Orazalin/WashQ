'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  organizationIdParamsSchema,
  branchIdParamsSchema,
  type CreateBranchRequest,
  type ReplaceOpeningHoursRequest,
} from '@washqueue/contracts';
import { useEffect, useRef } from 'react';
import {
  createBranch,
  listOwnedBranches,
  getOwnedBranch,
  replaceOpeningHours,
} from '@/lib/branch-api-client';
import { useAuthentication } from '@/providers/authentication-provider';

export const branchListKey = (userId: string, organizationId: string) =>
  ['branches', userId, organizationId] as const;
export const branchDetailKey = (userId: string, organizationId: string, branchId: string) =>
  ['branch', userId, organizationId, branchId] as const;
export function useBranchCacheBoundary(userId: string) {
  const client = useQueryClient();
  useEffect(
    () => () => {
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          (query.queryKey[0] === 'branches' || query.queryKey[0] === 'branch') &&
          query.queryKey[1] === userId,
      };
      void client.cancelQueries(filters);
      client.removeQueries(filters);
    },
    [client, userId],
  );
}
export function useOwnedBranches(userId: string, organizationId: string) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const validId = organizationIdParamsSchema.safeParse({ organizationId }).success;
  const query = useQuery({
    queryKey: branchListKey(userId, organizationId),
    enabled: validId && status === 'authenticated' && currentUser?.id === userId,
    retry: false,
    queryFn: ({ signal }) =>
      runWithAccessToken((token) => listOwnedBranches(token, organizationId, signal)),
  });
  return { query, validId };
}
export function useOwnedBranch(userId: string, organizationId: string, branchId: string) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const validId = branchIdParamsSchema.safeParse({ organizationId, branchId }).success;
  const query = useQuery({
    queryKey: branchDetailKey(userId, organizationId, branchId),
    enabled: validId && status === 'authenticated' && currentUser?.id === userId,
    retry: false,
    queryFn: ({ signal }) =>
      runWithAccessToken((token) => getOwnedBranch(token, organizationId, branchId, signal)),
  });
  return { query, validId };
}
/** No optimistic writes; each completion must pass provider generations and mounted/abort checks. */
export function useBranchWrite(userId: string, organizationId: string, branchId?: string) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const client = useQueryClient();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationKey: ['branches', userId, organizationId, branchId ?? 'create', 'write'],
    retry: false,
    gcTime: 0,
    mutationFn: async ({
      input,
      signal,
    }: {
      input: CreateBranchRequest | ReplaceOpeningHoursRequest;
      signal: AbortSignal;
    }): Promise<void> => {
      await runWithAccessToken(async (token) => {
        if ('openingHours' in input && branchId)
          await replaceOpeningHours(token, organizationId, branchId, input, signal);
        else if ('name' in input && !branchId)
          await createBranch(token, organizationId, input, signal);
        else throw new Error('Invalid branch operation');
      });
      if (active.current && !signal.aborted)
        await client.invalidateQueries({
          queryKey: branchId
            ? branchDetailKey(userId, organizationId, branchId)
            : branchListKey(userId, organizationId),
          exact: true,
        });
    },
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, [userId, organizationId, branchId]);
  async function submit(input: CreateBranchRequest | ReplaceOpeningHoursRequest): Promise<boolean> {
    if (
      status !== 'authenticated' ||
      currentUser?.id !== userId ||
      !active.current ||
      request.current
    )
      return false;
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
  return { mutation, submit };
}
