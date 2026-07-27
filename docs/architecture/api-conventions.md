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

Version 1.2.1 adds no public endpoint or transport contract. In particular,
login, refresh, logout, and current-user routes remain absent.

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

Pagination, filtering, idempotency, and concurrency conventions will be added
with the first endpoint that needs them rather than guessed in Version 0.
