'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateVehicleRequest } from '@washqueue/contracts';
import { useEffect, useRef } from 'react';
import { createVehicle, listVehicles } from '@/lib/vehicle-api-client';
import { useAuthentication } from '@/providers/authentication-provider';

export const vehicleQueryKey = (userId: string) => ['vehicles', userId] as const;

/** Mount only within the authenticated, identity-keyed vehicle boundary. */
export function useVehicles(userId: string) {
  const { runWithAccessToken, status, currentUser } = useAuthentication();
  const client = useQueryClient();
  const active = useRef(true);
  const creation = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const enabled = status === 'authenticated' && currentUser?.id === userId;
  const queryKey = vehicleQueryKey(userId);
  const query = useQuery({
    queryKey,
    enabled,
    retry: false,
    queryFn: ({ signal }) => runWithAccessToken((token) => listVehicles(token, signal)),
  });
  const mutation = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async (input: CreateVehicleRequest): Promise<void> => {
      const abort = new AbortController();
      creation.current = abort;
      try {
        await runWithAccessToken((token) => createVehicle(token, input, abort.signal));
        if (active.current)
          await client.invalidateQueries({ queryKey: vehicleQueryKey(userId), exact: true });
      } finally {
        inFlight.current = false;
        if (creation.current === abort) creation.current = null;
      }
    },
  });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      creation.current?.abort();
      void client.cancelQueries({ queryKey: vehicleQueryKey(userId), exact: true });
      client.removeQueries({ queryKey: vehicleQueryKey(userId), exact: true });
    };
  }, [client, userId]);

  const submit = async (input: CreateVehicleRequest): Promise<boolean> => {
    if (!enabled || !active.current || inFlight.current) return false;
    inFlight.current = true;
    try {
      await mutation.mutateAsync(input);
      return active.current;
    } catch {
      return false;
    }
  };

  return { query, mutation, submit };
}
