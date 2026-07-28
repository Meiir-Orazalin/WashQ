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
- Treat a page reload as unauthenticated until a later restoration flow obtains
  a new access token through the HttpOnly refresh cookie.
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

Reloading the page loses the access token and authenticated UI even though the
HttpOnly refresh cookie may still represent a valid session. Version 1.2.7 must
restore authentication by rotating that cookie into a new memory-only access
token, with single-flight and failure handling designed explicitly. Frontend
features must receive authentication through the provider rather than reading a
transport-global token.
