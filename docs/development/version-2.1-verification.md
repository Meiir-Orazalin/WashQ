# Version 2.1 local release verification

Verified on 2026-09-11 from `feature/v2.1-organization-create-list`, based on
`ad11306638a75a818468f4d6ef163866438ecbaa` (`main`, tag `v0.5.0`). Required customer
profile commit `d84ec52` is an ancestor. The starting worktree was clean.

## Delivered boundaries and flows

Only organization creation, owned listing and owner-only detail are implemented.
Strict framework-independent contracts normalize input and expose only organization
id/name/nullable description/timestamps. Name uses NFKC, trim, whitespace collapse,
preserved casing and 2–120 characters with control rejection. Description is trimmed,
nullable/blank-to-null, at most 500 characters, retaining internal punctuation and
CR/LF but rejecting other controls. Names are deliberately not unique.

POST `/api/v1/organizations` uses the existing scoped Bearer guard, minimum verified
userId principal, CreateOrganizationUseCase and OrganizationRepository. Its Prisma
adapter creates organization plus one OWNER membership in a single transaction.
The controller maps an explicit public response and returns 201. GET list returns
200 with OWNER-membership-filtered organizations ordered by createdAt DESC, id DESC.
GET detail validates UUID and queries both resource and verified OWNER membership.
Missing and foreign detail return identical 404 ORGANIZATION_NOT_FOUND code/message.
Invalid input/query/UUID is 400, authentication is generic 401, infrastructure is
sanitized 500. OpenAPI documents all three strict endpoints and scoped Bearer security.

Prisma is infrastructure-only; use cases contain no NestJS, HTTP or Prisma imports.
No cross-module persistence implementation is accessed. Auth production behavior,
AuthenticationProvider, runWithAccessToken and AuthLifecycleChannel are unchanged.
The shared HTTP filter now strips query values from response/log paths so rejected
ownership or credential queries are not reflected during unexpected failures.

One forward migration, `20260911062954_add_organizations_and_owner_memberships`, adds
minimal organization/membership tables and an organization-scoped OWNER enum. UUIDs,
timestamptz(3), unique organization/user membership and user/role index are verified.
User FK is RESTRICT; organization FK is CASCADE. Vehicle/session cascades remain
unchanged. Initial-owner creation cannot partially commit. Fixture cleanup deletes
its organizations before users and refuses organizations with unrelated members.
No prior migration was edited. ADR 0013 records this durable ownership/integrity choice.

The two routes are `/business/organizations` and
`/business/organizations/[organizationId]`. Native accessible forms, semantic lists,
plain-text details and minimal account navigation follow existing UI patterns.
The user-keyed authenticated subtree hides immediately on identity transitions.
Feature-local cleanup cancels/removes both list/detail key families. Creation aborts
on unmount and invalidates only the captured account after provider generation checks.
No token enters query keys, cache, mutation results, browser storage or markup.
Descriptions are text, not HTML. No new lifecycle event or global token is introduced.

## Exact successful gates

| Gate                                | Result                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Frozen install                      | Passed; existing pinned dependencies, no lockfile change                                 |
| Docker/PostgreSQL                   | Existing container running and healthy; no reset                                         |
| Prisma generation                   | Passed, Prisma Client 7.9.0                                                              |
| Dev deploy/status                   | All 5 migrations applied; up to date                                                     |
| Integration deploy/status           | All 5 migrations applied; up to date                                                     |
| Dev/test schema drift               | Both: no difference detected                                                             |
| Disposable migration verification   | All 5 migrations, vehicle/org schema, membership FKs/indexes/timestamps and drift passed |
| Format                              | Passed                                                                                   |
| Lint                                | Passed                                                                                   |
| Typecheck                           | Passed                                                                                   |
| Contract units                      | 251 passed in 9 files                                                                    |
| API/application/HTTP units          | 297 passed in 25 files                                                                   |
| Web component/client/provider units | 238 passed in 18 files                                                                   |
| Total units                         | 786 passed in 52 files                                                                   |
| PostgreSQL integration              | 69 passed in 10 files                                                                    |
| General browser regressions         | 41 passed: desktop Chrome 17, mobile Chrome 7, WebKit 17                                 |
| Organization E2E                    | 10 passed: Chrome 5, WebKit 5                                                            |
| Authentication smoke                | 4 passed, Chrome                                                                         |
| Vehicle E2E                         | 18 passed: Chrome 9, WebKit 9                                                            |
| Profile E2E                         | 8 passed: Chrome 4, WebKit 4                                                             |
| Build                               | Contracts, Nest API and Next web all succeeded; both new routes present                  |
| Trace sanitizer                     | Passed                                                                                   |
| Exact E2E namespace cleanup         | All four run namespaces reported zero deleted and zero remaining rows                    |
| Independent live review             | Passed; exact fixture cleanup verified zero rows in all five affected tables             |
| Git whitespace review               | `git diff --check` passed                                                                |

Browser tests used installed stable Chrome through `AUTH_E2E_USE_SYSTEM_CHROME=true`
and the pinned Playwright WebKit engine. Firefox is not qualified. Existing Turbo
cache hits replayed results produced successfully in this worktree; fresh full unit
and PostgreSQL/browser executions were also performed. Local results are not evidence
of GitHub-hosted checks. GitHub CLI was not installed (`command -v gh` returned no path).

## Commands actually executed

Preparation included `pwd`, `git rev-parse --show-toplevel`, `git status --short --branch`,
`git branch --show-current`, `git rev-parse HEAD`, `git log`,
`git merge-base --is-ancestor d84ec52 HEAD`, instruction/document/source reads and
Git status/diff reviews. Remote inspection withheld any URL credentials.

```bash
pnpm install --frozen-lockfile
docker compose up -d
docker inspect --format '{{.State.Health.Status}}' washqueue-postgres-1
pnpm --filter @washqueue/api exec prisma format
pnpm --filter @washqueue/api exec prisma migrate dev --name add_organizations_and_owner_memberships --create-only
pnpm db:generate
pnpm --filter @washqueue/api db:migrate:deploy
pnpm --filter @washqueue/api exec prisma migrate status
NODE_ENV=test pnpm --filter @washqueue/api db:migrate:deploy
NODE_ENV=test pnpm --filter @washqueue/api exec prisma migrate status
pnpm --filter @washqueue/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
NODE_ENV=test pnpm --filter @washqueue/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
pnpm test:vehicle-migration
pnpm --filter @washqueue/contracts build
pnpm --filter @washqueue/api exec vitest run test/organization-use-cases.test.ts test/organizations-api.test.ts
pnpm --filter @washqueue/web exec vitest run components/organizations.test.tsx components/organizations-auth-state.test.tsx lib/organization-api-client.test.ts
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/api/v1 pnpm build
AUTH_E2E_RUN_ID=v21-organizations AUTH_E2E_USE_SYSTEM_CHROME=true pnpm test:e2e:organizations
AUTH_E2E_RUN_ID=v21-smoke AUTH_E2E_USE_SYSTEM_CHROME=true pnpm test:e2e:auth-smoke
AUTH_E2E_RUN_ID=v21-vehicles AUTH_E2E_USE_SYSTEM_CHROME=true pnpm test:e2e:vehicles
AUTH_E2E_RUN_ID=v21-profile AUTH_E2E_USE_SYSTEM_CHROME=true pnpm test:e2e:profile
AUTH_E2E_RUN_ID=v21-organizations pnpm test:e2e:auth-cleanup
AUTH_E2E_RUN_ID=v21-smoke pnpm test:e2e:auth-cleanup
AUTH_E2E_RUN_ID=v21-vehicles pnpm test:e2e:auth-cleanup
AUTH_E2E_RUN_ID=v21-profile pnpm test:e2e:auth-cleanup
pnpm test:e2e:auth-sanitize
node --env-file=.env /private/tmp/washqueue-v21-release-review.mjs
git diff --check
```

Targeted `pnpm exec prettier --write` commands formatted changed code/docs after
edits. Git delivery commands and their resulting commit/push state are reported
separately at handoff; no hosted workflow or PR success is inferred here.

## Independent live review and security findings

The temporary review script started built API/web itself, registered/logged in two
exact fixture users, and exercised live UI creation, owned list/detail and reload.
It checked normalized persistence, no Set-Cookie, omitted browser cookie transport,
same current-user ownership, identical foreign/random 404s, spoof rejection and
OpenAPI Bearer security. PostgreSQL verified initial OWNER rows, timestamps, indexes,
restricted owner deletion and unchanged user/vehicle/session state during creation.
Built-production repository rollback was independently covered by both browser
projects and real PostgreSQL integration tests.

The review delayed an A detail response while another tab logged into B. A's UI
disappeared during synchronization; only B's keys/data remained after releasing the
old result. Unit tests additionally released stale successes and 401/404/500 for
list/detail/create, verifying no new-account invalidation or old feedback. Browser
tests exercise both delayed list and detail results and confirmed remote logout.

QueryClient state, browser storage/markup, credential-omitting transport and API/web/
console logs were checked with transient in-memory values and boolean comparisons.
No credential or ownership leakage was observed. Passwords, tokens, cookies and
signing secrets were neither printed nor committed. No owner/membership model is
public, no global role/guard exists, and profile/vehicle/auth regressions passed.

Desktop (1280px) and mobile (390px) screenshots were visually reviewed. Labels,
associated field errors, textarea keyboard navigation, visible focus, native
buttons, announced loading/success/server errors, semantic list/detail navigation
and lack of horizontal overflow were verified. No focus trap or UI library exists.
This is not a claim of a formal assistive-technology certification.

Only exact temporary organizations were deleted before temporary users. Verification
reported organizations=0, memberships=0, users=0, vehicles=0, sessions=0. The clean
migration database was removed only because this run created it. Development data
and Docker volumes were not reset. Temporary review scripts/screenshots remain
outside the repository under `/private/tmp`; they contain no credentials.

## Resolved verification failures

- Early type checks caught incorrect Swagger type imports and explicit-undefined
  optional form errors; both were corrected without weakening TypeScript.
- Formatting flagged one new test file; it was formatted and the full check passed.
- Four first-run browser assertions matched Next's additional route-announcer alert;
  selectors were scoped to the actual organization message, not removed or skipped.
- One mistakenly overlapping local integration/browser run interfered through the
  shared test database (5 integration test failures and 1 browser failure). Exact
  cleanup was verified, then both complete gates were rerun sequentially and passed.
  The overlap is not counted as release evidence; sequencing is documented.
- The independent review initially matched a list heading before detail navigation
  completed. An explicit URL/region wait corrected the review. Production cache
  behavior was correct; the browser test now also asserts the detail URL and a
  nonempty detail cache. The corrected complete organization suite passed again.

## Files changed

Backend and database:

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260911062954_add_organizations_and_owner_memberships/migration.sql`
- `apps/api/src/app.module.ts`
- `apps/api/src/http/http-exception.filter.ts`
- `apps/api/src/organizations/domain/organization.ts`
- `apps/api/src/organizations/application/organization.repository.ts`
- `apps/api/src/organizations/application/create-organization.use-case.ts`
- `apps/api/src/organizations/application/list-owned-organizations.use-case.ts`
- `apps/api/src/organizations/application/get-owned-organization.use-case.ts`
- `apps/api/src/organizations/infrastructure/prisma-organization.repository.ts`
- `apps/api/src/organizations/presentation/organization.dto.ts`
- `apps/api/src/organizations/presentation/organization-response.mapper.ts`
- `apps/api/src/organizations/presentation/organizations.controller.ts`
- `apps/api/src/organizations/organizations.module.ts`
- `apps/api/test/organization-test-app.ts`
- `apps/api/test/organization-use-cases.test.ts`
- `apps/api/test/organizations-api.test.ts`
- `apps/api/test/organizations.integration.test.ts`
- `apps/api/test-support/auth-e2e-database.mjs`
- `apps/api/test-support/verify-vehicle-migration.mjs`

Contracts and frontend:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/organization.ts`
- `packages/contracts/test/organization.test.ts`
- `apps/web/app/business/organizations/page.tsx`
- `apps/web/app/business/organizations/[organizationId]/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/organization-authentication-boundary.tsx`
- `apps/web/components/organization-detail.tsx`
- `apps/web/components/organizations.tsx`
- `apps/web/components/organizations.test.tsx`
- `apps/web/components/organizations-auth-state.test.tsx`
- `apps/web/components/login-form.tsx`
- `apps/web/components/profile.tsx`
- `apps/web/components/vehicles.tsx`
- `apps/web/hooks/use-organizations.ts`
- `apps/web/lib/organization-api-client.ts`
- `apps/web/lib/organization-api-client.test.ts`

Browser/CI and documentation:

- `.github/workflows/auth-browser.yml`
- `package.json`
- `e2e/live-auth/auth-test.ts`
- `e2e/live-auth/global-teardown.ts`
- `e2e/live-auth/organizations.spec.ts`
- `docs/architecture/organizations.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/api-conventions.md`
- `docs/architecture/database-conventions.md`
- `docs/architecture/security-baseline.md`
- `docs/architecture/frontend-authentication-lifecycle.md`
- `docs/architecture/testing-strategy.md`
- `docs/decisions/0013-organization-membership-ownership-and-deletion-integrity.md`
- `docs/development/commands.md`
- `docs/development/local-setup.md`
- `docs/development/version-2.1-verification.md`
- `docs/product/version-roadmap.md`

## Limitations and handoff

No dependency was added; the lockfile is unchanged. No unresolved high-severity
authorization, integrity or cache-isolation defect was found. Human review and hosted
PR checks remain necessary before merge. No Business Onboarding release tag is created.
Only Version 2.1 is marked complete; all Business Onboarding is not complete.

No organization edit/delete/transfer, owner management, employees, branches/hours,
services/prices, verification/public discovery, bookings/queues or global roles are
implemented. Creation has no idempotency key or name uniqueness; manually resubmitting
an ambiguous successful create may create another same-name organization. Initial
owner integrity is guaranteed by the production repository transaction and FKs, not
a trigger policing arbitrary privileged direct organization inserts. Account deletion
requires a future explicit ownership-resolution design. No Firefox claim is made.

Recommended Version 2.2: membership-authorized branch creation and owner-only
branch viewing, organization-scoped resource predicates, IANA timezone-aware opening
hours with strict weekly/overnight validation, identity-scoped frontend caches and
PostgreSQL/browser ownership tests. Keep employees, services, pricing and booking
out of that focused slice unless separately specified.
