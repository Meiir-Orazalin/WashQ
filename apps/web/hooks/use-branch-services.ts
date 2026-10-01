'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  branchIdParamsSchema,
  branchServiceIdParamsSchema,
  type CreateBranchServiceRequest,
  type UpdateBranchServiceRequest,
} from '@washqueue/contracts';
import { useEffect, useRef } from 'react';
import {
  createBranchService,
  listBranchServices,
  getBranchService,
  updateBranchService,
} from '@/lib/branch-service-api-client';
import { useAuthentication } from '@/providers/authentication-provider';

export const branchServiceListKey = (userId: string, organizationId: string, branchId: string) =>
  ['branch-services', userId, organizationId, branchId] as const;
export const branchServiceDetailKey = (
  userId: string,
  organizationId: string,
  branchId: string,
  serviceId: string,
) => ['branch-service', userId, organizationId, branchId, serviceId] as const;
export function useBranchServiceCacheBoundary(
  userId: string,
  organizationId: string,
  branchId: string,
) {
  const client = useQueryClient();
  useEffect(
    () => () => {
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          (query.queryKey[0] === 'branch-services' || query.queryKey[0] === 'branch-service') &&
          query.queryKey[1] === userId,
      };
      void client.cancelQueries(filters);
      client.removeQueries(filters);
    },
    [client, userId, organizationId, branchId],
  );
}
export function useBranchServices(
  userId: string,
  organizationId: string,
  branchId: string,
  serviceId?: string,
) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const validId = serviceId
    ? branchServiceIdParamsSchema.safeParse({ organizationId, branchId, serviceId }).success
    : branchIdParamsSchema.safeParse({ organizationId, branchId }).success;
  const query = useQuery({
    queryKey: serviceId
      ? branchServiceDetailKey(userId, organizationId, branchId, serviceId)
      : branchServiceListKey(userId, organizationId, branchId),
    enabled: validId && status === 'authenticated' && currentUser?.id === userId,
    retry: false,
    queryFn: async ({ signal }) =>
      runWithAccessToken(async (token) =>
        serviceId
          ? {
              services: [
                (await getBranchService(token, organizationId, branchId, serviceId, signal))
                  .service,
              ],
            }
          : listBranchServices(token, organizationId, branchId, signal),
      ),
  });
  return { query, validId };
}
export function useBranchServiceWrite(
  userId: string,
  organizationId: string,
  branchId: string,
  serviceId?: string,
) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const client = useQueryClient();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationKey: [
      'branch-services',
      userId,
      organizationId,
      branchId,
      serviceId ?? 'create',
      'write',
    ],
    retry: false,
    gcTime: 0,
    mutationFn: async ({
      input,
      signal,
    }: {
      input: CreateBranchServiceRequest | UpdateBranchServiceRequest;
      signal: AbortSignal;
    }): Promise<void> => {
      await runWithAccessToken(async (token) => {
        if (serviceId && !('currency' in input))
          await updateBranchService(token, organizationId, branchId, serviceId, input, signal);
        else if (!serviceId && 'currency' in input)
          await createBranchService(token, organizationId, branchId, input, signal);
        else throw new Error('Invalid branch service operation');
      });
      if (!active.current || signal.aborted) return;
      await client.invalidateQueries({
        queryKey: branchServiceListKey(userId, organizationId, branchId),
        exact: true,
      });
      if (serviceId && active.current && !signal.aborted)
        await client.invalidateQueries({
          queryKey: branchServiceDetailKey(userId, organizationId, branchId, serviceId),
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
  }, [userId, organizationId, branchId, serviceId]);
  async function submit(
    input: CreateBranchServiceRequest | UpdateBranchServiceRequest,
  ): Promise<boolean> {
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
