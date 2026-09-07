# Security baseline

The project establishes safeguards only as the corresponding business slices
arrive and does not imply that authentication endpoints or authorization exist
before they are implemented.

## Implemented

- Zod validates API and public web environment values at startup/build time.
- Production web builds require an explicit public API base URL; they do not
  silently target localhost.
- `.env` files and generated credentials are ignored by Git.
- CORS origins are explicit environment configuration.
- OpenAPI documentation is disabled by default and enabled explicitly in local
  development.
- Helmet sets secure HTTP response headers.
- Express implementation headers are disabled.
- JSON and form request bodies are limited to 1 MB.
- A global Zod pipe supports future request DTO schemas.
- A global exception filter removes stack traces and internal exceptions from
  responses.
- Production logging is structured; failure logs contain request context and
  exception type, not request bodies or secrets.
- Request IDs support incident correlation.
- Prisma credentials remain server-side and readiness reveals no infrastructure
  detail.
- Registration passwords are never logged or returned. They are passed
  unchanged to an Argon2id adapter through the application-level
  `PasswordHasher` interface, and only the resulting hash reaches persistence.
- Failure logging records method, path, request ID, status, and exception type;
  it does not record request bodies.
- Access-token signing configuration is validated at API startup, stays
  server-side, and rejects weak or obvious placeholder secrets in production.
- Access-token claims contain only immutable identity and token-lifecycle data.
- Refresh tokens contain 256 bits of cryptographic randomness. Only their
  SHA-256 hashes reach PostgreSQL, and repository reads omit those hashes.
- Refresh sessions have explicit expiration and revocation timestamps, permit
  multiple concurrent sessions, and are deleted with their user.
- Customer login normalizes email through the shared contract and sends the raw
  password only to the Argon2id verification boundary.
- Unknown-email login attempts perform verification against a valid dummy hash.
  Unknown email, wrong password, and credential-verification failure return the
  same generic response.
- A successful login persists the refresh-session hash before returning any
  token. The raw refresh token is exposed only through an HttpOnly,
  `SameSite=Lax`, auth-path-scoped cookie.
- Refresh cookies are `Secure` in production and omit `Domain`.
- Refresh tokens are single-use. Rotation occurs in a row-locking PostgreSQL
  transaction, so simultaneous requests create no more than one replacement.
- Reuse of an already-replaced token revokes active sessions only in its UUID
  family. Other login families remain active.
- Cookie-authenticated refresh requests validate a present browser `Origin`
  against configured frontend origins. An absent Origin is accepted only for
  trusted non-browser clients and internal tests.
- Invalid refresh-session conditions are externally indistinguishable, clear
  the auth-scoped cookie, and never return refresh or session data.
- Current-session logout validates the same browser Origin policy as refresh,
  hashes only shape-valid presented tokens, and conditionally revokes only the
  matching active, unexpired session. Missing, malformed, unknown, expired,
  revoked, deleted-user, and rotated-predecessor tokens all return an empty 204.
- Logout never invokes family replay revocation or affects other sessions.
  Accepted requests clear the centralized auth-scoped cookie; disallowed
  Origins neither revoke nor clear. Unexpected infrastructure failures remain
  sanitized 500 responses.
- Logout does not revoke access tokens. Previously issued access tokens remain
  valid until their configured short expiration.
- The current-user endpoint accepts only a Bearer access token. The focused
  header reader rejects missing, malformed, unsupported, and multiple
  credentials without logging their values.
- Expected access-token verification failures, invalid subjects, and deleted
  users are externally indistinguishable as `401 AUTHENTICATION_REQUIRED`.
- Current-user lookup selects only the public user projection from PostgreSQL;
  it never reads `password_hash` or refresh-session state.
- Authorization headers, verified claims, access tokens, and signing secrets
  are absent from request and failure logs.
- Access tokens remain stateless: logout and family revocation do not blacklist
  them, while deleting the referenced user prevents current-user lookup.
- The web login request includes credentials only so the browser can accept the
  HttpOnly refresh cookie; frontend JavaScript never reads or writes that
  cookie.
- The frontend stores the access token, expiration, and current public user
  only in a root React provider. It does not use localStorage, sessionStorage,
  IndexedDB, cookies, URLs, rendered markup, service-worker storage, or React
  Query data.
- The login mutation has no cached variables or result data. The raw password
  remains in local form state until it is cleared after success or an API
  failure.
- Post-login identity is verified through `/auth/me` with an explicitly supplied
  Bearer token and no cookie credentials. Failure clears all staged
  authentication data and does not trigger refresh.
- Startup session restoration rotates the HttpOnly cookie once through a
  same-document single-flight coordinator and verifies current user data with
  the new memory-only Bearer token.
- React Strict Mode subscribers share the in-flight rotation; unmounted or
  stale restoration work cannot overwrite a newer explicit login.
- Startup, proactive, visibility, and remote-event refreshes keep the returned
  access token staged until credential-omitting `/auth/me` returns the
  contract-validated current database user. Token, expiration, and user then
  commit atomically; a new token is never paired with the old user.
- Proactive refresh uses the server-provided expiration timestamp, one timeout,
  and a 60-second safety window. Browser code does not decode JWTs or infer
  identity from prior state or token claims.
- Invalid refresh state clears frontend memory without retry. Ambiguous
  rotation failures are never retried automatically; a still-valid access token
  is retained only until its known expiration.
- Visibility recovery reuses the same coordinator and does not repeat an
  indeterminate refresh. Access tokens and refresh credentials remain absent
  from browser persistence, React Query, rendered output, and logs.
- Frontend logout clears access-token, expiration, and user state immediately,
  invalidates stale async operations, cancels scheduled work, waits for an
  already-active same-document refresh, and only then sends the credentialed
  idempotent logout request.
- Unconfirmed logout never restores local credentials or retries automatically.
  Manual retry calls logout directly without refresh; its warning does not
  expose Origin, cookie, token, or server details.
- Explicit verified login publishes only `session-changed` plus an ephemeral
  per-document source ID. Confirmed 204 logout publishes only `logout` plus that
  source ID. Failed, stale, automatic, and remotely triggered work is not
  broadcast.
- Cross-tab lifecycle payloads contain no access token, refresh token, cookie,
  user or profile data, password, API response, session ID, or family ID. The
  source ID is memory-only and carries no authentication authority.
- Remote session change removes the old token and user before coordinated
  refresh plus `/auth/me`; remote logout removes memory and timers without
  logout, refresh, or `/auth/me` requests. Operation generations reject late
  results.
- `BroadcastChannel` is notification only. It stores no authentication state,
  provides no mutual exclusion, closes with the provider, and has no
  localStorage, polling, or credential-sharing fallback.

## Explicit future boundaries

Global authentication guards and authorization arrive in later Version 1
slices and must default to denial for protected use cases. Global logout, rate
limiting, audit logging, expanded CSRF controls, monitoring, and production
hardening arrive in later versions when their flows exist.

- Browser login, refresh, and logout acquire one exclusive same-origin Web Lock
  before HTTP transport starts. The stable lock name contains no identity or
  credential data.
- Missing or failed Web Locks capability fails closed with a sanitized
  coordination state; no unlocked cookie mutation or storage-based mutex is
  attempted.
- Missing or failed BroadcastChannel capability also fails closed before
  frontend authentication. Immediate cross-tab identity synchronization is
  advertised only for the verified supported-browser matrix.
- The cross-tab lock shares no access token, refresh token, cookie, user,
  session, or family data. Access tokens remain per-tab and memory-only.
- Lock waiting causes neither an authentication error nor an automatic retry.
  Network outcomes that become indeterminate after request start retain the
  existing no-retry behavior.
- Live authentication browser fixtures use deterministic namespaced temporary
  emails, select only hash-free database counts, delete exact users with
  cascade-owned sessions, and fail cleanup when rows remain.
- Credential-bearing browser traces are sanitized before retention: network
  records and non-screenshot resources are removed and input parameters are
  redacted. Failure timelines contain only method, auth endpoint path, and
  status; workflow artifacts do not retain headers, bodies, cookies, passwords,
  tokens, signing secrets, or `.env` contents.

Production databases must use a dedicated least-privilege account and encrypted
transport. Access tokens, passwords, cookies, connection strings, environment
variables, and personal data must never be logged.
