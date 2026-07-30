'use client';

import { useMutation } from '@tanstack/react-query';
import type { LoginRequest } from '@washqueue/contracts';
import { useRef } from 'react';
import { getCurrentUser, loginCustomer } from '@/lib/api-client';
import { useAuthentication } from '@/providers/authentication-provider';

export class SessionEstablishmentError extends Error {
  constructor() {
    super('The authenticated session could not be established');
    this.name = 'SessionEstablishmentError';
  }
}

export function useLoginMutation() {
  const { beginAuthentication, stageAccessToken, completeAuthentication, failAuthentication } =
    useAuthentication();
  const pendingRequest = useRef<LoginRequest | null>(null);
  const requestInFlight = useRef(false);

  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const operationGeneration = beginAuthentication();

      try {
        let request = pendingRequest.current;
        pendingRequest.current = null;
        if (!request) {
          failAuthentication(operationGeneration);
          throw new Error('The login request is unavailable');
        }

        let login;
        try {
          login = await loginCustomer(request);
          request = null;
        } catch (error) {
          failAuthentication(operationGeneration);
          throw error;
        }

        try {
          if (
            !stageAccessToken(login.accessToken, login.accessTokenExpiresAt, operationGeneration)
          ) {
            return;
          }

          const currentUser = await getCurrentUser(login.accessToken);
          completeAuthentication(currentUser.user, operationGeneration);
        } catch {
          failAuthentication(operationGeneration);
          throw new SessionEstablishmentError();
        }
      } finally {
        pendingRequest.current = null;
        requestInFlight.current = false;
      }
    },
  });

  function authenticate(request: LoginRequest) {
    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    pendingRequest.current = request;
    mutation.mutate();
  }

  return { ...mutation, authenticate };
}
