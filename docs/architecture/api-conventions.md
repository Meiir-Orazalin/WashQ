# API conventions

## Transport

- REST over JSON.
- Public routes begin with `/api/v1`.
- Resource names use lowercase plural nouns when business resources are added.
- HTTP methods and status codes carry their standard semantics.
- Public request and response shapes are Zod schemas in
  `@washqueue/contracts`.
- OpenAPI is available at `/docs` when `API_DOCS_ENABLED=true`.

## Current endpoints

```text
GET /api/v1/health
GET /api/v1/health/ready
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET /api/v1/auth/me
```

Liveness returns:

```json
{
  "status": "ok",
  "service": "washqueue-api",
  "timestamp": "2026-07-23T12:00:00.000Z"
}
```

Readiness adds `"checks": { "database": "up" }`. A database failure returns 503
without server, database, connection string, or exception details.

Customer registration accepts:

```json
{
  "firstName": "Meiir",
  "lastName": "Orazalin",
  "email": "meiir@example.com",
  "password": "example-password"
}
```

`lastName` is optional. The API trims names, converts an empty last name to
`null`, lowercases the trimmed email, and leaves the password unchanged before
hashing it. Success returns `201 Created`:

```json
{
  "user": {
    "id": "df4e7850-e329-4679-91f1-77b409d93f4f",
    "firstName": "Meiir",
    "lastName": "Orazalin",
    "email": "meiir@example.com",
    "createdAt": "2026-07-27T12:00:00.000Z"
  }
}
```

Invalid input returns `400 VALIDATION_ERROR`. A duplicate normalized email
returns `409 EMAIL_ALREADY_REGISTERED`. Registration does not return or create
tokens or sessions, and responses never include a password or password hash.

Customer login accepts:

```json
{
  "email": "meiir@example.com",
  "password": "example-password"
}
```

The email is trimmed and lowercased. The password is passed unchanged to the
password-verification boundary. Success returns `200 OK`:

```json
{
  "user": {
    "id": "df4e7850-e329-4679-91f1-77b409d93f4f",
    "firstName": "Meiir",
    "lastName": "Orazalin",
    "email": "meiir@example.com"
  },
  "accessToken": "signed-access-token",
  "accessTokenExpiresAt": "2026-07-27T12:15:00.000Z"
}
```

Login also sets the opaque refresh token in the `washqueue_refresh` HttpOnly
cookie. The refresh token, its hash, and refresh-session metadata are absent
from JSON. Unknown email and incorrect password both return
`401 INVALID_CREDENTIALS` with the message `Invalid email or password`.

Refresh has no JSON request body. It reads the opaque token from the
`washqueue_refresh` HttpOnly cookie. Success returns `200 OK`:

```json
{
  "accessToken": "signed-access-token",
  "accessTokenExpiresAt": "2026-07-27T12:15:00.000Z"
}
```

The response never contains a refresh token or session identifier. The old
session is atomically replaced and the cookie is overwritten only after
persistence succeeds. Missing, malformed, unknown, expired, revoked,
deleted-user, and replayed sessions all return
`401 INVALID_REFRESH_SESSION` and clear the cookie.

Browser requests to refresh must include an `Origin` exactly matching one of
the configured frontend origins. An unapproved Origin returns
`403 ORIGIN_NOT_ALLOWED`; requests without Origin are accepted for trusted
non-browser clients and internal tests. Credentialed CORS never echoes an
arbitrary origin.

Logout has no JSON request body. It reads the current session token from the
same `washqueue_refresh` HttpOnly cookie and returns an empty
`204 No Content`. Valid active, already-revoked, expired, unknown, malformed,
missing, deleted-user, and rotated-predecessor states are externally
indistinguishable. Accepted requests clear the cookie. Logout revokes only the
matching active, unexpired refresh session; other sessions and families are
untouched, and existing access tokens remain valid until expiration.

Logout applies the same Origin policy as refresh. A disallowed browser Origin
returns the sanitized `403 ORIGIN_NOT_ALLOWED` response before revocation and
does not clear the cookie. An absent Origin is accepted for trusted non-browser
clients and internal tests. Unexpected infrastructure failures return the
sanitized 500 response and still clear the cookie because Origin validation
accepted the request.

No success transport contract is defined for logout because a 204 response has
no body.

Current-user lookup has no request body and authenticates only through:

```http
Authorization: Bearer <access-token>
```

Success returns current database values with `200 OK`:

```json
{
  "user": {
    "id": "df4e7850-e329-4679-91f1-77b409d93f4f",
    "firstName": "Meiir",
    "lastName": "Orazalin",
    "email": "meiir@example.com"
  }
}
```

Missing, malformed, expired, invalid-signature, wrong-type, invalid-subject,
and deleted-user credentials all return `401 AUTHENTICATION_REQUIRED` with the
message `Authentication is required`. The response contains no token, claim,
credential, role, session, or Prisma data. `/auth/me` does not read or mutate a
refresh cookie or refresh session.

Version 1.2.5 does not add frontend authentication, a global guard, protected
business routes, or global logout.

## Errors

All errors use:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Safe human-readable message"
  },
  "timestamp": "2026-07-23T12:00:00.000Z",
  "path": "/api/v1/resource",
  "requestId": "opaque-id"
}
```

`details` is optional and may contain only sanitized validation information.
Stack traces, environment values, tokens, secrets, connection strings, and
internal exception objects are never response data. Clients may send
`x-request-id`; the API otherwise generates one and returns it in the header and
error body.

Logout documents its endpoint-specific idempotency above. Pagination,
filtering, and broader concurrency conventions will be added with the first
business endpoint that needs them rather than guessed in advance.
