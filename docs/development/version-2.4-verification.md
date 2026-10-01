# Version 2.4 verification and completion report

## Baseline and implementation status

All required local implementation gates passed on 2026-10-01.
Branch: feature/v2.4-branch-services-pricing. Baseline is 9b9d2f6bad8f89c9f0b6d73795c31b4a0606d724,
the merged Version 2.3 PR #7, containing e6da43a89f7d83ddf2a1aff61946d52c86d7d914.
Git fetch used --prune --no-tags; origin/main ancestry, clean working tree,
single worktree, wash-box module/migration/browser suite/verification document and
public BranchOwnerAccess were verified before switching main, pulling --ff-only
and creating the new branch. No baseline was recreated/cherry-picked or main pushed.
The authenticated GitHub read confirmed PR #7 merged. This is not a claim about
Version 2.4 hosted checks.

Root and all applicable nested instructions, relevant product/architecture/security/
database/API/lifecycle/cache/testing/roadmap documents and decisions were read.
The migration-safety skill was used only within the existing Docker/PostgreSQL/
Prisma workflow; no Neon provisioning, replatforming or dependency was introduced.

## Delivered slice and boundaries

POST/list/detail/PATCH live under
/api/v1/organizations/:organizationId/branches/:branchId/services.
The unchanged endpoint-scoped guard verifies access tokens/current-user existence.
Each focused service use case invokes public BranchOwnerAccess before persistence.
Organization OWNER membership remains private to organizations; branches returns
only validated branch scope. All persistence is branch scoped, and detail/update
also service scoped. Application/domain code has no framework/Prisma/HTTP dependency.
Only nine public fields leave the adapter/mapper, with strict shared validation.
No owner/parent/membership/credential field appears in public service responses.

Creation assigns active. Names are deliberately nonunique. Missing and foreign
resources share controlled error code/message at each level. UUID/input/query
validation yields 400, authentication generic 401, parent/service scope generic 404,
unexpected infrastructure errors sanitized 500. There is no artificial conflict,
DELETE, currency mutation or global guard. OpenAPI documents all four routes.

One new forward migration adds ten columns and the branch cascade FK, duration/
positive-price/KZT checks, default-true activity and deterministic listing index.
Existing migrations are unchanged. No-op PATCH preserves updatedAt, actual changes
advance it, createdAt/currency/parent remain unchanged. Supplied-column UPDATE is
atomic, including combined price/duration. Concurrent independent fields retain
both changes; same-field changes follow committed ordering/last-write-wins.
Member-user RESTRICT and customer/schedule/box integrity remain unchanged.

## Exact money and protected frontend

Creation/list and service detail routes reuse the existing authenticated boundary
and visual language. Accessible native forms expose labelled KZT/minute fields,
shared validation, pending latch, Save/Cancel, success and sanitized failure.
Edit prefills every minor unit and submits only changed mutable fields; blank
description clears without resetting omitted fields. Deactivation is confirmed,
cancellation sends no request, reactivation explicitly sets true and inactive
services stay editable. No optimistic price/activity state exists.

The single kzt-price boundary accepts bounded decimal strings with dot/comma and
at most two fractional digits, using string/BigInt arithmetic. 5000 becomes
500000, 5000.50/5000,50 becomes 500050, and 0.01 becomes 1. Excess precision,
exponents, signs, mixed separators, junk and overflow fail without rounding.
The maximum is a product guardrail, not a legal/banking/market price claim.
Currency remains KZT. UI/API/PostgreSQL round trips and reload persistence passed.

Query/mutation keys capture user/organization/branch/service, never token.
Only authenticated identity/resource-keyed subtrees show forms/data. Feature-local
cleanup cancels/removes old caches and aborts writes; provider generations and
post-response abort/mounted checks suppress stale success/401/404/500. Late account
and branch list/detail/PATCH results cannot populate newer UI. AuthenticationProvider
and lifecycle channel production code are unchanged. API calls use explicit
runWithAccessToken, credentials omit, encoded validated paths and no retries.
Uncertain creation tells the owner to check the list before creating again.
Browser cancellation never promises rollback of a committed original-scope write.

## Executed commands and final results

| Command                                                                                                   | Actual final result                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Git status/branch/HEAD/remotes/worktrees/history/ancestry inspections; git fetch origin --prune --no-tags | Clean valid merged baseline; one worktree                                                                                            |
| git switch main; git pull --ff-only origin main; git switch -c feature/v2.4-branch-services-pricing       | Succeeded; base 9b9d2f6                                                                                                              |
| pnpm install --frozen-lockfile                                                                            | Passed; pinned dependencies unchanged                                                                                                |
| docker compose up -d; docker compose ps                                                                   | PostgreSQL 18.4 healthy; data volumes retained                                                                                       |
| pnpm --filter @washqueue/api exec prisma format                                                           | Passed                                                                                                                               |
| pnpm db:generate                                                                                          | Passed; Prisma 7.9 Client                                                                                                            |
| pnpm --filter @washqueue/api exec prisma migrate dev --name add_branch_services --create-only             | Created 20261001043927_add_branch_services; checks added before first deployment                                                     |
| pnpm --filter @washqueue/api db:migrate:deploy / exec prisma migrate status                               | Dev: all eight applied/up to date                                                                                                    |
| Same deploy/status with NODE_ENV=test                                                                     | Integration: all eight applied/up to date                                                                                            |
| Dev/test exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   | Both no difference detected                                                                                                          |
| pnpm test:vehicle-migration                                                                               | All eight migrations from scratch, schemas/indexes/FKs/checks/timestamps/drift passed; only self-created disposable database removed |
| pnpm format:check                                                                                         | Passed                                                                                                                               |
| pnpm lint                                                                                                 | Passed                                                                                                                               |
| pnpm typecheck                                                                                            | Passed                                                                                                                               |
| pnpm test                                                                                                 | 1,269 tests in 68 files: contracts 469/12; API 454/31; web 346/25                                                                    |
| pnpm test:integration                                                                                     | 109 tests in 13 files; services repository 15                                                                                        |
| pnpm test:e2e                                                                                             | 41 passed; desktop/mobile Chrome and WebKit                                                                                          |
| pnpm test:e2e:auth-smoke                                                                                  | 4 passed; Chrome                                                                                                                     |
| pnpm test:e2e:vehicles                                                                                    | 18 passed; 9 Chrome, 9 WebKit                                                                                                        |
| pnpm test:e2e:profile                                                                                     | 8 passed; 4 Chrome, 4 WebKit                                                                                                         |
| pnpm test:e2e:organizations                                                                               | 10 passed; 5 Chrome, 5 WebKit                                                                                                        |
| pnpm test:e2e:branches                                                                                    | 12 passed; 6 Chrome, 6 WebKit                                                                                                        |
| pnpm test:e2e:wash-boxes                                                                                  | 12 passed; 6 Chrome, 6 WebKit                                                                                                        |
| pnpm test:e2e:services                                                                                    | 16 passed; 8 Chrome, 8 WebKit, including final updated-source rerun                                                                  |
| pnpm build; NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/api/v1 pnpm build                              | Contracts/API/web: three successful build tasks                                                                                      |
| AUTH_E2E_RUN_ID=v24-services / v24-services-final / v24-regression pnpm test:e2e:auth-cleanup             | All nine tables zero remaining; no leaked fixture rows found/deleted                                                                 |
| pnpm test:e2e:auth-sanitize                                                                               | Passed                                                                                                                               |
| node /private/tmp/washq-v24-review.mjs                                                                    | Separate built-app UI/API/SQL/privacy review passed; exact fixtures cleaned                                                          |
| git diff --check and final status/diff review                                                             | Passed; intended slice files only                                                                                                    |

Live suites used AUTH_E2E_USE_SYSTEM_CHROME=true and namespaced run IDs.
Mutable-database integration/browser/manual suites ran sequentially.
Focused Vitest and targeted Prettier commands also ran during implementation.
Unchanged Turborepo tasks may reuse an actually successful cache; changed suites
executed. No Firefox qualification or hosted success is claimed from these results.

New slice coverage: 81 contracts; 8 application/boundary; 45 HTTP; 15 PostgreSQL;
25 components; 7 transport; 28 exact money/form tests; 16 real-browser scenarios.
Existing authentication/profile/vehicle/organization/branch/wash-box tests remain
intact. The existing browser CI now runs services after wash boxes, including
qualified WebKit matrix jobs, rather than adding another CI stack.

## Independent live review, accessibility and privacy

The separate review started real built API/web on test PostgreSQL, registered
exact temporary owners, created an organization/branch and created a service via
the browser. It checked 5000 KZT stored as 500000, changed price to 500050 and
duration to 45, reloaded, then inspected SQL values, timestamps, ten-column schema,
currency width, checks/FK and both indexes. It compared controlled foreign/missing
GET/PATCH errors, verified user-deletion RESTRICT, and inspected 1280px/390px
screenshots and zero horizontal overflow. The screenshots were viewed separately.

Browser suites additionally exercised description clearing, confirmation cancel
with zero requests, deactivate/reload/reactivate, nesting privacy, concurrent
patches and cross-tab/branch stale-result barriers. Native keyboard controls,
labels/error associations, edit/confirmation focus, status announcements and
return focus passed. No focus trap or new UI library. This is an accessibility
review, not a comprehensive external conformance certification.

Privacy comparisons checked tokens/passwords/signing secret/cookie values against
storage, URL, markup, query/mutation cache and console/API logs without printing
them. Protected feature requests omit cookies. SQL/customer-integrity tests prove
no unrelated user, vehicle, session, box or hours mutation. Descriptions render
only text. No identity data was added to BroadcastChannel. No Authorization,
credentials, user identity or profile/service data leakage was found in reviewed
logs. Safe trace sanitization remains required before any upload.

Fixture cleanup deletes only namespaced organizations before users, refuses shared
unrelated memberships, and independently verifies services, wash boxes, hours,
branches, memberships, organizations, users, vehicles and refresh sessions.
Manual fixtures and all browser fixture namespaces have zero remaining rows.
No unrelated development data was deleted or reset.

## Corrected development failures

- Recovery confirmed both database histories up to date before further work;
  deployments/status were re-executed explicitly after the interrupted session.
- Draft frontend adapter naming/import mistakes were corrected before verification.
- Adapted HTTP test paths, path placeholder and expected public message initially
  retained old feature naming; corrected tests pass all 45 cases.
- A timestamp assertion incorrectly included the old updatedAt while separately
  requiring advancement; it now asserts changed time and unchanged protected fields.
- A repeated display-price assertion needed an exact two-item query rather than
  a single-element query; component assertions now pass.
- Lint rejected new type-alias interfaces/non-null assertions; code now follows
  existing rules, with no suppression, any, weakened config or skipped test.
- The contract test was initially inside src and compiled into ignored dist,
  causing duplicate test discovery. It was moved into the existing test directory;
  its four generated files were moved to a temporary backup. Final counts have
  no duplicate and no source/test was deleted.

## Changed files, dependencies, decisions and limitations

- .github/workflows/auth-browser.yml
- apps/api/prisma/migrations/20261001043927_add_branch_services/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/src/app.module.ts
- apps/api/src/branch-services/application/branch-service.repository.ts
- apps/api/src/branch-services/application/create-branch-service.use-case.ts
- apps/api/src/branch-services/application/get-branch-service.use-case.ts
- apps/api/src/branch-services/application/list-branch-services.use-case.ts
- apps/api/src/branch-services/application/update-branch-service.use-case.ts
- apps/api/src/branch-services/branch-services.module.ts
- apps/api/src/branch-services/domain/branch-service.ts
- apps/api/src/branch-services/infrastructure/prisma-branch-service.repository.ts
- apps/api/src/branch-services/presentation/branch-service-response.mapper.ts
- apps/api/src/branch-services/presentation/branch-service.dto.ts
- apps/api/src/branch-services/presentation/branch-service.openapi.ts
- apps/api/src/branch-services/presentation/branch-services.controller.ts
- apps/api/test-support/auth-e2e-database.mjs
- apps/api/test-support/verify-vehicle-migration.mjs
- apps/api/test/branch-service-use-cases.test.ts
- apps/api/test/branch-services-api.test.ts
- apps/api/test/branch-services.integration.test.ts
- apps/api/test/organization-test-app.ts
- apps/web/app/business/organizations/[organizationId]/branches/[branchId]/services/[serviceId]/page.tsx
- apps/web/app/business/organizations/[organizationId]/branches/[branchId]/services/page.tsx
- apps/web/components/branch-detail.tsx
- apps/web/components/branch-services.test.tsx
- apps/web/components/branch-services.tsx
- apps/web/hooks/use-branch-services.ts
- apps/web/lib/branch-service-api-client.test.ts
- apps/web/lib/branch-service-api-client.ts
- apps/web/lib/branch-service-form.ts
- apps/web/lib/kzt-price.test.ts
- apps/web/lib/kzt-price.ts
- docs/architecture/api-conventions.md
- docs/architecture/branch-services.md
- docs/architecture/database-conventions.md
- docs/architecture/frontend-authentication-lifecycle.md
- docs/architecture/module-boundaries.md
- docs/architecture/security-baseline.md
- docs/architecture/system-overview.md
- docs/architecture/testing-strategy.md
- docs/development/commands.md
- docs/development/local-setup.md
- docs/development/version-2.4-verification.md
- docs/product/version-roadmap.md
- e2e/live-auth/auth-test.ts
- e2e/live-auth/global-teardown.ts
- e2e/live-auth/services.spec.ts
- package.json
- packages/contracts/src/branch-service.ts
- packages/contracts/src/index.ts
- packages/contracts/test/branch-service.test.ts

No dependency added or upgraded; pnpm-lock.yaml unchanged. No applied migration
was modified. Existing monetary conventions already establish integer minor units
and ISO currency, so no routine CRUD ADR was created. Relevant architecture,
API/database/security/cache/testing/setup/commands/roadmap documents are updated.
Only Version 2.4 is marked implemented, not Business Onboarding.

No deletion, payments, bookings, queues, employee/box assignment, discounts, taxes,
invoices, multi-currency, public marketplace, availability, history or scheduled
pricing. Concurrent same-field edits are last-write-wins, not optimistic locking.
Creation has no general idempotency key. Future orders must snapshot accepted
service label/duration/price/currency, not read mutable historical prices later.

Delivery is a normal feature-branch commit/push with a review PR when authorized.
Exact commit/push/PR and hosted check state are reported separately at handoff.
No automatic merge, main push, tag change or release tag. Human review and passed
hosted checks remain merge prerequisites. Next recommended focused scope:
organization-scoped employee membership onboarding, with invitations and access
boundaries designed separately; booking/payments remain outside that slice.
