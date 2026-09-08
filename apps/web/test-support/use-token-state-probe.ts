import { useEffect, useState } from 'react';
import { useAuthentication } from '@/providers/authentication-provider';

/** Test-only classification; never returns or renders a credential. */
export function useTokenStateProbe() {
  const { status, runWithAccessToken, accessTokenExpiresAt } = useAuthentication();
  const [kind, setKind] = useState('absent');
  useEffect(() => {
    let active = true;
    if (status === 'authenticated') {
      void runWithAccessToken(async (token) =>
        token === 'explicit-login-token' ? 'explicit' : 'refreshed',
      )
        .then((value) => {
          if (active) setKind(value);
        })
        .catch(() => {
          if (active) setKind('absent');
        });
    }
    return () => {
      active = false;
    };
  }, [status, runWithAccessToken, accessTokenExpiresAt]);
  return status === 'authenticated' ? kind : 'absent';
}
