# Version 2.2 verification and completion report

## Delivery

All required local technical gates passed on 2026-09-30. Delivery is the
`feature/v2.2-branches-opening-hours` branch with commit message
`feat(branches): add branches and weekly opening hours`. Final commit/push state
is reported in the handoff; this report does not claim GitHub-hosted checks.
GitHub CLI is absent, so no CLI PR/check operation was possible. Do not merge
without human review and passing hosted checks; no business release tag.

Baseline: clean expected branch at `f79302e6a9c14b975743d6f31346c6d505b0be55`,
the Version 2.1 PR merge, containing `26d8a5d`. Root/nested instructions,
required architecture/lifecycle/security/database/testing/roadmap and ADRs
0007–0013 were read before implementation. Existing boundaries were inspected.

## Implementation and boundaries

- OrganizationOwnerAccess is a framework-independent public void owner assertion.
  The organization's existing membership-filtered application repository stays
  private. Branches imports only public access/error and Nest module composition,
  never organization Prisma, membership models or persistence DTOs. Boundary
  source tests enforce this. OWNER is still organization-scoped, not global.
- CreateBranchUseCase validates normalized input, asserts owner, persists one
  scoped branch and maps public fields. No schedule rows are auto-created.
- ListOwnedOrganizationBranchesUseCase asserts owner and queries only that
  organization, createdAt DESC/id DESC. GetOwnedBranchUseCase matches organization
  and branch after owner assertion and includes empty or complete ordered hours.
- ReplaceBranchOpeningHoursUseCase validates the complete shared week and maps
  exact HH:mm strings to local minutes. Infrastructure locks the scoped branch
  FOR UPDATE, replaces seven rows, advances branch updatedAt and commits. Failure
  preserves the prior full week; two concurrent full writes serialize and leave
  one whole request. No optimistic version column or distributed locking.
- Missing/non-owned organization uses the existing generic ORGANIZATION_NOT_FOUND.
  Under an owned organization, missing/wrong-organization branch uses identical
  BRANCH_NOT_FOUND, `The branch was not found`. No foreign existence or 403.
- Strict contracts accept only branch name/city/address/timeZone or seven schedule
  entries. Text uses NFKC/trim/collapse, controls rejected, casing retained, lengths
  2–100/2–100/5–250. Intl validates trimmed IANA zones up to 100; offsets rejected.
  OPEN duration is 1–1439 with explicit overnight flag; CLOSED/OPEN_24_HOURS require
  null times/false flag. Responses always Monday–Sunday. Empty means unconfigured.
- All four REST routes reuse scoped Bearer/current-user authentication, validate
  path UUIDs and reject unknown query/body fields. OpenAPI describes 201/200,
  local/IANA semantics, strict schemas, 400, generic 401/404 and sanitized 500.
  Public branch bodies contain no organization/user/membership IDs or minutes.

## Database

One new forward migration:
`20260930113127_add_branches_and_weekly_opening_hours`.
No old migration changed, no runtime dependency added, no lockfile change.
Branches has eight columns and hours nine. UUID PKs, branch organization CASCADE,
hours branch CASCADE, branch/day uniqueness, listing/retrieval indexes,
timestamptz(3) timestamps, minute-range and status/duration checks are verified.
Existing membership user RESTRICT and vehicle/session integrity remain intact.
Dev/test deploy/status report six applied migrations. Both drift checks report
no difference. Clean disposable full-history verification applied all six,
checked existing and new schema/index/FK/check/timestamps and removed only the
database it created. It refuses a pre-existing disposable database.

Seven-row completeness is a validated production repository transaction invariant,
not a deferred SQL trigger forbidding privileged manual single-row inserts.
Every production writer locks the same branch row first. Membership changes are
not exposed; future membership removal must revisit authorization/write races.

## Frontend, cache and cross-tab behavior

List route: `/business/organizations/[organizationId]/branches`.
Detail route adds `/[branchId]`. Existing organization detail links to branches.
Owner context, creation form, semantic list, detail, local schedule and seven
fieldset editor are present. Empty hours show `Opening hours have not been
configured.`; all-Closed editor defaults are explicitly unsaved. Labels/errors,
weekday controls, pending/success/alert feedback, keyboard and mobile layouts are
native; text is never HTML. No edit/delete/box/service controls exist.

Stateless transport takes only the memory-only token callback, omits cookies,
uses no-store, validates/encodes UUID paths, parses strict contracts, supports
abort and never automatically retries. Query keys are
`['branches', userId, organizationId]` and
`['branch', userId, organizationId, branchId]`. Mutations have no token variables
or result, no optimistic writes and invalidate only captured user/resource keys.
Any non-authenticated transition hides/unmounts forms/data, aborts pending writes
and cancels/removes both departing-user cache families. Provider generations and
mounted/abort checks prevent old success/401/404/500 from affecting a new account.
No feature state or auth event is added to AuthenticationProvider.

Real browser delayed A list/detail/PUT, cross-tab B login and held remote refresh
verify immediate old UI removal, B's generic unavailable-A-resource state and
then B-only branch UI/cache. Releasing old results cannot restore A or show A
success. Component tests also verify stale failures and logout. A browser abort
cannot undo an already committed A write; it discards the stale UI result.

## Exact executed gates

| Command                                                                                                           | Final result                                                               |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                  | Passed; existing pinned dependencies                                       |
| `docker compose up -d` / `docker compose ps`                                                                      | PostgreSQL 18.4 running healthy                                            |
| `pnpm db:generate`                                                                                                | Passed, Prisma 7.9 client                                                  |
| `pnpm --filter @washqueue/api exec prisma format`                                                                 | Passed                                                                     |
| `pnpm --filter @washqueue/api exec prisma migrate dev --name add_branches_and_weekly_opening_hours --create-only` | Created one migration; checks added before deployment                      |
| `pnpm --filter @washqueue/api db:migrate:deploy` and `exec prisma migrate status`                                 | Dev: all six applied/up to date                                            |
| Same deploy/status with `NODE_ENV=test`                                                                           | Integration: all six applied/up to date                                    |
| Dev/test `exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`         | Both no difference                                                         |
| `pnpm test:vehicle-migration`                                                                                     | Clean full history/schema/integrity/drift passed                           |
| `pnpm format:check`                                                                                               | Passed                                                                     |
| `pnpm lint`                                                                                                       | Passed                                                                     |
| `pnpm typecheck`                                                                                                  | Passed                                                                     |
| `pnpm test`                                                                                                       | Contracts 346/10 files, API 347/27, web 260/20; 953 tests, 57 files passed |
| `pnpm test:integration`                                                                                           | 82 tests, 11 files passed; new branches 13                                 |
| `pnpm test:e2e`                                                                                                   | 41 passed: desktop Chrome, mobile Chrome and WebKit                        |
| `pnpm test:e2e:auth-smoke`                                                                                        | 4 passed, Chrome                                                           |
| `pnpm test:e2e:organizations`                                                                                     | 10 passed: 5 Chrome, 5 WebKit                                              |
| `pnpm test:e2e:vehicles`                                                                                          | 18 passed: 9 Chrome, 9 WebKit                                              |
| `pnpm test:e2e:profile`                                                                                           | 8 passed: 4 Chrome, 4 WebKit                                               |
| `pnpm test:e2e:branches`                                                                                          | 12 passed: 6 Chrome, 6 WebKit                                              |
| `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/api/v1 pnpm build`                                                | Contracts/API/web, 3 successful tasks                                      |
| `git diff --check`                                                                                                | Passed                                                                     |

Live commands used `AUTH_E2E_USE_SYSTEM_CHROME=true`. Branch run namespace was
`v22-branches`; regressions used `v22-regressions`. Both subsequent
`pnpm test:e2e:auth-cleanup` commands reported all seven tables zero, with no leak
rows deleted. All shared-database integration/live gates ran sequentially.
Focused contract/API/web commands, Prettier on changed files and read-only
Git/status/history/ancestry/diff/rg/cat/sed inspections also executed. Initial lint
failed on new fixture non-null assertions and two transport tests failed on
undefined GET bodies; these were corrected and the full gates rerun successfully.
No test was skipped, deleted or weakened. A subset of final unchanged tasks used
Turborepo's successful local cache; new/changed tests actually executed.

## Independent live/browser/PostgreSQL/security review

`node --env-file-if-exists=.env /private/tmp/washqueue-v22-release-review.mjs`
ran outside the worktree and passed. It started built API and web, created exact
temporary A/B accounts, customer vehicle, organizations and branches; created
through the UI; saved normal/Closed/24-hour/overnight days; reloaded; and inspected
exact local HH:mm under America/New_York browser time zone with Asia/Almaty branch.

It compared foreign/missing organization 404s, verified wrong-organization branch
404, forced built production repository failure and verified previous seven days,
ran two concurrent HTTP replacements (both 200, final one complete week), inspected
SQL rows/minutes/timestamps/indexes/checks/RESTRICT, and compared unchanged user/
vehicle values. Integration independently compares unchanged refresh sessions.
It delayed a committed A schedule response across a shared-cookie B login and
verified no A UI or success under B. Query-cache isolation is independently asserted
by browser and component suites. Privacy checks confirm no password/token/cookie
in storage/markup or logs and no owner ID/email in API logs; no secrets are printed.

Desktop and 390px mobile screenshots were visually inspected at
`/private/tmp/washqueue-v22-branch-desktop.png` and
`/private/tmp/washqueue-v22-branch-mobile.png`. No horizontal overflow, focus trap
or inaccessible icon control was found. Native labels/legends, associated errors,
disabled irrelevant fields and announced feedback are covered by component/browser
assertions. No external accessibility certification is claimed.

Exact organizations were deleted before their users, then seven independent
counts verified zero hours, branches, memberships, organizations, users, vehicles
and refresh sessions. Existing development data was not reset/deleted. Review
processes stopped; Docker volume retained. Browser traces use existing sanitization.
Security review found no high-severity ownership, integrity, time or cache defect.

## Changed files and documentation

Changes are limited to contracts/exports/tests; new branch domain/application/
repository/Prisma/HTTP/OpenAPI/composition; public organization access/composition;
Prisma schema and the one new migration; branch routes/components/form/client/query
hooks/tests and minimal CSS/organization link; fixture/migration/browser workflow
support; architecture/API/database/security/lifecycle/testing/local-command docs,
roadmap, this record and ADR 0014. No dependencies, old migrations, credentials,
handoff blocker, unrelated production capability or authentication behavior changed.
Exact changed file list:

```text
.github/workflows/auth-browser.yml
apps/api/prisma/migrations/20260930113127_add_branches_and_weekly_opening_hours/migration.sql
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/branches/application/branch.repository.ts
apps/api/src/branches/application/create-branch.use-case.ts
apps/api/src/branches/application/get-owned-branch.use-case.ts
apps/api/src/branches/application/list-owned-organization-branches.use-case.ts
apps/api/src/branches/application/replace-branch-opening-hours.use-case.ts
apps/api/src/branches/branches.module.ts
apps/api/src/branches/domain/branch.ts
apps/api/src/branches/infrastructure/prisma-branch.repository.ts
apps/api/src/branches/presentation/branch-response.mapper.ts
apps/api/src/branches/presentation/branch.dto.ts
apps/api/src/branches/presentation/branch.openapi.ts
apps/api/src/branches/presentation/branches.controller.ts
apps/api/src/organizations/application/organization-owner-access.ts
apps/api/src/organizations/organizations.module.ts
apps/api/src/organizations/public.ts
apps/api/test-support/auth-e2e-database.mjs
apps/api/test-support/verify-vehicle-migration.mjs
apps/api/test/branch-use-cases.test.ts
apps/api/test/branches-api.test.ts
apps/api/test/branches.integration.test.ts
apps/api/test/organization-test-app.ts
apps/web/app/business/organizations/[organizationId]/branches/[branchId]/page.tsx
apps/web/app/business/organizations/[organizationId]/branches/page.tsx
apps/web/app/globals.css
apps/web/components/branch-authentication-boundary.tsx
apps/web/components/branch-detail.tsx
apps/web/components/branches.test.tsx
apps/web/components/branches.tsx
apps/web/components/organization-detail.tsx
apps/web/components/organizations.test.tsx
apps/web/hooks/use-branches.ts
apps/web/lib/branch-api-client.test.ts
apps/web/lib/branch-api-client.ts
apps/web/lib/branch-form.ts
docs/architecture/api-conventions.md
docs/architecture/branches.md
docs/architecture/database-conventions.md
docs/architecture/frontend-authentication-lifecycle.md
docs/architecture/module-boundaries.md
docs/architecture/organizations.md
docs/architecture/security-baseline.md
docs/architecture/system-overview.md
docs/architecture/testing-strategy.md
docs/decisions/0014-branch-local-weekly-opening-hours.md
docs/development/commands.md
docs/development/local-setup.md
docs/development/version-2.2-verification.md
docs/product/version-roadmap.md
e2e/live-auth/auth-test.ts
e2e/live-auth/branches.spec.ts
e2e/live-auth/global-teardown.ts
e2e/live-auth/organizations.spec.ts
package.json
packages/contracts/src/branch.ts
packages/contracts/src/index.ts
packages/contracts/test/branch.test.ts
```

## Limitations, merge recommendation and next scope

No branch update/delete, multiple weekday intervals, exceptions, open-now, booking
instants/DST resolution, wash boxes, employees, services, prices, queues, public
marketplace or global roles. No pagination, idempotency keys or optimistic locking.
Repeated creates after lost responses may duplicate names. Full schedule writes
are last-committed-writer-wins. Intl-supported IANA zones depend on runtime tzdata.
Firefox remains unqualified. Hosted checks are not inferred from local results.

Recommend human review of the authorization boundary, SQL checks/row lock and
identity cache behavior, followed by passing hosted checks before merge. Business
Onboarding remains incomplete and untagged. Next Version 2.3 should introduce only
owner-authorized branch wash-box creation/list/detail, scoped through the same
public owner boundary and branch repository access, with strict minimal contracts,
integrity, cache isolation and real browser/PostgreSQL tests. Do not include
employees, services, pricing, bookings or queue operations in that slice.
