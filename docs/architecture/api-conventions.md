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
