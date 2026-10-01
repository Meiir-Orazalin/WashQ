'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  branchIdParamsSchema,
  washBoxIdParamsSchema,
  type CreateWashBoxRequest,
  type SetWashBoxActiveStateRequest,
} from '@washqueue/contracts';
import { useEffect, useRef } from 'react';
import {
  createWashBox,
  listWashBoxes,
  getWashBox,
  setWashBoxActiveState,
} from '@/lib/wash-box-api-client';
import { useAuthentication } from '@/providers/authentication-provider';

export const washBoxListKey = (userId: string, organizationId: string, branchId: string) =>
  ['wash-boxes', userId, organizationId, branchId] as const;
export const washBoxDetailKey = (
  userId: string,
  organizationId: string,
  branchId: string,
  washBoxId: string,
) => ['wash-box', userId, organizationId, branchId, washBoxId] as const;
export function useWashBoxCacheBoundary(userId: string, organizationId: string, branchId: string) {
  const client = useQueryClient();
  useEffect(
    () => () => {
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          (query.queryKey[0] === 'wash-boxes' || query.queryKey[0] === 'wash-box') &&
          query.queryKey[1] === userId,
      };
      void client.cancelQueries(filters);
      client.removeQueries(filters);
    },
    [client, userId, organizationId, branchId],
  );
}
export function useWashBoxes(
  userId: string,
  organizationId: string,
  branchId: string,
  washBoxId?: string,
) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const validId = washBoxId
    ? washBoxIdParamsSchema.safeParse({ organizationId, branchId, washBoxId }).success
    : branchIdParamsSchema.safeParse({ organizationId, branchId }).success;
  const query = useQuery({
    queryKey: washBoxId
      ? washBoxDetailKey(userId, organizationId, branchId, washBoxId)
      : washBoxListKey(userId, organizationId, branchId),
    enabled: validId && status === 'authenticated' && currentUser?.id === userId,
    retry: false,
    queryFn: async ({ signal }) =>
      runWithAccessToken(async (token) =>
        washBoxId
          ? {
              washBoxes: [
                (await getWashBox(token, organizationId, branchId, washBoxId, signal)).washBox,
              ],
            }
          : listWashBoxes(token, organizationId, branchId, signal),
      ),
  });
  return { query, validId };
}
export function useWashBoxWrite(
  userId: string,
  organizationId: string,
  branchId: string,
  washBoxId?: string,
) {
  const { status, currentUser, runWithAccessToken } = useAuthentication();
  const client = useQueryClient();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationKey: ['wash-boxes', userId, organizationId, branchId, washBoxId ?? 'create', 'write'],
    retry: false,
    gcTime: 0,
    mutationFn: async ({
      input,
      signal,
    }: {
      input: CreateWashBoxRequest | SetWashBoxActiveStateRequest;
      signal: AbortSignal;
    }): Promise<void> => {
      await runWithAccessToken(async (token) => {
        if (washBoxId && 'isActive' in input)
          await setWashBoxActiveState(token, organizationId, branchId, washBoxId, input, signal);
        else if (!washBoxId && 'number' in input)
          await createWashBox(token, organizationId, branchId, input, signal);
        else throw new Error('Invalid wash box operation');
      });
      if (!active.current || signal.aborted) return;
      await client.invalidateQueries({
        queryKey: washBoxListKey(userId, organizationId, branchId),
        exact: true,
      });
      if (washBoxId && active.current && !signal.aborted)
        await client.invalidateQueries({
          queryKey: washBoxDetailKey(userId, organizationId, branchId, washBoxId),
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
  }, [userId, organizationId, branchId, washBoxId]);
  async function submit(
    input: CreateWashBoxRequest | SetWashBoxActiveStateRequest,
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
