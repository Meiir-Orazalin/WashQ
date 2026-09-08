# Testing strategy

## Version 1.5 profile verification

Contract tests reuse registration normalization and cover strict nonempty partial
names, omitted/null clears, limits and sensitive/immutable field rejection. Users
application tests verify trusted principal input, narrow projection, omissions and
controlled race-time deletion. Production-module HTTP tests exercise the existing
guard, generic 401, body/query spoofing, sanitized 500/log privacy, OpenAPI and
unchanged public auth/health endpoints.

PostgreSQL tests verify names, updatedAt advancement, unchanged createdAt/email/
passwordHash, unchanged vehicles/sessions/unrelated users, deletion races and atomic
last-write-wins behavior. Exact fixtures are deleted and child cascades checked.
The existing vehicle migration verifier remains mandatory without a new migration.

Component/provider tests cover read-only profile display, prefill, field errors,
cancel/focus, pending latches, successful authoritative commits, nullable clears,
no profile/query/mutation cache, exact channel payloads, remote `/me` without refresh
or rebroadcast, remote failure recovery and stale success/401/500 after account
switches. Authentication and vehicle suites remain regression gates.

`pnpm test:e2e:profile` runs `e2e/live-auth/profile.spec.ts` with built API/web and
PostgreSQL on the existing Chrome/Chromium and WebKit projects. Scenarios cover
mobile keyboard edits, persistence after restoration, nullable clears, immutable
API rejection, same-user cross-tab synchronization with unchanged cookie/family,
and account switching during a delayed update. Privacy checks retain credentials
only transiently in the runner and assert booleans, never print them. Existing
fixture/trace sanitization verifies zero temporary users, vehicles and sessions.
The browser workflow runs profile scenarios after auth and vehicle gates.
Firefox remains unqualified; a local result is not a GitHub-hosted result.

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

Version 1.2.7 adds central-client refresh classification tests, exact-Promise
single-flight coordinator tests, and provider tests for initialization,
restoration, `/me` verification, Strict Mode, stale-result suppression,
expiration scheduling, visibility recovery, invalid sessions, and ambiguous
failures. Fake timers prove one timer is replaced per token and that an
indeterminate rotation is not retried before the known token expires. Storage
assertions cover Web Storage, IndexedDB, cookies, DOM, and React Query. The
desktop/mobile Playwright login flow reloads the page, asserts one refresh
followed by `/me`, and verifies the rotated cookie remains HttpOnly while access
tokens remain absent from script-visible persistence.

Version 1.2.8 adds client tests for bodyless credentialed logout and empty 204
handling, coordinator idle-barrier tests, and provider tests for immediate
memory clearing, timer cancellation, refresh/logout ordering, stale
restoration/login/refresh suppression, duplicate-submit prevention, explicit
retry, and safe 403/500 handling. Desktop and mobile Playwright scenarios cover
standard logout, reload after cookie clearing, logout during a controlled
refresh, and unconfirmed logout retry.

The final release review also uses the built API, built web application, and
real PostgreSQL. The deliberate two-tab refresh stress test is not replaced by
mocked browser coverage. Its observed `401`/`200` split, cleared replacement
cookie, failed follow-up refresh, and zero-active-session family are retained as
the Version 1.2.8 failing baseline that Version 1.2.9 must not reproduce.

Version 1.2.9 adds focused lock-adapter tests for exclusive acquisition,
fail-closed capability detection, sanitization, release, and sequential
login/refresh/logout ordering. Provider tests prove that existing
same-document single flight and logout barriers compose with the cross-tab
lock. Desktop Chromium and WebKit use two pages in one Playwright
`BrowserContext` to share the actual cookie jar. The suite verifies repeated
sequential restoration, near-expiration rotation, refresh-versus-logout,
login-versus-refresh, fail-closed unsupported-browser UI, maximum mutation
concurrency of one, and a usable final cookie. Mobile Chrome retains the full
login/restoration/logout regression suite. The release review repeats the
multi-tab scenarios against the built API and real PostgreSQL and inspects only
cookie attributes and hash-free family counts.

Version 1.3.1 adds focused lifecycle-channel tests for the stable name,
ephemeral source IDs, exact non-sensitive payloads, self-event suppression,
malformed payload rejection, subscriber cleanup, close behavior, and
fail-closed capability detection. Provider and component tests cover immediate
old-memory removal, accessible synchronization UI, refresh-plus-`/auth/me` on
every successful refresh path, atomic token/user commits, same-user and
different-user projection changes, confirmed-only broadcast, remote logout
without server calls, repeated-event coalescing, and generation ordering against
login, logout, and later events.

Desktop Chromium and WebKit run deterministic multi-page tests in one
`BrowserContext`. They verify automatic same-user synchronization,
different-account switching with the old UI removed while refresh is delayed,
confirmed cross-tab logout, reload without a loop, repeated three-tab stress,
maximum cookie-mutation concurrency of one, exact lifecycle payload privacy,
memory-only tokens, final cookie attributes, and unsupported BroadcastChannel
behavior. The release review additionally runs the built web and API
applications with real PostgreSQL, verifies one final active refresh session
and no family replay revocation, and compares every authenticated display with
its Bearer-authenticated `/auth/me` result.

Version 1.3.2 promotes the built API, built web application, shared browser
cookie jar, and real PostgreSQL assertions into repeatable Playwright commands.
The pull-request Chromium smoke covers simultaneous two-tab restoration,
different-account synchronization, confirmed cross-tab logout, and
refresh-versus-logout ordering. The main, manual, and bounded weekly matrix
runs Chromium and WebKit with repeated restoration and A/B switching,
near-expiration refresh, waiting and lock-holding page termination, close and
reload during synchronization, and runtime BroadcastChannel failures.

Live scenarios derive deterministic, per-run namespaced emails from the
workflow run and test identity. They register through the public API, delete
only those exact users afterward, rely on the existing cascade for sessions,
and fail if users or sessions remain. Database assertions select counts only:
they never select password or token hashes. Browser barriers use Web Lock
queries, request interception, response events, and Playwright expectations;
the live suite has one worker, zero retries, and no long timing sleeps.

Credential-bearing Playwright network traces can retain Authorization headers,
Set-Cookie values, passwords, or access-token response bodies. Live-auth traces
therefore disable DOM snapshots, sources, and attachments, then remove network
records and non-screenshot resources and redact input parameters before CI
upload. A synthetic sanitizer regression verifies that policy. Failures also
retain screenshots, video, an HTML report, and an attached method/path/status
timeline that never records headers, bodies, queries, cookie values, or
credentials.

## Version 1.4.1 vehicle verification

Contract tests cover strict public boundaries, ownership spoof rejection,
whitespace/NFKC/Unicode normalization, equivalent plates, nullable optionals and
UTC-year boundaries using controlled time. Application and HTTP tests cover the
minimum principal, scoped authentication, normalization, projection, generic
401, controlled 409 and sanitized infrastructure failures. Existing public auth,
health, registration and login suites remain regression gates.

Real PostgreSQL tests verify canonical persistence, owner isolation, deterministic
ordering, composite uniqueness, identical plates under different owners,
foreign keys, cascading user deletion, indexes and timezone-aware timestamps.
Concurrent equivalent authenticated HTTP creates must yield exactly one 201,
one 409 and one row, without affecting another owner. The separate disposable
migration command applies all history and checks drift without resetting data.

Frontend tests exercise loading, empty/list/error states, accessible forms,
duplicate submission prevention, safe conflicts, memory-only token callbacks,
logout/401 clearing and delayed previous-user responses. Token presence tests
use test-only callback classification; credentials never enter markup.

`pnpm test:e2e:vehicles` reuses the Version 1.3.2 built-stack configuration and
namespaced fixture/trace-cleanup harness in `e2e/live-auth/vehicles.spec.ts`.
Chromium and WebKit cover mobile-width keyboard interaction, persisted creation
after reload/restoration, ownership across browser contexts, concurrent duplicate
HTTP requests, and two-tab A-to-B switches with a deliberately delayed A list
response. Storage, markup, cookie omission and browser console checks compare
secrets in memory and assert booleans without printing credentials. Fixture cleanup
now verifies vehicle and session counts independently after user deletion.
The existing browser workflow runs vehicle scenarios after its auth gate, using
the same artifact sanitization policy. Root E2E imports the existing contracts
workspace package through its public entry point; this adds no external package.

## Version 1.4.2 vehicle mutation verification

Contract tests cover strict nonempty partial updates, UUIDs, immutable/ownership
spoof rejection, shared normalization, omitted versus nullable fields and controlled
UTC-year boundaries. Application tests verify scoped port inputs, absent-field
preservation and controlled errors. HTTP tests verify empty DELETE 204, generic
401/404, strict PATCH responses, duplicate 409, OpenAPI and sanitized error/log output.

PostgreSQL mutation tests use only exact temporary owners and verify timestamps,
canonical persistence, optional clears, missing/foreign equivalence, unchanged
unrelated rows and user cascade. Real HTTP races assert update 200/409, delete
204/404, and update/delete ordering without resurrection. Existing schema/index
tests and `test:vehicle-migration` remain mandatory; no migration is added.

Component tests cover prefill, changed-field submission, validation associations,
focus after save/cancel/delete, confirmation, pending latches, safe errors and
stale-row invalidation. Delayed update/delete success, 401 and 404 are released
after switching to B and must not change B's cache or UI. Remote logout and
current-token 401 remove forms, confirmations and query data without retry.

`e2e/live-auth/vehicle-edit-delete.spec.ts` extends `pnpm test:e2e:vehicles` on
the existing Chrome/Chromium and WebKit projects with built API/web/PostgreSQL.
It covers all-field edit and reload, optional clearing, duplicate feedback,
foreign/missing error equivalence, repeated deletion, concurrent plate changes,
and two-tab account switches during delayed PATCH and DELETE responses. Storage,
markup, cookie omission and console checks assert boolean privacy results.
Fixture teardown confirms zero remaining temporary users, vehicles and sessions.
Firefox is not qualified. Authentication smoke and existing create/list tests
remain required regressions, not replaced by these mutation tests.

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
tests. The separate authentication-browser workflow runs Chromium smoke on
pull requests and the full Chromium/WebKit matrix on `main`, manual dispatch,
and the weekly schedule. Each job installs only its required Playwright binary,
generates an ephemeral signing secret without logging it, waits on application
readiness instead of sleeping, sanitizes failure artifacts, and verifies
fixture cleanup.
