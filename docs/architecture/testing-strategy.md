# Testing strategy

Tests are selected by risk and boundary.

## Test layers

- Contract tests prove public Zod schemas accept and reject representative
  payloads.
- API unit/HTTP tests run Nest controllers with a deterministic database
  readiness port and verify status codes, contracts, and sanitized errors.
- Database integration tests use a real disposable PostgreSQL instance and
  execute the production Prisma readiness adapter. They require a local
  `TEST_DATABASE_URL` whose database name ends in `_test` or `_ci`.
- Web component tests use Vitest, jsdom, and Testing Library to verify loading,
  success, and failure behavior at user-visible boundaries.
- Playwright covers critical browser workflows. Version 0 has one intercepted,
  deterministic foundation smoke test; future flows should use real API
  boundaries and isolated test data where practical.

Version 1.1 adds contract coverage for normalization and response privacy,
application tests for hashing and persistence inputs, real-PostgreSQL repository
and concurrent-uniqueness tests, HTTP status/error tests, registration component
state tests, and one deterministic Playwright registration flow.

Version 1.2.1 adds startup-configuration tests, access-token issue and
verification tests, refresh-token entropy and hash tests, and real-PostgreSQL
refresh-session repository tests. Integration test files execute sequentially
because they share one disposable database and clear their owned tables.

Version 1.2.2 adds strict login contract tests, application failure-ordering
tests, cookie and generic-credential HTTP tests, OpenAPI coverage, and
real-PostgreSQL login/session tests. Security assertions cover response
privacy, hashed-only persistence, indistinguishable credential errors, cookie
flags, and no-cookie behavior after token or persistence failures.

Version 1.2.3 adds strict refresh-response contract tests, application
failure-ordering and replay tests, cookie-clear and browser-Origin HTTP tests,
OpenAPI coverage, and real-PostgreSQL atomic-rotation tests. The concurrency
test synchronizes two refresh attempts using one token and proves that no more
than one succeeds, one replacement remains active, and a later replay revokes
only the compromised family.

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
tests, and application builds on pushes to `main` and all pull requests. CI
deploys migrations to its disposable PostgreSQL database before integration
tests.
