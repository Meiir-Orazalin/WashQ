# Version 2.3 verification and completion report

## Baseline and delivery

All required local technical gates passed on 2026-10-01. The implementation branch
is `feature/v2.3-wash-boxes`. Its clean starting commit was
`1638fa81f7ed40da842364a263dfd00bdee89a94`, the Version 2.2 PR #6 merge, containing
`ddb9bf6969be68edee56c85b701343298c947fa2`. Fetch used `--prune --no-tags`;
`origin/main` and the existing target branch agreed, with no unique work or extra
worktree. The existing target branch was resumed, not deleted or reset. Version
2.2 module, opening-hours migration, browser suite and verification document were
verified before implementation. No baseline feature was recreated or cherry-picked.

Root/applicable nested instructions, relevant architecture, security, database,
API, cache, lifecycle, testing and roadmap documents, and ADRs 0013–0014 were read.
Existing public organization access, branch application/repository composition,
scoped guard, protected frontend patterns and fixture/CI infrastructure were
inspected. The implementation plan and affected boundaries were presented first.

This record captures local verification before Git delivery. The commit subject
is `feat(wash-boxes): add owner-managed branch wash boxes`; exact commit, push,
PR and hosted-check status are reported separately in the delivery handoff.
GitHub CLI is absent; an authenticated connector is available and PR creation
will be attempted after pushing. Local results are not evidence of a hosted run.
Do not merge without human review and passing hosted checks. No release tag or
automatic merge is part of this slice.

## Implementation and public boundaries

- `branches/public.ts` exports a framework-independent `BranchOwnerAccess` port
  and minimal readonly `{ branchId }` scope. Its facade reuses `GetOwnedBranchUseCase`,
  which delegates ownership to `OrganizationOwnerAccess` and performs an
  organization-and-branch-scoped lookup. No membership, opening hours, Prisma
  model or private repository crosses the boundary.
- The focused wash-box module has four application use cases: create, list,
  detail and explicit active-state assignment. Every operation resolves owner
  and branch access before touching its own repository. Application code imports
  only the public branch access/error surface and framework-independent contracts.
  Source-boundary tests reject private parent persistence/membership access.
- The existing endpoint-scoped Bearer/current-user guard supplies only user ID.
  There is no global guard, new role, authentication provider, middleware or
  authentication lifecycle change. Public routes remain public as before.
- Creation accepts only an integer number 1–999 and persists the authorized branch;
  the database defaults activity to true. List includes inactive boxes and orders
  number ASC/id ASC. Detail and state mutation match both branch and box IDs.
- Strict shared schemas reject ownership/parent IDs, credentials, immutable
  fields and arbitrary string coercion. Public boxes contain only id, number,
  isActive, createdAt and updatedAt, with UUID/ISO validation. No parent or
  membership IDs are exposed in public bodies.
- Missing/non-owned organization returns the existing `ORGANIZATION_NOT_FOUND`.
  Missing/wrong-organization branch returns `BRANCH_NOT_FOUND`. After valid branch
  access, missing/wrong-branch box returns identical `WASH_BOX_NOT_FOUND`.
  Foreign resources never get a special 403 or expose existence/activity.
- Database uniqueness remains authoritative. Only the recognized branch/number
  constraint is mapped to `WASH_BOX_ALREADY_EXISTS`; only the recognized missing
  branch FK failure is mapped safely to `BRANCH_NOT_FOUND`. Other infrastructure
  failures reach the existing sanitized 500 filter, not a false domain success.

## Schema, state and concurrency

One new forward migration:
`20260930150000_add_branch_wash_boxes`. It was authored as the existing SQL
migration format so the required CHECK is explicit, then deployed by the normal
Prisma commands. No applied migration was edited.

`wash_boxes` has exactly six persisted fields: UUID id, UUID branch_id, integer
number, non-null/default-true is_active and timestamptz(3) created_at/updated_at.
Number CHECK is 1–999; unique `(branch_id, number)` is also the branch listing
index. Only the primary and composite unique indexes are needed. Branch deletion
cascades boxes; organization fixture deletion cascades branches, hours, boxes
and memberships. Existing membership user RESTRICT is preserved.

Activity assignment is one parameterized UPDATE matching branch AND box IDs.
It never toggles blindly or performs read-then-write. Number/createdAt/parent are
immutable. A real change advances updatedAt by at least one millisecond at the
column's precision; a repeated same-value assignment preserves updatedAt.
Concurrent explicit assignments are last-committed-writer-wins, without versions
or locks beyond PostgreSQL's row update. Concurrent same-branch creates produce
one 201, one controlled 409 and one row. Inactive numbers remain reserved; the
same number in another branch succeeds. No capacity or occupancy is inferred.

Dev/test deployment and status show all seven migrations applied. Both live drift
checks show no difference. The existing isolated migration verifier applies all
seven migrations to a newly created disposable database, checks existing/new
constraints, indexes and timestamp types, checks drift, then removes only that
database. It refuses a pre-existing disposable target. No development data reset.

## API and frontend

All endpoints are under
`/api/v1/organizations/:organizationId/branches/:branchId/wash-boxes`:

- POST: strict `{ number }`, 201 `{ washBox }`.
- GET: 200 `{ washBoxes }`, including inactive boxes.
- GET `/:washBoxId`: 200 `{ washBox }`, including inactive boxes.
- PATCH `/:washBoxId`: strict `{ isActive: boolean }`, 200 `{ washBox }`.

Paths validate all UUIDs; unknown query/body fields are rejected. OpenAPI documents
Bearer security, strict request/public response schemas, 400, generic 401,
level-specific generic 404, create-only 409 and sanitized 500. No DELETE,
renumbering, realistic token example or occupancy contract exists.

Frontend routes mirror the nested branch path under `/business`, with a list and
`/[washBoxId]` detail; existing branch detail links to wash boxes. Owner organization
and branch context, accessible integer creation form, semantic numbered list,
active/inactive text badges, detail links and explicit enable/disable controls
use existing visual conventions. Deactivation requires clear native confirmation;
Cancel sends no request. Pending actions are announced and latched against duplicate
submission. Activity is described as configuration, not real-time free/busy state.
No optimistic state update occurs; failures are recoverable.

Stateless API methods use explicit memory-only token callbacks, `credentials:
"omit"`, safely encoded validated paths, strict shared parsing and abort support.
They neither read refresh cookies nor retry automatically. Whole-string numeric
form conversion precedes shared validation; malformed text is not partially parsed.

Keys are `['wash-boxes', userId, organizationId, branchId]` and
`['wash-box', userId, organizationId, branchId, washBoxId]`. Mutation variables
contain only public input and abort signal; results contain no token or independent
long-lived data. Successful writes invalidate only captured list/detail keys.
Keyed user/resource subtrees reset form/confirmation state. Departing identity or
branch cancels/removes prior wash-box caches and aborts writes. Provider generations,
mounted checks and post-response abort checks discard stale successes and errors,
including late same-account old-branch 401s. Feature cleanup stays outside the
unchanged AuthenticationProvider. Cancellation cannot undo an already committed
server write; that write remains scoped to its original authorized resource.

## Exact executed verification

| Command                                                                                                   | Final result                                                          |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `git fetch origin --prune --no-tags`                                                                      | Passed; baseline ancestry and clean target branch verified            |
| `pnpm install --frozen-lockfile`                                                                          | Passed; pinned dependencies unchanged                                 |
| `docker compose up -d` / `docker compose ps`                                                              | PostgreSQL 18.4 running healthy                                       |
| `pnpm db:generate`                                                                                        | Passed; Prisma 7.9 client                                             |
| `pnpm --filter @washqueue/api exec prisma format`                                                         | Passed                                                                |
| `pnpm --filter @washqueue/api db:migrate:deploy` / `exec prisma migrate status`                           | Dev: all seven applied/up to date                                     |
| Same deploy/status with `NODE_ENV=test`                                                                   | Integration: all seven applied/up to date                             |
| Dev/test `exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Both no difference                                                    |
| `pnpm test:vehicle-migration`                                                                             | Clean full history/schema/constraints/indexes/timestamps/drift passed |
| `pnpm format:check`                                                                                       | Passed                                                                |
| `pnpm lint`                                                                                               | Passed                                                                |
| `pnpm typecheck`                                                                                          | Passed                                                                |
| `pnpm test`                                                                                               | 1,075 tests in 62 files: contracts 388/11, API 401/29, web 286/22     |
| `pnpm test:integration`                                                                                   | 94 tests in 12 files; wash-box repository 12                          |
| `pnpm test:e2e`                                                                                           | 41 passed: desktop/mobile Chrome and WebKit                           |
| `pnpm test:e2e:auth-smoke`                                                                                | 4 passed, Chrome                                                      |
| `pnpm test:e2e:vehicles`                                                                                  | 18 passed: 9 Chrome, 9 WebKit                                         |
| `pnpm test:e2e:profile`                                                                                   | 8 passed: 4 Chrome, 4 WebKit                                          |
| `pnpm test:e2e:organizations`                                                                             | 10 passed: 5 Chrome, 5 WebKit                                         |
| `pnpm test:e2e:branches`                                                                                  | 12 passed: 6 Chrome, 6 WebKit                                         |
| `pnpm test:e2e:wash-boxes`                                                                                | 12 passed: 6 Chrome, 6 WebKit                                         |
| `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/api/v1 pnpm build`                                        | Contracts/API/web, three successful tasks                             |
| `AUTH_E2E_RUN_ID=v23-local pnpm test:e2e:auth-cleanup`                                                    | All eight tables zero; no leaked rows deleted                         |
| `AUTH_E2E_RUN_ID=v23-regression pnpm test:e2e:auth-cleanup`                                               | All eight tables zero; no leaked rows deleted                         |
| `pnpm test:e2e:auth-sanitize`                                                                             | Passed                                                                |
| `git diff --check`                                                                                        | Passed                                                                |

Browser commands used `AUTH_E2E_USE_SYSTEM_CHROME=true`. Shared-database integration
and live suites ran sequentially. Focused Vitest commands, targeted Prettier,
read-only Git/status/history/worktree/ancestry/diff and source inspections were
also executed. Existing successful Turborepo cache was used only for unchanged
tasks; new/changed tests actually executed. No Firefox qualification is claimed.

Corrected failures, without skipping or weakening tests:

- The first focused HTTP command lacked sandbox socket permission; the approved
  run passed. A direct PostgreSQL Vitest invocation lacked the root environment
  loader; the repository-standard integration command passed all 94 tests.
- New frontend stale-result tests needed stable provider factories and a barrier
  proving the write started before account switching. The corrected tests and
  full web suite pass, including stale success/401/404/500 and branch navigation.
- A contract test initially under `src` was compiled into ignored dist and counted
  twice. It was moved to the existing `test` directory; only its four generated
  files were removed. The final 388 contracts count contains no duplicate.
- Real-browser assertions needed a scoped alert and a completed detail-navigation
  barrier, rather than matching another page's status. Final wash-box matrix is
  12/12. Visual review corrected new page styling to the existing layout class.
- The separate manual review initially expected generic FK SQLSTATE 23503 for
  user deletion. PostgreSQL 18 reports RESTRICT 23001. The review now asserts that
  exact state and existing membership constraint, then proves records unchanged.
  No production authentication, FK behavior or old migration was changed.

## Live browser, PostgreSQL, privacy and cleanup review

`node --env-file-if-exists=.env /private/tmp/washqueue-v23-release-review.mjs`
ran outside the worktree against built API/web and the test database. It passed
six boolean groups: startup, live persistence/accessibility, ownership/nesting/
duplicates, PostgreSQL integrity/unchanged records, storage/cache/log privacy and
zero remaining fixtures. Private configuration and fixture credentials remained
in memory and were not printed or committed.

It created temporary A/B accounts, organizations and branches, then created boxes
2 and 1 through the UI using keyboard submission; verified numeric ordering,
confirmation focus, cancellation, deactivate/reload/detail/reactivate persistence,
reserved inactive numbers, same number across branches and simultaneous 201/409.
It compared foreign/missing organization errors and wrong-parent/missing box GET
and PATCH errors. PostgreSQL inspection verified six columns, timezone-aware
timestamps, two indexes, number check, unique/FK cascade, membership RESTRICT,
same-value timestamp preservation and unchanged users, vehicles, refresh-session
metadata and opening hours after activity writes.

Chrome/WebKit wash-box scenarios hold actual list/detail/state responses across
a cross-tab A-to-B login. Old content disappears during synchronization, and
released A successes cannot populate B's UI/cache or show A feedback. A separate
same-account Next navigation scenario switches owned branches while an old,
already committed state response is delayed. New branch data remains authoritative.
Component tests also exercise stale 401/404/500, logout and pending duplicate guards.
Existing authentication, profile, organization and vehicle browser regressions pass.

Browser storage, rendered markup, URL, query/mutation data and captured API/browser
logs were compared privately against generated credentials. No token/password/
cookie/signing secret was found; no fixture owner ID/email was present in API
logs. Public API bodies exclude parent/owner/membership IDs. No cookie reader,
HTML rendering, role expansion or speculative business feature was added.

Desktop/mobile screenshots were inspected at
`/private/tmp/washqueue-v23-wash-boxes-desktop.png` and
`/private/tmp/washqueue-v23-wash-boxes-mobile.png`. Native labelled controls, visible
activity text, clear destructive wording, keyboard confirmation/cancellation and
announced feedback are covered; the 390px layout has no horizontal overflow.
No accessibility certification is claimed.

The independent review deletes only its exact fixture organizations before users,
then counts zero users, vehicles, sessions, organizations, memberships, branches,
opening hours and wash boxes. Browser fixtures enforce equivalent cascaded cleanup
and sanitized artifacts. Both final namespace cleanup checks report zero deleted
leaks and zero remaining rows. Existing development data and Docker volumes are
preserved; review API/web processes were stopped.

## Changes, limitations and next slice

Changes are limited to the wash-box contracts/public exports/tests; public branch
access facade/composition; new wash-box module/application/domain/Prisma/HTTP/OpenAPI;
Prisma schema and one migration; two nested frontend routes, focused component,
hooks/client/form/tests and minimal CSS/branch link; existing browser/fixture/schema
verification infrastructure; focused suite/script/CI steps; relevant architecture,
API/database/security/cache/testing/local-command docs, roadmap and this record.
Exact changed files:

```text
.github/workflows/auth-browser.yml
apps/api/prisma/migrations/20260930150000_add_branch_wash_boxes/migration.sql
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/branches/application/current-branch-owner-access.ts
apps/api/src/branches/branches.module.ts
apps/api/src/branches/public.ts
apps/api/src/wash-boxes/application/create-wash-box.use-case.ts
apps/api/src/wash-boxes/application/get-branch-wash-box.use-case.ts
apps/api/src/wash-boxes/application/list-branch-wash-boxes.use-case.ts
apps/api/src/wash-boxes/application/set-wash-box-active-state.use-case.ts
apps/api/src/wash-boxes/application/wash-box.repository.ts
apps/api/src/wash-boxes/domain/wash-box.ts
apps/api/src/wash-boxes/infrastructure/prisma-wash-box.repository.ts
apps/api/src/wash-boxes/presentation/wash-box-response.mapper.ts
apps/api/src/wash-boxes/presentation/wash-box.dto.ts
apps/api/src/wash-boxes/presentation/wash-box.openapi.ts
apps/api/src/wash-boxes/presentation/wash-boxes.controller.ts
apps/api/src/wash-boxes/wash-boxes.module.ts
apps/api/test-support/auth-e2e-database.mjs
apps/api/test-support/verify-vehicle-migration.mjs
apps/api/test/organization-test-app.ts
apps/api/test/wash-box-use-cases.test.ts
apps/api/test/wash-boxes-api.test.ts
apps/api/test/wash-boxes.integration.test.ts
apps/web/app/business/organizations/[organizationId]/branches/[branchId]/wash-boxes/[washBoxId]/page.tsx
apps/web/app/business/organizations/[organizationId]/branches/[branchId]/wash-boxes/page.tsx
apps/web/app/globals.css
apps/web/components/branch-detail.tsx
apps/web/components/wash-boxes.test.tsx
apps/web/components/wash-boxes.tsx
apps/web/hooks/use-wash-boxes.ts
apps/web/lib/wash-box-api-client.test.ts
apps/web/lib/wash-box-api-client.ts
apps/web/lib/wash-box-form.ts
docs/architecture/api-conventions.md
docs/architecture/branches.md
docs/architecture/database-conventions.md
docs/architecture/frontend-authentication-lifecycle.md
docs/architecture/module-boundaries.md
docs/architecture/security-baseline.md
docs/architecture/system-overview.md
docs/architecture/testing-strategy.md
docs/architecture/wash-boxes.md
docs/development/commands.md
docs/development/local-setup.md
docs/development/version-2.3-verification.md
docs/product/version-roadmap.md
e2e/live-auth/auth-test.ts
e2e/live-auth/global-teardown.ts
e2e/live-auth/wash-boxes.spec.ts
package.json
packages/contracts/src/index.ts
packages/contracts/src/wash-box.ts
packages/contracts/test/wash-box.test.ts
```

No external dependency or lockfile change. No old migration, auth lifecycle
production code, global navigation redesign, unrelated refactor, release tag or
obsolete handoff file. No unresolved local authorization, integrity or privacy
defect was found. Delivery and hosted checks remain separate release gates.

Limitations: no renumbering/deletion, occupancy/capacity, box schedules, services,
prices, employees, bookings, queues or public marketplace. Activation assignments
are last-write-wins. Existing authorization assumes no parent moves/membership
management, which are not exposed; future lifecycle operations must revisit those
races. Aborting a browser request does not roll back a committed authorized write.
Firefox remains unqualified. Business Onboarding is not complete.

Recommended Version 2.4: a narrow owner-authorized branch service catalog and
explicit prices, with strict currency/minor-unit contracts, public module boundaries,
resource privacy and identity-scoped UI. Do not derive booking capacity or add
employees, availability, bookings or queues in that slice.
