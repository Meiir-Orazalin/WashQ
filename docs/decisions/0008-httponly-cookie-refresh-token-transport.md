# ADR 0008: HttpOnly cookie transport for opaque refresh tokens

## Status

Accepted

## Context

ADR 0007 selects opaque refresh tokens with hashed server-side sessions. Login
must deliver the one raw refresh token to a browser without placing it in JSON
or frontend-accessible storage. The transport policy must work for local HTTP
development while requiring secure transport in production.

## Decision

- Deliver the raw refresh token only in the `washqueue_refresh` response cookie.
- Set `HttpOnly`, `SameSite=Lax`, and `Path=/api/v1/auth`.
- Align cookie `Max-Age` with the validated server-side refresh-token lifetime.
- Set `Secure=true` in production and `false` only in non-production local/test
  environments.
- Omit `Domain` until a concrete deployment topology requires it.
- Keep cookie settings centralized in the HTTP presentation layer.
- Never include the refresh token in JSON, logs, URLs, browser-managed
  JavaScript storage, or OpenAPI examples.

## Alternatives considered

- JSON response transport: rejected because it makes the long-lived credential
  directly accessible to browser JavaScript and encourages local-storage use.
- A non-HttpOnly cookie: rejected because frontend JavaScript could read and
  exfiltrate the refresh token.
- `SameSite=Strict`: deferred because it can interfere with legitimate
  top-level navigation flows; `Lax` provides the current balance for an
  auth-scoped cookie.
- A configured cookie domain: rejected until the production host topology is
  known.

## Consequences

Frontend JavaScript cannot inspect the refresh token. Future refresh and logout
endpoints will receive the cookie automatically and must perform an explicit
CSRF/origin review. Local HTTP testing remains possible, while production
cookie delivery requires HTTPS.
