# Testing strategy

Tests are selected by risk and boundary.

## Test layers

- Contract tests prove public Zod schemas accept and reject representative
  payloads.
- API unit/HTTP tests run Nest controllers with a deterministic database
  readiness port and verify status codes, contracts, and sanitized errors.
- Database integration tests use a real disposable PostgreSQL instance and
  execute the Prisma readiness query.
- Web component tests use Vitest, jsdom, and Testing Library to verify loading,
  success, and failure behavior at user-visible boundaries.
- Playwright covers critical browser workflows. Version 0 has one intercepted,
  deterministic foundation smoke test; future flows should use real API
  boundaries and isolated test data where practical.

## Rules

- Business rules require unit tests and boundary-level coverage where they are
  exposed.
- Persistence semantics and concurrency require PostgreSQL integration tests,
  not mocks.
- External production services are never test dependencies.
- Time, identifiers, and external responses are controlled when determinism
  matters.
- Failed tests are fixed, not skipped or deleted.

CI runs formatting, linting, type checking, unit tests, PostgreSQL integration
tests, and application builds on pushes to `main` and all pull requests.
