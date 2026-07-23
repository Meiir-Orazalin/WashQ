# Security baseline

Version 0 establishes real safeguards without pretending that future identity
or authorization exists.

## Implemented

- Zod validates API and public web environment values at startup/build time.
- `.env` files and generated credentials are ignored by Git.
- CORS origins are explicit environment configuration.
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

## Explicit future boundaries

Authentication and authorization arrive with Version 1 and must default to
denial for protected use cases. Rate limiting, audit logging, secure cookies,
password hashing policy, monitoring, and production hardening arrive in later
versions when their flows exist.

Production databases must use a dedicated least-privilege account and encrypted
transport. Access tokens, passwords, cookies, connection strings, environment
variables, and personal data must never be logged.
