# Version 1.5 local verification record

Verified on 2026-09-08 on `feature/v1.5-customer-profile`, based on merged
`2659c16`; `1eaa199` is an ancestor. The initial worktree was clean. Root and
nested instructions, required architecture documents and ADRs 0007–0012 were read.

## Implemented boundaries and flows

- View: authenticated `/profile` reads AuthenticationProvider's currentUser;
  initialization/synchronization/error/logout states hide profile data and controls.
- Update: existing scoped Bearer guard → UsersController → framework-independent
  UpdateCurrentUserProfileUseCase → UserRepository → PrismaUserRepository →
  PostgreSQL → existing strict current-user mapper/response. UsersHttpModule is
  HTTP composition only, avoiding an AuthModule/UsersModule dependency cycle.
- Identity comes exclusively from the verified minimum principal. Body/query IDs,
  email, password, roles, organizations, sessions and all unknown fields are rejected.
- The nonempty partial contract reuses registration schemas exactly: trim, preserve
  casing/internal whitespace, 2–60 for nonempty names. First name cannot be null;
  last name omitted retains, null/blank clears. Only supplied names are persisted.
- One atomic update selects only the public projection. Missing/race-deleted identity
  maps to generic 401, not 404. Errors are 400/401/sanitized 500; success is 200.
- Provider commits strictly validated same-account results only within the captured
  identity generation, preserving the latest token/expiration. A separate transient
  read marker prevents older profile reads from overwriting newer name commits.
- Exactly one non-sensitive `{ type: "profile-changed", sourceId }` follows a
  successful local commit. Receivers call `/auth/me` with their own in-memory token;
  no refresh, cookie mutation, identity payload or rebroadcast is introduced.
- Temporary form/operation state stays outside TanStack Query. There is no second
  current-user cache, token property, persistent feature token, automatic retry,
  global guard, middleware or new authentication system.
- Inline editing has prefill, read-only email, shared validation, nullable clearing,
  Save/Cancel, duplicate-submit latch, pending/error/success semantics and focus return.
  Existing vehicle navigation and behavior remain intact.
- No migration or dependency was added; existing migrations and lockfile are unchanged.
  Concurrent valid writes use atomic last-write-wins, without optimistic locking.

## Executed verification

| Gate                               | Actual result                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Frozen install                     | Passed; dependencies already up to date                                       |
| Docker/PG readiness                | Existing PostgreSQL 18.4 container healthy and accepting connections          |
| Prisma Client                      | Generated successfully (7.9.0)                                                |
| Dev migration deploy/status/drift  | All 4 applied; up to date; no difference                                      |
| Test migration deploy/status/drift | All 4 applied; up to date; no difference                                      |
| Format and lint                    | Passed                                                                        |
| Typecheck                          | Passed                                                                        |
| Contract tests                     | 191 passed, 8 files                                                           |
| API/application/HTTP tests         | 252 passed, 23 files                                                          |
| Web/component/provider tests       | 203 passed, 15 files                                                          |
| Total unit-boundary tests          | 646 passed                                                                    |
| PostgreSQL integration             | 58 passed, 9 files                                                            |
| General E2E                        | 41 passed: desktop Chrome 17, mobile Chrome 7, WebKit 17                      |
| Authentication smoke               | 4 passed, Chrome                                                              |
| Vehicle E2E regressions            | 18 passed: Chrome 9, WebKit 9                                                 |
| Profile E2E                        | 8 passed: Chrome 4, WebKit 4                                                  |
| Disposable migration verifier      | All 4 applied, vehicle schema and drift verified; disposable database removed |
| Production build                   | Contracts, API and web passed; /profile included                              |
| git diff --check                   | Passed                                                                        |

A new component test initially used Playwright's `exact` option with Testing
Library; typecheck correctly rejected it. The option was removed. A new client
test initially required Prettier formatting. Both gates were rerun successfully;
no tests, rules or assertions were weakened or skipped.

Commands actually executed (inspection also used `rg`, `cat`, `sed`, Git status,
diff/history/ancestry, remote inspection and `git fetch origin --prune`):

```bash
pnpm install --frozen-lockfile
docker compose up -d
docker compose ps
docker compose exec -T postgres pg_isready -U washqueue
pnpm db:generate
pnpm --filter @washqueue/api db:migrate:deploy
pnpm --filter @washqueue/api exec prisma migrate status
pnpm --filter @washqueue/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
NODE_ENV=test pnpm --filter @washqueue/api db:migrate:deploy
NODE_ENV=test pnpm --filter @washqueue/api exec prisma migrate status
NODE_ENV=test pnpm --filter @washqueue/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:vehicle-migration
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/api/v1 pnpm build
AUTH_E2E_USE_SYSTEM_CHROME=true AUTH_E2E_RUN_ID=v15-profile pnpm test:e2e:profile
AUTH_E2E_USE_SYSTEM_CHROME=true AUTH_E2E_RUN_ID=v15-auth pnpm test:e2e:auth-smoke
AUTH_E2E_USE_SYSTEM_CHROME=true AUTH_E2E_RUN_ID=v15-vehicles pnpm test:e2e:vehicles
node --env-file=.env /private/tmp/washqueue-v15-release-review.mjs
AUTH_E2E_RUN_ID=v15-profile pnpm test:e2e:auth-cleanup
AUTH_E2E_RUN_ID=v15-auth pnpm test:e2e:auth-cleanup
AUTH_E2E_RUN_ID=v15-vehicles pnpm test:e2e:auth-cleanup
git diff --check
```

Targeted `pnpm exec prettier --write` commands formatted only changed files.
The temporary review script is outside the repository and is not committed.

## Live browser, database, accessibility and privacy review

Built API/web plus real PostgreSQL were started for the browser suites and an
additional scripted Chrome review. Registration, owned PATCH 200, reload/restoration,
surname clearing and immutable-field 400 responses were observed. SQL comparisons
verified updatedAt advancement, unchanged createdAt/email/password/identity, and
unchanged vehicles/sessions during name updates. Exact fixture cleanup independently
reported zero remaining users, vehicles and sessions for every run namespace.

Same-user live synchronization produced exactly one profile event, one receiver
`/auth/me`, zero refresh requests and an unchanged cookie/session family. Delayed
account-A responses were released after B login on both qualified browsers: old
forms disappeared immediately, and neither old data nor success feedback appeared
under B. Component tests additionally released stale 401 and 500 failures.

Desktop (1280px) and mobile (390px) screenshots were visually inspected. Native
controls, focus entry/return, label/error associations, read-only email, live
pending/success/error semantics and no horizontal overflow were checked. This is
not a claim of a full assistive-technology or independent accessibility audit.

Browser inspection found no profile query or mutation-result cache and no
credential in storage, URL, markup, cache or channel payloads. Boolean comparisons
found no credential or profile-data leakage in captured browser/API/web logs.
The repository update selects no passwordHash. No high-severity identity or
ownership defect was found in this scoped review.

## Delivery, limitations and next scope

GitHub CLI is not installed, so no PR or hosted-check result is claimed here.
The final handoff records the actual feature commit and push result. Do not
automatically merge or create a release tag. Recommend human review and passing
hosted checks before merge; Customer Version 1 can then be released as complete.

Notifications remain transient; missed events recover through normal restoration
and refresh-time current-user verification. Concurrent name writes remain
last-write-wins. Browser qualification covers Chrome/Chromium and WebKit, not
Firefox. Existing short-lived access-token/logout limitations are unchanged.

Documentation updates cover users/profile boundaries, API, database invariants,
security, authentication lifecycle/cache/channel behavior, ADR 0012 consequences,
testing, commands, local verification and the version roadmap. No new ADR was needed.

Recommended next product slice: narrow organization onboarding—verified-customer
creation and owner-scoped viewing of an organization, explicit ownership contracts
and isolation tests. Defer branches, staff permissions, pricing and booking/queue
features to separately scoped slices. None is implemented here.

## Changed files

The inventory includes production code, tests, relevant docs and CI wiring.
Existing auth/vehicle test edits only satisfy the expanded narrow port/channel types.

- `apps/api/src/users/application/update-current-user-profile.use-case.ts`
- `apps/api/src/users/presentation/update-profile-request.dto.ts`
- `apps/api/src/users/presentation/users.controller.ts`
- `apps/api/src/users/users-http.module.ts`
- `apps/api/test/profile-api.test.ts`
- `apps/api/test/profile-repository.integration.test.ts`
- `apps/api/test/profile-test-app.ts`
- `apps/api/test/update-current-user-profile.test.ts`
- `apps/web/app/profile/page.tsx`
- `apps/web/components/profile-auth-state.test.tsx`
- `apps/web/components/profile.test.tsx`
- `apps/web/components/profile.tsx`
- `apps/web/hooks/use-profile-update.ts`
- `apps/web/lib/profile-api-client.test.ts`
- `apps/web/lib/profile-edit-form.ts`
- `e2e/live-auth/profile.spec.ts`
- `packages/contracts/src/profile.ts`
- `packages/contracts/test/profile.test.ts`
- `.github/workflows/auth-browser.yml`
- `apps/api/src/app.module.ts`
- `apps/api/src/users/application/user-repository.ts`
- `apps/api/src/users/infrastructure/prisma-user.repository.ts`
- `apps/api/src/users/users.module.ts`
- `apps/api/test/current-customer.guard.test.ts`
- `apps/api/test/current-user-api.test.ts`
- `apps/api/test/get-current-user.test.ts`
- `apps/api/test/login-api.test.ts`
- `apps/api/test/login-customer.test.ts`
- `apps/api/test/register-customer.test.ts`
- `apps/api/test/registration-api.test.ts`
- `apps/api/test/vehicles-api.test.ts`
- `apps/web/app/globals.css`
- `apps/web/components/login-form.test.tsx`
- `apps/web/components/login-form.tsx`
- `apps/web/components/vehicles-auth-state.test.tsx`
- `apps/web/components/vehicles.test.tsx`
- `apps/web/components/vehicles.tsx`
- `apps/web/lib/api-client.ts`
- `apps/web/lib/auth-lifecycle-channel.test.ts`
- `apps/web/lib/auth-lifecycle-channel.ts`
- `apps/web/providers/authentication-provider.test.tsx`
- `apps/web/providers/authentication-provider.tsx`
- `docs/architecture/api-conventions.md`
- `docs/architecture/authentication.md`
- `docs/architecture/database-conventions.md`
- `docs/architecture/frontend-authentication-lifecycle.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/security-baseline.md`
- `docs/architecture/testing-strategy.md`
- `docs/decisions/0012-non-sensitive-cross-tab-auth-lifecycle-events.md`
- `docs/development/commands.md`
- `docs/development/local-setup.md`
- `docs/product/version-roadmap.md`
- `e2e/live-auth/auth-test.ts`
- `package.json`
- `packages/contracts/src/index.ts`
- `docs/development/version-1.5-verification.md` (this record)
