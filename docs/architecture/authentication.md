# Authentication architecture

Version 1.2.1 establishes authentication configuration and token/session
infrastructure. Version 1.2.2 adds backend customer login and initial refresh
session issuance. Refresh rotation, logout, current-user, guards, and protected
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
user cascades to their sessions. Rotation and replacement linkage are deferred
until the refresh use case is implemented.

The raw token crosses only the application-to-presentation boundary after
successful session persistence. It is written to the `washqueue_refresh`
HttpOnly cookie and is never included in JSON. See the
[session cookie policy](session-cookie-policy.md).

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
