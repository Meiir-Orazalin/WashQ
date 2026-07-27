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

## Explicit future boundaries

Public login, refresh, logout, authentication guards, and authorization arrive
in later Version 1 slices and must default to denial for protected use cases.
Rate limiting, audit logging, secure cookies, monitoring, and production
hardening arrive in later versions when their flows exist.

Production databases must use a dedicated least-privilege account and encrypted
transport. Access tokens, passwords, cookies, connection strings, environment
variables, and personal data must never be logged.
