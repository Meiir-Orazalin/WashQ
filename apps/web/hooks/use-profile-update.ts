'use client';

import type { UpdateCurrentUserProfileRequest } from '@washqueue/contracts';
import { useEffect, useRef, useState } from 'react';
import { updateCurrentUserProfile } from '@/lib/api-client';
import { useAuthentication } from '@/providers/authentication-provider';

/** Temporary operation state only; AuthenticationProvider remains the sole user store. */
export function useProfileUpdate() {
  const { runWithCurrentUserUpdate } = useAuthentication();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);

  async function submit(input: UpdateCurrentUserProfileRequest): Promise<boolean> {
    if (!active.current || request.current) return false;
    const abort = new AbortController();
    request.current = abort;
    setPending(true);
    setFailed(false);
    try {
      const committed = await runWithCurrentUserUpdate((token) =>
        updateCurrentUserProfile(token, input, abort.signal),
      );
      return committed && active.current && !abort.signal.aborted;
    } catch {
      if (active.current && !abort.signal.aborted) setFailed(true);
      return false;
    } finally {
      if (request.current === abort) request.current = null;
      if (active.current) setPending(false);
    }
  }

  return { pending, failed, submit };
}
