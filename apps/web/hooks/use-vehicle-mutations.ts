'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateVehicleRequest } from '@washqueue/contracts';
import { useEffect, useRef } from 'react';
import { ApiClientError } from '@/lib/api-client';
import { deleteVehicle, updateVehicle } from '@/lib/vehicle-api-client';
import { useAuthentication } from '@/providers/authentication-provider';
import { vehicleQueryKey } from './use-vehicles';

type VehicleMutation = { type: 'update'; patch: UpdateVehicleRequest } | { type: 'delete' };
export type VehicleMutationOutcome = 'updated' | 'deleted' | 'missing';

/** Lives inside the existing authenticated, user-keyed subtree; never owns a token. */
export function useVehicleMutations(
  userId: string,
  vehicleId: string,
  onOutcome: (outcome: VehicleMutationOutcome) => void,
) {
  const { runWithAccessToken, status, currentUser } = useAuthentication();
  const client = useQueryClient();
  const active = useRef(true);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const enabled = status === 'authenticated' && currentUser?.id === userId;
  const mutation = useMutation({
    mutationKey: [...vehicleQueryKey(userId), vehicleId, 'mutation'],
    retry: false,
    gcTime: 0,
    mutationFn: async (operation: VehicleMutation): Promise<VehicleMutationOutcome | 'stale'> => {
      const abort = new AbortController();
      request.current = abort;
      try {
        // Convert expected 404 to a safe outcome INSIDE the capability: even a
        // missing result must pass the provider's identity/generation check.
        const outcome = await runWithAccessToken(async (token): Promise<VehicleMutationOutcome> => {
          try {
            if (operation.type === 'update') {
              await updateVehicle(token, vehicleId, operation.patch, abort.signal);
              return 'updated';
            }
            await deleteVehicle(token, vehicleId, abort.signal);
            return 'deleted';
          } catch (error) {
            if (
              error instanceof ApiClientError &&
              error.status === 404 &&
              error.code === 'VEHICLE_NOT_FOUND'
            )
              return 'missing';
            throw error;
          }
        });
        if (!active.current || abort.signal.aborted) return 'stale';
        onOutcome(outcome);
        await client.invalidateQueries({ queryKey: vehicleQueryKey(userId), exact: true });
        return outcome;
      } finally {
        inFlight.current = false;
        if (request.current === abort) request.current = null;
      }
    },
  });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, [userId, vehicleId]);

  async function submit(operation: VehicleMutation): Promise<boolean> {
    if (!enabled || !active.current || inFlight.current) return false;
    inFlight.current = true;
    try {
      const outcome = await mutation.mutateAsync(operation);
      return active.current && outcome !== 'stale' && outcome !== 'missing';
    } catch {
      return false;
    }
  }

  return { mutation, submit };
}
