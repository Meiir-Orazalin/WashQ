# ADR 0010: Memory-only browser access tokens

## Status

Accepted

## Context

The initial frontend login flow receives a short-lived access token in JSON and
must use it to verify the current user. Persisting that bearer credential would
increase the period and surfaces from which injected JavaScript, browser
extensions, backups, or shared machines could recover it. The long-lived refresh
credential already uses the inaccessible HttpOnly transport selected by ADR 0008.

## Decision

- Store the access token, its expiration, and the current public user only in a
  root React authentication provider.
- Never persist the access token in localStorage, sessionStorage, IndexedDB,
  cookies, URLs, browser history, React Query data, service-worker storage, or
  rendered markup.
- Keep the API client stateless. Callers explicitly supply an access token only
  to requests that require it.
- Keep password and token values out of TanStack mutation variables and result
  data.
- On page reload, obtain a new memory-only access token by rotating the HttpOnly
  refresh cookie through one same-document single-flight request.
- Clear all staged authentication data when post-login current-user verification
  fails, without automatically refreshing in Version 1.2.6.

## Alternatives considered

- localStorage or sessionStorage: rejected because JavaScript-readable
  persistence expands bearer-token exposure and survives beyond the intended
  page lifetime.
- A JavaScript-readable access-token cookie: rejected because it combines
  ambient cookie transport with script access and is unnecessary for explicit
  Bearer requests.
- React Query cache or a module-level API-client variable: rejected because they
  hide credential lifetime in transport or caching infrastructure.
- Automatic restoration in the initial login slice: deferred so refresh
  concurrency, failure, and retry behavior can be designed and tested
  independently in Version 1.2.7.

## Consequences

Reloading the page loses the prior access token and begins in a neutral
initialization state. Version 1.2.7 may restore authentication by rotating the
HttpOnly cookie into a new provider-owned token and verifying `/auth/me`.
Same-document callers share one in-flight Promise. Ambiguous rotation outcomes
are not retried automatically. Version 1.2.9 adds cross-tab exclusivity only
around cookie-mutating HTTP operations through ADR 0011; it does not share
access tokens or provider state. Frontend features receive authentication
through the provider rather than a transport-global or persisted token.

Frontend logout clears provider memory before server confirmation, invalidates
stale operation generations, and waits for active same-document rotation before
calling the cookie-authenticated logout endpoint. A failed confirmation never
restores the old token.

The Version 1.2.8 release review demonstrated that simultaneous cross-tab
rotations could invalidate the shared cookie and family. Version 1.2.9 closes
that race with the browser lock selected by ADR 0011. Lock names and metadata
contain no credentials, and access tokens remain per-tab and memory-only.
