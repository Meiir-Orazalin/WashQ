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

Version 1.2.4 adds application tests for token-shape validation, branded-hash
repository input, idempotent state handling, and propagated infrastructure
failures. HTTP tests cover empty 204 responses, centralized cookie clearing,
shared Origin protection, sanitized 403/500 responses, log privacy, and
OpenAPI. Real-PostgreSQL tests prove atomic one-session revocation, isolation
from other sessions and families, rotated-predecessor behavior, deletion
cascade, hashed-only persistence, and two simultaneous logout attempts.

Version 1.2.5 adds strict current-user response contracts, focused Bearer
reader tests, access-token application tests, endpoint-scoped OpenAPI coverage,
and real-PostgreSQL public-user projection tests. HTTP security tests prove
generic authentication failures, current database values, no cookie mutation,
no refresh-session dependency, sanitized infrastructure failures, and
Authorization/token/signing-secret log privacy. Existing public endpoint suites
remain regression coverage against accidental global protection.

Version 1.2.6 adds login-form validation, accessibility, loading, success, and
failure tests; central-client credential and Authorization assertions;
authentication-state transition tests; and storage, cookie, DOM, password, and
TanStack cache privacy checks. A deterministic desktop/mobile Playwright flow
intercepts login and current-user responses, verifies the HttpOnly cookie,
confirms memory-only storage, and proves reload returns to the login form
without an automatic restoration request. Existing home and registration
browser flows remain regression coverage.

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
