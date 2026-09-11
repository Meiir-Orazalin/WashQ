# Organizations (Version 2.1)

The first business slice supports creation, owned listing and owner-only detail.
An account remains a customer independently of its organization memberships.

## Boundaries and flows

`OrganizationsModule` imports only the existing public authentication boundary and
database infrastructure composition. The scoped `CurrentCustomerGuard` verifies
Bearer identity and current user existence, attaching only immutable `{ userId }`.
It does not inspect cookies or introduce a global guard.

- Create: controller → `CreateOrganizationUseCase` → `OrganizationRepository`
  → `PrismaOrganizationRepository` transaction → organization plus one OWNER
  membership → explicit public mapper → strict response.
- List: controller → `ListOwnedOrganizationsUseCase` → OWNER-membership-filtered
  query → ordered public organizations.
- Detail: validated UUID plus verified user → `GetOwnedOrganizationUseCase`
  → one query matching both organization and OWNER membership → public response
  or `OrganizationNotFoundError` mapped to generic 404.

Application and domain types contain no NestJS, HTTP or Prisma dependencies.
Repository outputs contain only id, name, nullable description and timestamps.
Users/authentication persistence is never accessed from organizations. Only
organization-owned tables are written in the transaction; the user's FK verifies
integrity without updating user, vehicle or session rows.

## Integrity and authorization

See [ADR 0013](../decisions/0013-organization-membership-ownership-and-deletion-integrity.md).
OWNER is membership-scoped, not a global role. Composite organization/user
uniqueness prevents duplicate membership while permitting future multiple owners.
User deletion is restricted while any membership remains. Fixture-level organization
deletion cascades memberships; existing user vehicle/session cascades are retained.
No ownership is accepted in request bodies, paths or query parameters. Organization
UUID is only a resource locator. Missing and foreign detail return the same
`ORGANIZATION_NOT_FOUND` code/message. Names are deliberately nonunique.

## Frontend and protected caches

`/business/organizations` offers an accessible name/description form and owned list.
`/business/organizations/[organizationId]` shows owner-only details and a plain
notice that branches arrive in the next version. Descriptions render as ordinary
React text, preserving line breaks, never HTML. Authenticated navigation retains
profile and vehicle links.

`organization-api-client` parses strict requests/responses and takes an explicit
memory-only token through `runWithAccessToken`, with `credentials: "omit"`, no
HTTP caching, AbortSignal support and no automatic retries. AuthenticationProvider
and AuthLifecycleChannel are unchanged. No new event or current-user store exists.

The user-keyed authenticated subtree owns form/mutation state. Feature-local cleanup
cancels and removes both `['organizations', userId]` and all
`['organization', userId, organizationId]` data when the boundary unmounts. This also
cleans on navigation; list/detail caching across route remounts is not required.
Identity transitions hide the subtree immediately. Provider generations reject
stale completions, creation is aborted on unmount, and cache invalidation is scoped
to the captured user. Old success or 401/404/500 cannot populate or invalidate a
new account. Tokens never enter keys, cache, mutation variables/results or markup.

## Limits

No pagination, name uniqueness, organization edit/delete/transfer, additional owner
management, public discovery, verification, global roles, employees or branches.
A successful creation whose response is lost is not automatically retried; a manual
second creation can create another same-name organization. General idempotency keys
are not introduced. Next slice: Version 2.2 branches and opening hours.
