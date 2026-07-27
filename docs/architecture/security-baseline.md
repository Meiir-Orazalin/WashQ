# Security baseline

Version 0 establishes real safeguards without pretending that future identity
or authorization exists.

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

## Explicit future boundaries

Login, authentication, and authorization arrive in later Version 1 slices and
must default to denial for protected use cases. Rate limiting, audit logging,
secure cookies, monitoring, and production hardening arrive in later versions
when their flows exist.

Production databases must use a dedicated least-privilege account and encrypted
transport. Access tokens, passwords, cookies, connection strings, environment
variables, and personal data must never be logged.
