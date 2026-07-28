# Authentication architecture

Version 1.2.1 establishes authentication configuration and token/session
infrastructure. Version 1.2.2 adds backend customer login and initial refresh
session issuance. Version 1.2.3 adds one-time refresh-token rotation and
family-scoped replay detection. Logout, current-user, guards, and protected
business endpoints remain absent.

## Boundaries

Authentication follows the modular-monolith dependency direction:

```text
authentication use case
  -> application ports
     -> access-token service
     -> refresh-token generator
     -> refresh-token hasher
     -> refresh-session repository
        -> infrastructure adapters
           -> jose
           -> Node cryptography
           -> Prisma
```

Application types are framework-independent. JWT claims, token-library errors,
Prisma models, raw refresh tokens, and HTTP response objects do not cross these
ports.

## Access tokens

Access tokens are short-lived HS256-signed JWTs. The verified application
payload contains only:

- subject/user UUID;
- the `access` token discriminator;
- issued-at time;
- expiration time.

Email, names, roles, memberships, vehicles, and other mutable data are
deliberately excluded. Issuance and verification are available only through the
`AccessTokenService` port. The signing secret remains server-side.

## Customer login

`POST /api/v1/auth/login` follows this order:

```text
shared request validation
  -> normalized email lookup
  -> password or dummy-password verification
  -> access-token issuance
  -> opaque refresh-token generation and hashing
  -> refresh-session persistence
  -> public response mapping and HttpOnly cookie
```

Unknown email, incorrect password, and password-verification failures produce
the same `INVALID_CREDENTIALS` application result. Unknown emails perform
Argon2id verification against a valid non-secret dummy hash without artificial
sleeps.

The controller does not write the refresh cookie until the use case has
persisted the refresh session and the public JSON response has passed its shared
contract.

## Refresh tokens and sessions

Refresh tokens are opaque values generated from 32 cryptographically secure
random bytes. Only a SHA-256 digest with the `sha256:` format discriminator is
passed to persistence. SHA-256 is appropriate here because the input is a
uniformly random 256-bit bearer secret; password hashing remains separately
protected by Argon2id.

Each refresh session belongs to one user and has an explicit expiration and
optional revocation timestamp. A user may own multiple sessions. Deleting the
user cascades to their sessions.

Every login starts a new UUID session family. A successful rotation creates one
replacement in the same family, revokes the prior session, and links it through
`replacedBySessionId` in one repository transaction. The Prisma adapter locks
the old PostgreSQL row and checks its previously observed update timestamp, so
at most one simultaneous request succeeds.

Presenting an already-linked token later is replay evidence. The use case
revokes active sessions only in that family; independent login families remain
active. A losing in-flight concurrent request receives the same invalid-refresh
result without revoking the successful replacement. See
[ADR 0009](../decisions/0009-refresh-token-rotation-and-family-replay-revocation.md).

The raw token crosses only the application-to-presentation boundary after
successful session persistence. It is written to the `washqueue_refresh`
HttpOnly cookie and is never included in JSON. See the
[session cookie policy](session-cookie-policy.md).

## Refresh flow

`POST /api/v1/auth/refresh` follows this order:

```text
cookie parsing and browser-Origin validation
  -> presented-token hashing and session lookup
  -> active, unexpired, existing-user check
  -> replacement-token generation and hashing
  -> access-token issuance
  -> atomic old-session revocation and replacement creation
  -> strict public response mapping and cookie overwrite
```

Missing, malformed, unknown, expired, revoked, deleted-user, and replayed
sessions produce the same `INVALID_REFRESH_SESSION` response and clear the
refresh cookie. Unexpected infrastructure failures use the sanitized global
500 response and do not write a cookie.

## Configuration

The API validates these server-only environment variables at startup:

| Variable                         | Rule                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| `ACCESS_TOKEN_SIGNING_SECRET`    | required, at least 32 characters                                           |
| `ACCESS_TOKEN_LIFETIME_SECONDS`  | integer from 60 through 3,600                                              |
| `REFRESH_TOKEN_LIFETIME_SECONDS` | integer from 3,600 through 31,536,000 and greater than the access lifetime |

Production rejects obvious development, test, placeholder, and `change-me`
secret values. Validation errors identify invalid field names without including
secret values. Issuer and audience are not configured because Version 1.2.1 has
one API issuer and no concrete multi-audience requirement.
